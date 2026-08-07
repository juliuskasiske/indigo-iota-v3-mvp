"""The agent swarm: turns a time-bound objective into a hypothesis tree.

One pass builds a tree whose shape IS the reasoning:

    objective   the one-sentence objective from the Objectives tab (the root)
      branch    a MECE cut of its parent — price / quantity / elasticity levers,
                each carrying the rationale for why that cut, and why the set is
                exhaustive. Branches may nest.
        initiative   a leaf: something a team could start on Monday, with a card
                     saying what it means, how it would be sized, what would need
                     to be true, and the immediate next steps.

Every node is grounded in evidence retrieved for THAT node (not a shared prefix
of the brain), so a pricing branch and a churn branch see different facts.

Design notes worth knowing before editing:

  * Decomposition is ONE LLM call PER NODE, breadth-first, with a ``terminal``
    flag. Asking for a whole subtree in one call produces long JSON that hits
    max_tokens and truncates silently — you get a plausible half-tree and no
    error.
  * The Planning agent's output is PERSISTED. It owns two of the five card
    fields (what-must-be-true, next-steps) and feeds the Sizer. It used to be
    written to the log and thrown away.
  * ``org_id`` is threaded explicitly all the way down to every LLM call. See
    ``agents/llm.py`` for why the ambient contextvar cannot work here.
  * Branch status is DERIVED from descendants, not asked of a model.
  * The pass is one-shot: it finishes and marks the run complete. There is no
    heartbeat pinning ``running`` forever.

The loop still appends to ``agent_events`` at every step, so the Activity log on
the Overview reads exactly as it did before.
"""
from __future__ import annotations

import asyncio
import json
import logging
from functools import partial

from src import config
from src.agents import llm
from src.billing import metering
from src.db import hypothesis as tree
from src.db import objective as objective_repo
from src.db.connection import get_tenant_connection
from src.ingestion.comprehend.agents.base import _extract_json_block

log = logging.getLogger("iota.swarm")


# --- roles ------------------------------------------------------------------
# `calls` is filled in at read time from the event log. The loop is strictly
# sequential, so a fixed "instances" count would be decoration — and decoration
# that claims eight validators are running is worse than no number at all.
ROLES = [
    {
        "key": "framer",
        "name": "Objective framer",
        "desc": "Compresses the program definition — the ranked levers, the target, the horizon — into the one sentence that headlines the diagnosis and roots the tree.",
    },
    {
        "key": "decomposition",
        "name": "MECE decomposition",
        "desc": "Cuts the objective, and each branch under it, into mutually exclusive and collectively exhaustive levers — each with the rationale for why that cut and why the set is complete.",
    },
    {
        "key": "initiative",
        "name": "Initiative design",
        "desc": "Turns each leaf branch into concrete initiatives a team could start on Monday, not themes.",
    },
    {
        "key": "validator",
        "name": "Validator",
        "desc": "Gathers the facts behind each initiative from the brain and decides whether the firm's own evidence supports it.",
    },
    {
        "key": "planning",
        "name": "Planning",
        "desc": 'Asks "what would need to be true for this to be worth pursuing?", works out how it could be sized, and names the immediate next steps.',
    },
    {
        "key": "sizer",
        "name": "Opportunity sizer",
        "desc": "Puts a number on each initiative in the program's own unit, and checks it can be at run-rate before the deadline.",
    },
    {
        "key": "judge",
        "name": "Judge",
        "desc": "Sense-checks every output before it reaches the client, catching weak evidence, logical leaps and numbers the facts do not carry.",
    },
]

# --- cost caps --------------------------------------------------------------
# Worst case: 1 framer + (1 + MAX_BRANCH_NODES) decomposition + MAX_LEAF_BRANCHES
# initiative + MAX_INITIATIVES x 4 = about 40 calls. MAX_LLM_CALLS is the
# circuit breaker: without it, one prompt tweak that makes every branch
# non-terminal turns a cheap run into an expensive one.
MAX_BRANCH_DEPTH = 2              # branch layers below the root
MAX_BRANCHES_PER_NODE = 4
MAX_BRANCH_NODES = 8              # total branch nodes in one tree
MAX_LEAF_BRANCHES = 5
MAX_INITIATIVES_PER_BRANCH = 3
MAX_INITIATIVES = 10
MAX_LLM_CALLS = 55

# db_name -> {"task": asyncio.Task, "run_id": int}
_runs: dict[str, dict] = {}


# --- system prompts ---------------------------------------------------------
# Every prompt receives the same PROGRAM block (db.objective.describe), so each
# agent knows the unit, the target, the horizon and the ranked levers.

P_FRAME = (
    "You are the Objective Framer in a swarm of AI consultants running a corporate "
    "diagnostic. Compress the client's program definition into ONE sentence a partner "
    "could open a board meeting with. The sentence MUST name: the impact metric, the "
    "size of the target in the currency and unit given, whether the impact is a "
    "recurring run-rate or a one-time gain, and the deadline. Maximum 30 words. Write "
    "plainly — no 'leverage', 'synergy', 'holistic', 'transform'. Use ONLY numbers that "
    "appear in the program definition; invent nothing. "
    'Return STRICT JSON only: {"headline":"<one sentence>"}.'
)

P_DECOMPOSE = (
    "You are the MECE Decomposition agent. You are given one node of a hypothesis tree "
    "— the root is the client's objective — the path of ancestors above it, and evidence "
    "excerpts from the firm's brain. Cut THAT node into 2 to 4 child branches that are "
    "Mutually Exclusive and Collectively Exhaustive with respect to it: together they "
    "must account for the whole of the parent, and no two may overlap. "
    "Cut on the ARITHMETIC of the metric first (for revenue: price, volume, mix; for "
    "EBIT: price, volume, unit cost, fixed cost), then on where in the business the "
    "value actually sits. "
    "EVERY branch MUST carry a rationale of one or two sentences saying why this is the "
    "right cut — this is shown to the client as the reasoning behind the tree, so it has "
    "to stand on its own. Ground branches in the evidence where you can by citing "
    "excerpts by their [index]; never cite an index you were not given. "
    'Set "terminal": true when a branch is already concrete enough that the next step is '
    "naming initiatives rather than cutting it further. "
    'Return STRICT JSON only: {"mece_note":"<one sentence: on what dimension this set is '
    'exhaustive>","branches":[{"label":"<3 to 8 words>","rationale":"<why this cut>",'
    '"evidence":[<indices>],"terminal":true|false}]}.'
)

P_INITIATIVE = (
    "You are the Initiative Design agent. Given one leaf branch of the hypothesis tree "
    "and the evidence behind it, propose 1 to 3 CONCRETE initiatives that would move "
    "that branch towards the program's target. An initiative is a piece of work a team "
    "could start on Monday, not a theme: 'Improve pricing' is not an initiative, "
    "'Benchmark our top-50 SKU list prices against three named competitors' is. Prefer "
    "initiatives the firm's own evidence points at over generic best practice. "
    'Return STRICT JSON only: {"initiatives":[{"name":"<5 to 10 words>","context":"<2 to '
    '3 sentences: what is actually meant by this, and what is in and out of scope>"}]}.'
)

P_VALID = (
    "You are the Validator agent. You are given one initiative and numbered evidence "
    "excerpts from the firm's brain. Decide, using ONLY those excerpts, whether the "
    "firm's own evidence supports it being worth pursuing. NEVER invent a fact or a "
    "number. Every fact you return MUST cite the [index] of the excerpt it came from, "
    "and you must never cite an index that is not in the list. If the evidence is "
    "insufficient, set supported to false and still return whichever excerpts are "
    "relevant. "
    'Return STRICT JSON only: {"supported":true|false,"facts":[{"text":"<a grounded '
    'fact, quoting or closely paraphrasing the excerpt>","evidence":<index>}],'
    '"reasoning":"<one sentence: what the evidence does and does not establish>"}.'
)

P_PLAN = (
    "You are the Planning agent. Given one initiative and the Validator's finding, work "
    "out three things. "
    "(1) WHAT WOULD NEED TO BE TRUE for this initiative to be worth pursuing — 2 to 4 "
    "conditions, each falsifiable, each something a person could go and check. "
    "(2) HOW IT COULD BE SIZED — the actual arithmetic, naming the quantity and the rate "
    "that multiply together and where each number would come from. "
    "(3) THE IMMEDIATE NEXT STEPS — 2 to 4 actions someone could start this week, each "
    "naming the specific data, document, system or person involved (for example: 'Pull "
    "external list prices for our top 50 SKUs from three named competitors'). Every next "
    "step must move the initiative towards being SIZED or DE-RISKED — not towards being "
    "delivered. "
    'Return STRICT JSON only: {"what_must_be_true":["<condition>"],"sizing_approach":'
    '"<one or two sentences: the formula and its inputs>","next_steps":["<action>"]}.'
)

P_SIZE = (
    "You are the Opportunity Sizer agent. Given one initiative, the facts the Validator "
    "grounded, and the Planner's sizing approach, put a number on it. "
    "You MUST express the value in the SAME unit as the client's program: the metric, "
    "currency, impact type and run-rate year in the PROGRAM block above. "
    '"amount" is a plain number in that currency with no separators and no multiplier '
    "suffix — write 1200000, never 1.2M and never a currency symbol. "
    "Then judge FEASIBILITY against the program end date: given the lead time to "
    "implement and the time to ramp, can this realistically BE at that run-rate by the "
    "end date? If not, say so — do not quietly move the date. "
    "If the facts do not support a firm number, give a conservative estimate, set "
    'confidence to "low", and name the assumption it rests on. NEVER inflate a number to '
    "make the target look reachable: the client will sum these. "
    'Return STRICT JSON only: {"amount":<number>,"currency":"<code>","impact_type":'
    '"recurring|one_time","run_rate_year":<year>,"basis":"<one or two sentences: the '
    'arithmetic you used>","confidence":"low|medium|high","feasible_by_end":true|false}.'
)

P_JUDGE = (
    "You are the Judge agent. You sense-check every other agent before its output "
    "reaches the client. Given the initiative, the Validator's finding, the Planner's "
    "conditions, and the Sizer's number, return the final verdict. Be skeptical. Reject "
    "a number the facts do not carry. Reject conditions that cannot be tested. Reject "
    "any value whose metric, currency or impact type does not match the PROGRAM block. "
    'The verdict is exactly one of "supported" (evidence and arithmetic both hold), '
    '"needs_evidence" (plausible but unproven — it needs an interview or data the brain '
    'does not have), or "discarded" (contradicted, double-counted or baseless). '
    'Return STRICT JSON only: {"verdict":"supported|needs_evidence|discarded",'
    '"confidence":"low|medium|high","note":"<one sentence: what you rejected, or what '
    'convinced you>"}.'
)


# --- json helpers -----------------------------------------------------------

def _parse(raw: str):
    """Parse a model response into JSON, tolerating fences and narration."""
    if not raw:
        return None
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    snippet = _extract_json_block(cleaned)
    if snippet is None:
        return None
    try:
        return json.loads(snippet)
    except json.JSONDecodeError:
        return None


def _str(value, limit: int = 400) -> str:
    return " ".join(str(value or "").split())[:limit]


def _str_list(value, limit: int = 5) -> list[str]:
    if isinstance(value, str):
        value = [p.strip() for p in value.split(";")]
    if not isinstance(value, list):
        return []
    out = [_str(v, 300) for v in value]
    return [v for v in out if v][:limit]


# --- retrieval --------------------------------------------------------------

def _retrieve(db_name: str, query: str, limit: int = 8) -> list[dict]:
    """Evidence for ONE node, retrieved for that node's own question.

    Uses ``chunks_repo.hybrid_search`` with an explicit tenant connection.
    ``src.search.search()`` would be the obvious call, but it omits ``conn`` and
    so reads the default demo brain database — from the multi-tenant swarm that
    is a cross-tenant read.
    """
    from src.db import chunks as chunks_repo
    from src.ingestion.index import embeddings

    q = " ".join((query or "").split())[:300]
    if not q:
        return []
    try:
        q_vec = embeddings.embed_one_query(q)
        if not q_vec:
            return []
        with get_tenant_connection(db_name) as conn:
            rows = chunks_repo.hybrid_search(q, q_vec, limit=limit, conn=conn)
    except Exception:
        log.exception("swarm retrieval failed")
        return []

    out = []
    for r in rows:
        ent = r.get("entity") or {}
        source = " · ".join(
            x for x in (ent.get("name"), r.get("section") or r.get("page_path")) if x
        )
        out.append(
            {
                "text": " ".join((r.get("text") or "").split()),
                "source": source or "brain",
                "page_path": r.get("page_path"),
            }
        )
    return out


def _evidence_block(items: list[dict], excerpt: int = 600) -> str:
    """Number the excerpts so the agents can cite them by index."""
    if not items:
        return "(nothing in the brain matches this yet)"
    return "\n".join(
        f"[{i}] ({e['source']}) {e['text'][:excerpt]}" for i, e in enumerate(items)
    )


def _cited(indices, items: list[dict]) -> list[dict]:
    """Resolve cited indices to evidence, silently dropping hallucinated ones."""
    picked: list[dict] = []
    seen: set[int] = set()
    for raw in indices if isinstance(indices, list) else []:
        try:
            i = int(raw)
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(items) and i not in seen:
            seen.add(i)
            picked.append(items[i])
    return picked


# --- event log --------------------------------------------------------------

def _insert_run(db_name: str, snapshot: dict) -> int:
    from psycopg.types.json import Jsonb

    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO swarm_runs (status, objective_snapshot) "
            "VALUES ('running', %s) RETURNING id;",
            (Jsonb(snapshot),),
        )
        return cur.fetchone()[0]


def _mark_run(db_name: str, run_id: int, status: str) -> None:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE swarm_runs SET status = %s, stopped_at = now() WHERE id = %s;",
            (status, run_id),
        )


def _emit(db_name, run_id, role, kind, message, *, node_id=None, status=None):
    """Append one Activity-log row. ``node_id`` deep-links a line to a tree node."""
    try:
        with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_events (run_id, role, kind, message, node_id, status) "
                "VALUES (%s, %s, %s, %s, %s, %s);",
                (run_id, role, kind, message, str(node_id) if node_id else None, status),
            )
    except Exception:
        log.exception("swarm emit failed")


# --- the agents -------------------------------------------------------------

class _Budget:
    """The circuit breaker on one pass's LLM spend."""

    def __init__(self, limit: int = MAX_LLM_CALLS):
        self.limit = limit
        self.used = 0
        self.by_role: dict[str, int] = {}

    def take(self, role: str) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        self.by_role[role] = self.by_role.get(role, 0) + 1
        return True


def _ask(prompt: str, user: str, *, role: str, org_id: int | None, budget: _Budget,
         max_tokens: int):
    """One agent call. Returns parsed JSON, or None when unavailable/unusable.

    The model is resolved per role (``LLM_MODEL_DECOMPOSITION`` etc.), falling
    back to LLM_BASE_MODEL — the roles are not equally hard, and decomposition
    and judgement are the two that visibly suffer on a cheap model.
    """
    if not llm.enabled() or not budget.take(role):
        return None
    try:
        return _parse(
            llm.call(
                prompt, user,
                max_tokens=max_tokens, org_id=org_id, agent_name=role,
                model=config.model_for_role(role),
            )
        )
    except metering.CreditLimitExceeded:
        raise
    except Exception as exc:
        log.warning("swarm %s call failed: %s", role, exc)
        return None


def _frame(brief: str, org_id: int | None, budget: _Budget) -> str:
    data = _ask(P_FRAME, f"PROGRAM\n{brief}", role="framer", org_id=org_id,
                budget=budget, max_tokens=300)
    if isinstance(data, dict) and data.get("headline"):
        return _str(data["headline"], 300)
    return ""


def _decompose(brief, headline, path, node, evidence, org_id, budget) -> dict:
    user = (
        f"PROGRAM\n{brief}\n\n"
        f"OBJECTIVE (the root of the tree)\n{headline}\n\n"
        f"PATH FROM THE ROOT TO THIS NODE\n{path}\n\n"
        f"THE NODE TO CUT\n{node}\n\n"
        f"EVIDENCE\n{_evidence_block(evidence)}\n\n"
        "Cut the node above into MECE branches."
    )
    data = _ask(P_DECOMPOSE, user, role="decomposition", org_id=org_id, budget=budget,
                max_tokens=900)
    branches = []
    mece_note = ""
    if isinstance(data, dict):
        mece_note = _str(data.get("mece_note"), 300)
        raw = data.get("branches")
        for b in raw if isinstance(raw, list) else []:
            if not isinstance(b, dict) or not _str(b.get("label"), 120):
                continue
            branches.append(
                {
                    "label": _str(b.get("label"), 120),
                    "rationale": _str(b.get("rationale"), 500),
                    "evidence": _cited(b.get("evidence"), evidence),
                    "terminal": bool(b.get("terminal")),
                }
            )
    return {"mece_note": mece_note, "branches": branches[:MAX_BRANCHES_PER_NODE]}


def _initiatives(brief, branch, evidence, org_id, budget) -> list[dict]:
    user = (
        f"PROGRAM\n{brief}\n\n"
        f"BRANCH\n{branch}\n\n"
        f"EVIDENCE\n{_evidence_block(evidence)}\n\n"
        "Propose the concrete initiatives for this branch."
    )
    data = _ask(P_INITIATIVE, user, role="initiative", org_id=org_id, budget=budget,
                max_tokens=700)
    out = []
    raw = data.get("initiatives") if isinstance(data, dict) else None
    for i in raw if isinstance(raw, list) else []:
        if not isinstance(i, dict) or not _str(i.get("name"), 160):
            continue
        out.append({"name": _str(i.get("name"), 160), "context": _str(i.get("context"), 700)})
    return out[:MAX_INITIATIVES_PER_BRANCH]


def _validate(initiative, evidence, org_id, budget) -> dict:
    user = (
        f"INITIATIVE\n{initiative['name']}. {initiative['context']}\n\n"
        f"EVIDENCE\n{_evidence_block(evidence)}\n\n"
        "Does the firm's own evidence support this?"
    )
    data = _ask(P_VALID, user, role="validator", org_id=org_id, budget=budget,
                max_tokens=800)
    facts: list[dict] = []
    if isinstance(data, dict):
        raw = data.get("facts")
        for f in raw if isinstance(raw, list) else []:
            if not isinstance(f, dict):
                continue
            text = _str(f.get("text"), 500)
            if not text:
                continue
            cited = _cited([f.get("evidence")], evidence)
            src = cited[0] if cited else None
            facts.append(
                {
                    "text": text,
                    "source": src["source"] if src else None,
                    "page_path": src["page_path"] if src else None,
                }
            )
        return {
            "supported": bool(data.get("supported")),
            "facts": facts[:4],
            "reasoning": _str(data.get("reasoning"), 400),
        }
    return {"supported": False, "facts": [], "reasoning": ""}


def _plan(brief, initiative, validation, org_id, budget) -> dict:
    user = (
        f"PROGRAM\n{brief}\n\n"
        f"INITIATIVE\n{initiative['name']}. {initiative['context']}\n\n"
        f"WHAT THE EVIDENCE ESTABLISHES\n{validation.get('reasoning') or '(nothing yet)'}\n\n"
        "Work out what would need to be true, how it could be sized, and the next steps."
    )
    data = _ask(P_PLAN, user, role="planning", org_id=org_id, budget=budget,
                max_tokens=800)
    if isinstance(data, dict):
        return {
            "what_must_be_true": _str_list(data.get("what_must_be_true"), 4),
            "sizing_approach": _str(data.get("sizing_approach"), 600),
            "next_steps": _str_list(data.get("next_steps"), 4),
        }
    return {"what_must_be_true": [], "sizing_approach": "", "next_steps": []}


def _size(brief, obj, initiative, validation, plan, org_id, budget) -> dict:
    facts = "\n".join(f"- {f['text']}" for f in validation.get("facts", [])) or "(none)"
    user = (
        f"PROGRAM\n{brief}\n\n"
        f"INITIATIVE\n{initiative['name']}. {initiative['context']}\n\n"
        f"GROUNDED FACTS\n{facts}\n\n"
        f"HOW THE PLANNER WOULD SIZE IT\n{plan.get('sizing_approach') or '(not stated)'}\n\n"
        "Put a number on it, in the program's unit."
    )
    data = _ask(P_SIZE, user, role="sizer", org_id=org_id, budget=budget, max_tokens=500)
    if not isinstance(data, dict):
        return {}
    amount = data.get("amount")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None
    impact_type = data.get("impact_type")
    year = data.get("run_rate_year")
    try:
        year = int(year) if year else None
    except (TypeError, ValueError):
        year = None
    return {
        "value_amount": amount,
        "value_currency": _str(data.get("currency"), 8) or obj.currency,
        "value_type": impact_type if impact_type in ("recurring", "one_time") else obj.impact_type,
        "value_year": year or obj.run_rate_year,
        "value_basis": _str(data.get("basis"), 600),
        "confidence": data.get("confidence") if data.get("confidence") in ("low", "medium", "high") else None,
        "feasible_by_end": bool(data["feasible_by_end"]) if "feasible_by_end" in data else None,
    }


def _judge(brief, initiative, validation, plan, sizing, org_id, budget) -> dict:
    user = (
        f"PROGRAM\n{brief}\n\n"
        f"INITIATIVE\n{initiative['name']}. {initiative['context']}\n\n"
        f"VALIDATOR\nsupported={validation.get('supported')} — {validation.get('reasoning')}\n"
        f"facts: {len(validation.get('facts', []))}\n\n"
        f"WHAT MUST BE TRUE\n{'; '.join(plan.get('what_must_be_true') or []) or '(none)'}\n\n"
        f"SIZER\n{sizing.get('value_amount')} {sizing.get('value_currency')} "
        f"{sizing.get('value_type')} — {sizing.get('value_basis')}\n\n"
        "Return the final verdict."
    )
    data = _ask(P_JUDGE, user, role="judge", org_id=org_id, budget=budget, max_tokens=400)
    verdict = None
    if isinstance(data, dict):
        v = data.get("verdict")
        if v in (tree.STATUS_SUPPORTED, tree.STATUS_NEEDS_EVIDENCE, tree.STATUS_DISCARDED):
            verdict = v
        return {
            "verdict": verdict or _fallback_verdict(validation),
            "confidence": data.get("confidence") if data.get("confidence") in ("low", "medium", "high") else None,
            "note": _str(data.get("note"), 400),
        }
    return {"verdict": _fallback_verdict(validation), "confidence": None, "note": ""}


def _fallback_verdict(validation: dict) -> str:
    """Without a usable judgement, an unproven initiative is 'needs evidence'.

    Never 'supported' — defaulting to the optimistic verdict is exactly the kind
    of unearned confidence the Judge exists to prevent.
    """
    return tree.STATUS_SUPPORTED if validation.get("supported") and validation.get("facts") else tree.STATUS_NEEDS_EVIDENCE


# --- heuristic fallbacks (no LLM key, or every call failed) ------------------

def _fallback_branches(obj) -> list[dict]:
    """Cut the objective by the user's own ranked levers.

    Not MECE in any rigorous sense, but it is honest about where it came from
    and it keeps the tree renderable with no model available.
    """
    labels = obj.ranked_labels()[:MAX_BRANCHES_PER_NODE] or ["Revenue", "Cost", "Retention"]
    return [
        {
            "label": lab,
            "rationale": f"A ranked priority on the Objectives tab (#{i + 1}).",
            "evidence": [],
            "terminal": True,
        }
        for i, lab in enumerate(labels)
    ]


# --- the loop ---------------------------------------------------------------

async def _loop(db_name: str, run_id: int, org: str, org_id: int | None) -> None:
    budget = _Budget()

    async def emit(*a, **k):
        await asyncio.get_running_loop().run_in_executor(
            None, partial(_emit, db_name, run_id, *a, **k)
        )

    async def call(fn, *a, **kw):
        return await asyncio.get_running_loop().run_in_executor(
            None, partial(fn, *a, **kw)
        )

    try:
        mode = "LLM agents" if llm.enabled() else "heuristic agents (no LLM key)"
        await emit("system", "log", f"Swarm started for {org} · {mode}. Reading the objective…")

        with get_tenant_connection(db_name) as conn:
            obj = objective_repo.get_objective(conn)
        brief = objective_repo.describe(obj)
        await emit("system", "log", f"Objective function → {brief}")

        # 1. the headline: the sentence that roots the tree.
        headline = obj.headline.strip()
        if not headline:
            headline = await call(_frame, brief, org_id, budget)
            if headline:
                with get_tenant_connection(db_name) as conn:
                    objective_repo.set_headline(conn, headline, source="agent")
                await emit("framer", "log", f"Objective compressed → {headline}")
        if not headline:
            headline = objective_repo.readback(obj)

        # 2. the root.
        with get_tenant_connection(db_name) as conn:
            root_id = tree.add_node(
                conn, run_id=run_id, kind=tree.KIND_OBJECTIVE, label=headline,
                rationale=brief,
            )
            # The program itself is the root's evidence — so even the root shows
            # what it was derived from rather than appearing out of thin air.
            tree.add_evidence(conn, root_id, _objective_evidence(obj))
        await emit("system", "node", f"Objective: {headline}", node_id=root_id)

        # 3. breadth-first MECE decomposition.
        frontier = [{"id": root_id, "label": headline, "depth": 0, "path": headline}]
        leaves: list[dict] = []
        branch_count = 0

        while frontier:
            node = frontier.pop(0)
            if node["depth"] >= MAX_BRANCH_DEPTH or branch_count >= MAX_BRANCH_NODES:
                if node["depth"] > 0:
                    leaves.append(node)
                continue

            query = f"{node['label']} {obj.metric_label}"
            evidence = await call(_retrieve, db_name, query, 8)
            await emit("decomposition", "log", f"Cutting: {node['label']}")

            result = await call(
                _decompose, brief, headline, node["path"], node["label"], evidence,
                org_id, budget,
            )
            branches = result["branches"]
            if not branches and node["depth"] == 0:
                branches = _fallback_branches(obj)
                await emit("decomposition", "log",
                           "No model available — cut the objective by its ranked levers.")

            if result["mece_note"]:
                with get_tenant_connection(db_name) as conn:
                    tree.set_mece_note(conn, node["id"], result["mece_note"])

            if not branches:
                leaves.append(node)
                continue

            for order, b in enumerate(branches):
                if branch_count >= MAX_BRANCH_NODES:
                    break
                with get_tenant_connection(db_name) as conn:
                    child_id = tree.add_node(
                        conn, run_id=run_id, parent_id=node["id"], kind=tree.KIND_BRANCH,
                        label=b["label"], rationale=b["rationale"], sort_order=order,
                    )
                    picked = b["evidence"] or evidence[:2]
                    tree.add_evidence(
                        conn, child_id,
                        [tree.Evidence(text=e["text"], source=e["source"],
                                       page_path=e["page_path"]) for e in picked],
                    )
                branch_count += 1
                await emit("decomposition", "node",
                           f"Branch · {b['label']} — {b['rationale']}", node_id=child_id)

                child = {
                    "id": child_id, "label": b["label"], "depth": node["depth"] + 1,
                    "path": f"{node['path']} → {b['label']}",
                }
                if b["terminal"] or child["depth"] >= MAX_BRANCH_DEPTH:
                    leaves.append(child)
                else:
                    frontier.append(child)

        # 4. initiatives on every leaf branch.
        initiative_count = 0
        for leaf in leaves[:MAX_LEAF_BRANCHES]:
            if initiative_count >= MAX_INITIATIVES:
                break
            evidence = await call(_retrieve, db_name, leaf["label"], 8)
            proposed = await call(_initiatives, brief, leaf["label"], evidence, org_id, budget)
            if not proposed:
                continue

            for order, init in enumerate(proposed):
                if initiative_count >= MAX_INITIATIVES:
                    break
                await emit("initiative", "log", f"Initiative · {init['name']}")

                # Retrieve for the initiative itself, not its branch.
                iev = await call(_retrieve, db_name, f"{init['name']}. {init['context']}", 6)
                validation = await call(_validate, init, iev, org_id, budget)
                plan = await call(_plan, brief, init, validation, org_id, budget)
                sizing = await call(_size, brief, obj, init, validation, plan, org_id, budget)
                verdict = await call(_judge, brief, init, validation, plan, sizing, org_id, budget)

                facts = validation.get("facts") or []
                status = verdict["verdict"]
                if not facts:
                    # Nothing grounded it — it cannot be 'supported' whatever the
                    # Judge said.
                    status = tree.STATUS_NEEDS_EVIDENCE

                with get_tenant_connection(db_name) as conn:
                    node_id = tree.add_node(
                        conn, run_id=run_id, parent_id=leaf["id"],
                        kind=tree.KIND_INITIATIVE, label=init["name"],
                        status=status, sort_order=order,
                    )
                    tree.add_evidence(
                        conn, node_id,
                        [tree.Evidence(text=f["text"], source=f["source"],
                                       page_path=f["page_path"]) for f in facts]
                        or [tree.Evidence(text=e["text"], source=e["source"],
                                          page_path=e["page_path"]) for e in iev[:2]],
                    )
                    # Both the Sizer and the Judge express a confidence. The
                    # Judge's is the one that ships: it covers the whole card,
                    # not just whether the arithmetic held up.
                    card_fields = {k: v for k, v in sizing.items() if v is not None}
                    card_fields.update(
                        context=init["context"],
                        sizing_approach=plan.get("sizing_approach"),
                        what_must_be_true=plan.get("what_must_be_true"),
                        next_steps=plan.get("next_steps"),
                    )
                    if verdict.get("confidence"):
                        card_fields["confidence"] = verdict["confidence"]
                    tree.upsert_card(conn, node_id, **card_fields)
                initiative_count += 1

                for f in facts:
                    await emit("validator", "fact", f"Evidence: {f['text']}", node_id=node_id)
                if sizing.get("value_amount"):
                    await emit("sizer", "log",
                               f"Sized at {sizing['value_amount']:,.0f} "
                               f"{sizing.get('value_currency')} — {sizing.get('value_basis')}",
                               node_id=node_id)
                await emit("judge", "node",
                           f"Judge: {status.replace('_', ' ')}" +
                           (f" — {verdict['note']}" if verdict.get("note") else ""),
                           node_id=node_id, status=status)

        # 5. roll branch status up from the initiatives beneath it.
        await call(_roll_up, db_name, run_id)

        if budget.used >= budget.limit:
            await emit("system", "log",
                       f"Reached the {budget.limit}-call budget for one pass — "
                       "stopped expanding the tree.")
        await emit("system", "log",
                   f"Pass complete · {branch_count} branches, {initiative_count} initiatives, "
                   f"{budget.used} agent calls.")
        await call(_mark_run, db_name, run_id, "complete")

    except metering.CreditLimitExceeded:
        await emit("system", "log",
                   "Swarm paused — this workspace is out of credits. Top up to continue.")
        await call(_mark_run, db_name, run_id, "stopped")
    except asyncio.CancelledError:
        await emit("system", "log", "Swarm stopped by operator.")
        raise
    except Exception:
        log.exception("swarm loop failed")
        await emit("system", "log", "Swarm hit an error and paused.")
        await call(_mark_run, db_name, run_id, "stopped")


def _objective_evidence(obj) -> list:
    """The program restated as evidence rows for the root node."""
    from src.db.objective import _fmt_amount

    rows = []
    if obj.baseline_amount is not None:
        rows.append(tree.Evidence(
            text=f"Baseline {obj.metric_label}: {_fmt_amount(obj.baseline_amount, obj.currency)}.",
            source="Objectives tab", kind="objective"))
    target = obj.resolved_target()
    if target is not None:
        kind = "recurring run-rate" if obj.impact_type == "recurring" else "one-time"
        rows.append(tree.Evidence(
            text=f"Target: {_fmt_amount(target, obj.currency)} of {obj.metric_label} "
                 f"as a {kind} impact.",
            source="Objectives tab", kind="objective"))
    if obj.program_end_date:
        rows.append(tree.Evidence(
            text=f"The run-rate must be in place by {obj.program_end_date.isoformat()}"
                 + (f" (FY{obj.run_rate_year})." if obj.run_rate_year else "."),
            source="Objectives tab", kind="objective"))
    labels = obj.ranked_labels()
    if labels:
        ranked = "; ".join(f"{i + 1}. {lab}" for i, lab in enumerate(labels))
        rows.append(tree.Evidence(
            text=f"Ranked value levers: {ranked}.", source="Objectives tab", kind="objective"))
    if obj.reporting_cadence:
        rows.append(tree.Evidence(
            text=f"Impact is reviewed {obj.reporting_cadence}.",
            source="Objectives tab", kind="objective"))
    return rows


def _roll_up(db_name: str, run_id: int) -> None:
    """Derive every branch's status from the initiatives beneath it.

    Cheaper and more consistent than asking a model: a branch is supported if
    anything under it is, needs evidence if anything under it does, and is only
    discarded when everything under it was.
    """
    with get_tenant_connection(db_name) as conn:
        nodes = tree.read_tree(conn, run_id)
        by_parent: dict[int | None, list[dict]] = {}
        for n in nodes:
            by_parent.setdefault(n["parent_id"], []).append(n)

        def resolve(node: dict) -> str:
            kids = by_parent.get(node["id"], [])
            if not kids:
                return node["status"]
            statuses = {resolve(k) for k in kids}
            for candidate in (tree.STATUS_SUPPORTED, tree.STATUS_NEEDS_EVIDENCE,
                              tree.STATUS_INVESTIGATING):
                if candidate in statuses:
                    return candidate
            return tree.STATUS_DISCARDED

        for n in nodes:
            if n["kind"] == tree.KIND_INITIATIVE:
                continue
            status = resolve(n)
            if status != n["status"]:
                tree.set_status(conn, n["id"], status)


# --- control surface --------------------------------------------------------

def is_running(db_name: str) -> bool:
    entry = _runs.get(db_name)
    return bool(entry and not entry["task"].done())


def _role_calls(db_name: str, run_id: int | None) -> dict[str, int]:
    """How many log lines each role actually produced on this run."""
    if run_id is None:
        return {}
    try:
        with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT role, count(*) FROM agent_events WHERE run_id = %s GROUP BY role;",
                (run_id,),
            )
            return {r[0]: r[1] for r in cur.fetchall()}
    except Exception:
        return {}


def status(db_name: str) -> dict:
    running = is_running(db_name)
    run_id = _runs.get(db_name, {}).get("run_id")
    if run_id is None:
        with get_tenant_connection(db_name) as conn:
            run_id = tree.latest_run_id(conn)
    calls = _role_calls(db_name, run_id)
    roles = [{**r, "calls": calls.get(r["key"], 0)} for r in ROLES]
    return {
        "running": running,
        "run_id": run_id,
        "total": sum(calls.values()),
        "roles": roles,
    }


async def start(db_name: str, org: str, org_id: int | None = None) -> dict:
    """Start one diagnostic pass. Only ever one run per tenant."""
    await stop(db_name)
    loop = asyncio.get_running_loop()

    with get_tenant_connection(db_name) as conn:
        obj = objective_repo.get_objective(conn)
    snapshot = {
        "headline": obj.headline,
        "impact_metric": obj.impact_metric,
        "metric_label": obj.metric_label,
        "impact_type": obj.impact_type,
        "currency": obj.currency,
        "resolved_target": float(obj.resolved_target()) if obj.resolved_target() is not None else None,
        "run_rate_year": obj.run_rate_year,
        "program_end_date": obj.program_end_date.isoformat() if obj.program_end_date else None,
        "reporting_cadence": obj.reporting_cadence,
    }
    run_id = await loop.run_in_executor(None, partial(_insert_run, db_name, snapshot))

    task = asyncio.create_task(_loop(db_name, run_id, org, org_id))
    _runs[db_name] = {"task": task, "run_id": run_id}
    return status(db_name)


async def stop(db_name: str) -> dict:
    entry = _runs.pop(db_name, None)
    if entry:
        entry["task"].cancel()
        try:
            await entry["task"]
        except (asyncio.CancelledError, Exception):
            pass
        await asyncio.get_running_loop().run_in_executor(
            None, partial(_mark_run, db_name, entry["run_id"], "stopped")
        )
    return status(db_name)


# --- reads for the API ------------------------------------------------------

def get_log(db_name: str, since: int = 0, limit: int = 200) -> dict:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        run_id = tree.latest_run_id(conn)
        if run_id is None:
            return {"events": [], "run_id": None, "running": is_running(db_name)}
        cur.execute(
            "SELECT id, extract(epoch FROM ts), role, kind, message, node_id, status "
            "FROM agent_events WHERE run_id = %s AND id > %s ORDER BY id DESC LIMIT %s;",
            (run_id, since, limit),
        )
        events = [
            {
                "id": r[0], "ts": r[1], "role": r[2], "kind": r[3], "message": r[4],
                "node_id": r[5], "status": r[6], "metric": None,
            }
            for r in cur.fetchall()
        ]
    return {"events": events, "run_id": run_id, "running": is_running(db_name)}


def get_tree(db_name: str) -> dict:
    """The whole tree of the latest run, flat, with the objective it was run against.

    Flat rather than nested: the canvas lays out from a flat list anyway, and a
    flat array stays stable to diff while a run streams new nodes in.
    """
    with get_tenant_connection(db_name) as conn:
        run_id = tree.latest_run_id(conn)
        if run_id is None:
            return {"run_id": None, "running": is_running(db_name), "objective": None,
                    "coverage": None, "nodes": []}
        nodes = tree.read_tree(conn, run_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT objective_snapshot, status FROM swarm_runs WHERE id = %s;",
                (run_id,),
            )
            row = cur.fetchone()

    snapshot = (row[0] if row else None) or {}
    run_status = row[1] if row else None
    # Coverage is measured against the objective THIS run was started with, not
    # the live one — editing the goal afterwards must not rewrite what a finished
    # run is claimed to have covered.
    cov = tree.coverage(nodes, impact_type=snapshot.get("impact_type") or "recurring")
    cov["target"] = snapshot.get("resolved_target")

    return {
        "run_id": run_id,
        "running": is_running(db_name),
        "status": run_status,
        "objective": snapshot or None,
        "coverage": cov,
        "nodes": nodes,
    }
