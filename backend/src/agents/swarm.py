"""The agent swarm: a startable/stoppable loop that reads a tenant's brain and
investigates where value is leaking, logging everything it does.

Each role (hypothesis generation, planning, validator, opportunity sizer, judge)
is an LLM call with its own system prompt (see the ``P_*`` constants), grounded
in the objective function and the real brain context (entities + chunk text).
When no LLM key is configured — or a call fails — each role falls back to a
deterministic heuristic so the loop always makes progress.

The loop appends to ``agent_events``; the Overview builds a live log and a
hypothesis tree from those rows. One in-process asyncio task drives the loop per
tenant DB; because the API runs a single uvicorn worker, that in-memory task is
authoritative for "is it running", not a DB flag that could go stale.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import partial

from src import config
from src.db.connection import get_tenant_connection

log = logging.getLogger("iota.swarm")

# The roles the swarm runs, and how many instances of each are live when running.
ROLES = [
    {
        "key": "hypothesis",
        "name": "Hypothesis generation",
        "instances": 2,
        "desc": "Reads the hypothesis tree — including what was discarded and why — and proposes the next ones worth testing, weighted by the objective function.",
    },
    {
        "key": "planning",
        "name": "Planning",
        "instances": 5,
        "desc": 'Asks "what would need to be true for this to hold?" and works out which data and facts would confirm or kill it. Outputs a step-by-step validation plan.',
    },
    {
        "key": "validator",
        "name": "Validator",
        "instances": 8,
        "desc": "Gathers the required facts and data from the brain — and later, interviews — and runs the plan to validate or discard the hypothesis.",
    },
    {
        "key": "sizer",
        "name": "Opportunity sizer",
        "instances": 4,
        "desc": "Puts a number on each validated opportunity — the recoverable value, sized from the facts the Validator gathered.",
    },
    {
        "key": "judge",
        "name": "Judge",
        "instances": 3,
        "desc": "Sense-checks every output of every other agent, catching weak evidence, logical leaps, and hallucinations before they propagate.",
    },
]

# TODO: read this from the persisted Objectives tab; hardcoded default for now.
DEFAULT_OBJECTIVE = (
    "Prioritize, in order: (1) gross margin, (2) cost reduction, "
    "(3) automation of manual/repetitive work."
)

# db_name -> {"task": asyncio.Task, "run_id": int}
_runs: dict[str, dict] = {}


# --- system prompts (one per agent role) ------------------------------------

P_HYPO = (
    "You are the Hypothesis Generation agent in a swarm of AI consultants running a "
    "corporate diagnostic for a company. From the objective function and the context "
    "the firm has already ingested (people, companies, projects, and excerpts from "
    "their emails and files), propose the most promising, TESTABLE hypotheses about "
    "where value is leaking or could be created. Weight them by the objective "
    "function. Each hypothesis must be specific, falsifiable, and worth a partner's "
    "time — not a platitude. Do not repeat hypotheses already discarded. "
    'Return STRICT JSON only: {"hypotheses":[{"label":"<one concrete sentence>",'
    '"rationale":"<one sentence why>"}]}. Give 2 to 4 hypotheses.'
)

P_PLAN = (
    'You are the Planning agent. Given one hypothesis, ask "what would need to be '
    'true for this to hold?" and lay out the concrete steps to validate or kill it: '
    "which data, documents, metrics, or interviews are needed, in order. Be specific "
    'and testable. Return STRICT JSON only: {"steps":["<step>"]}. Give 3 to 5 steps.'
)

P_VALID = (
    "You are the Validator agent. You are given a hypothesis and the evidence "
    "available in the firm's brain (excerpts from emails, files, and entity notes). "
    "Decide, using ONLY the evidence provided, whether it supports the hypothesis. "
    "NEVER invent facts or numbers. Extract the specific supporting facts, grounded "
    "in and citing the source. If the evidence is insufficient, set supported to "
    'false. Return STRICT JSON only: {"supported":true|false,"facts":[{"text":'
    '"<grounded fact>","source":"<source>"}],"reasoning":"<one sentence>"}.'
)

P_SIZE = (
    "You are the Opportunity Sizer agent. Given a validated hypothesis and its "
    "supporting facts, estimate the recoverable annual value in euros with a rough "
    "but defensible basis. If the facts don't support a firm number, give a "
    "conservative estimate and flag the assumption. Return STRICT JSON only: "
    '{"metric":"€<n>M (est.)","basis":"<one sentence>"}.'
)

P_JUDGE = (
    "You are the Judge agent. You sense-check the other agents. Given the hypothesis, "
    "the Validator's finding, and the Sizer's estimate, decide the final verdict. Be "
    "skeptical: reject weak evidence, logical leaps, and unsupported numbers. Verdict "
    'is exactly one of "supported" (evidence is solid), "needs_evidence" (plausible '
    'but unproven — needs an interview or more data), or "discarded" (contradicted or '
    'baseless). Return STRICT JSON only: {"verdict":"supported|needs_evidence|'
    'discarded","note":"<one sentence>"}.'
)


# --- LLM plumbing -----------------------------------------------------------

def _llm_on() -> bool:
    return bool(config.LLM_BASE_API_KEY and config.LLM_BASE_BASE_URL and config.LLM_BASE_MODEL)


def _llm(system: str, user: str, max_tokens: int = 600) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=config.LLM_BASE_API_KEY, base_url=config.LLM_BASE_BASE_URL)
    resp = client.chat.completions.create(
        model=config.LLM_BASE_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def _extract(raw: str):
    """Best-effort parse of a model response into JSON (object or array).

    Handles ```json fences and leading/trailing prose. Returns None on failure.
    """
    if not raw:
        return None
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S).strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    m = re.search(r"(\{.*\}|\[.*\])", s, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _first_list(data):
    """The list payload from a model response, whether it came back as a bare
    array, under a known key, or under any other key."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return next((v for v in data.values() if isinstance(v, list)), None)
    return None


# --- brain reads (sync; called via run_in_executor) -------------------------

def _read_brain(db_name: str) -> dict:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, type, name FROM entities ORDER BY id;")
        ents = cur.fetchall()
        cur.execute("SELECT text, section, page_path, entity_id FROM chunks ORDER BY id;")
        chunks = cur.fetchall()
    ent_name = {i: n for (i, _t, n) in ents}
    evidence = []
    for text, section, page, eid in chunks:
        who = ent_name.get(eid)
        src = section or page or "brain"
        evidence.append({
            "text": " ".join((text or "").split()),
            "source": f"{who} · {src}" if who else src,
        })
    return {
        "entities": [f"{t}: {n}" for (_i, t, n) in ents],
        "companies": [n for (_i, t, n) in ents if t == "company"],
        "evidence": evidence,
    }


def _evidence_blob(evidence: list[dict], limit: int = 4000) -> str:
    out = []
    for e in evidence:
        out.append(f"- ({e['source']}) {e['text']}")
    blob = "\n".join(out)
    return blob[:limit] if blob else "(no evidence ingested yet)"


def _size_heuristic(idx: int, n_facts: int) -> str:
    return f"€{0.4 + (idx % 5) * 0.3 + n_facts * 0.5:.1f}M (est.)"


def _read_objective(db_name: str) -> dict | None:
    """The objective function set on the Objectives tab, or None if unset."""
    try:
        with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
            cur.execute("SELECT priorities, context FROM objective_function WHERE id = 1;")
            row = cur.fetchone()
    except Exception:
        return None
    if not row:
        return None
    return {"priorities": row[0] or [], "context": row[1] or ""}


def _format_objective(obj: dict | None) -> str:
    """Turn the stored objective into a prompt-ready instruction string."""
    if not obj:
        return DEFAULT_OBJECTIVE
    labels = [p.get("label") for p in obj.get("priorities", []) if p.get("label")]
    parts = []
    if labels:
        ranked = "; ".join(f"{i + 1}. {lab}" for i, lab in enumerate(labels))
        parts.append(f"Optimize for, in priority order (most important first): {ranked}.")
    ctx = (obj.get("context") or "").strip()
    if ctx:
        parts.append(f"Client context to respect: {ctx}")
    return " ".join(parts) if parts else DEFAULT_OBJECTIVE


# --- agent roles (LLM with heuristic fallback) ------------------------------

def _gen_hypotheses(org: str, brain: dict, objective: str) -> list[dict]:
    if _llm_on():
        user = (
            f"Organization: {org}\nObjective function: {objective}\n\n"
            f"Entities in the brain:\n" + "\n".join(brain["entities"][:40]) +
            f"\n\nEvidence excerpts:\n{_evidence_blob(brain['evidence'])}\n\n"
            "Propose the hypotheses that best serve the objective function above."
        )
        for _ in range(2):  # one retry — the model's JSON is occasionally flaky
            try:
                hs = _first_list(_extract(_llm(P_HYPO, user, 800)))
            except Exception:
                log.exception("hypothesis LLM failed; falling back")
                break
            out = [
                {"label": (h.get("label") or "").strip(), "rationale": (h.get("rationale") or "").strip()}
                for h in (hs or []) if isinstance(h, dict) and (h.get("label") or "").strip()
            ]
            if out:
                return out[:4]
    return [
        {"label": f"Value is leaking around {c}", "rationale": "Derived from the brain (LLM unavailable)."}
        for c in brain["companies"]
    ] or [{"label": f"Where is value leaking at {org}?", "rationale": ""}]


def _plan(hypothesis: str, objective: str) -> list[str]:
    if _llm_on():
        try:
            raw = _first_list(_extract(_llm(P_PLAN, f"Objective: {objective}\nHypothesis: {hypothesis}", 400)))
            steps = [s.strip() for s in (raw or []) if isinstance(s, str) and s.strip()]
            if steps:
                return steps[:5]
        except Exception:
            log.exception("planning LLM failed; falling back")
    return [
        "Pull every mention of the subject from the brain.",
        "Look for discounting, manual rework, and cost leakage.",
        "Quantify the €-impact from whatever evidence turns up.",
    ]


def _validate(hypothesis: str, brain: dict) -> dict:
    if _llm_on():
        try:
            user = (
                f"Hypothesis: {hypothesis}\n\nEvidence available in the brain:\n"
                f"{_evidence_blob(brain['evidence'])}"
            )
            data = _extract(_llm(P_VALID, user, 700)) or {}
            if isinstance(data, dict) and "supported" in data:
                facts = [
                    {"text": (f.get("text") or "").strip(), "source": (f.get("source") or "brain").strip()}
                    for f in (data.get("facts") or []) if (f.get("text") or "").strip()
                ]
                return {
                    "supported": bool(data.get("supported")),
                    "facts": facts[:4],
                    "reasoning": (data.get("reasoning") or "").strip(),
                }
        except Exception:
            log.exception("validator LLM failed; falling back")
    # heuristic: surface up to 2 real excerpts as facts
    facts = [{"text": e["text"][:180], "source": e["source"]} for e in brain["evidence"][:2]]
    return {"supported": bool(facts), "facts": facts, "reasoning": "Heuristic retrieval (LLM unavailable)."}


def _size(hypothesis: str, facts: list[dict], objective: str, idx: int) -> dict:
    if _llm_on() and facts:
        try:
            fblob = "\n".join(f"- ({f['source']}) {f['text']}" for f in facts) or "(none)"
            user = f"Objective: {objective}\nHypothesis: {hypothesis}\nSupporting facts:\n{fblob}"
            data = _extract(_llm(P_SIZE, user, 200)) or {}
            metric = (data.get("metric") or "").strip() if isinstance(data, dict) else ""
            if metric:
                return {"metric": metric, "basis": (data.get("basis") or "").strip()}
        except Exception:
            log.exception("sizer LLM failed; falling back")
    return {"metric": _size_heuristic(idx, len(facts)), "basis": ""}


def _judge(hypothesis: str, validation: dict, sizing: dict) -> dict:
    if _llm_on():
        try:
            user = (
                f"Hypothesis: {hypothesis}\n"
                f"Validator: supported={validation.get('supported')}; "
                f"reasoning={validation.get('reasoning')}; "
                f"facts={[f['text'] for f in validation.get('facts', [])]}\n"
                f"Sizer: {sizing.get('metric')} — {sizing.get('basis')}"
            )
            data = _extract(_llm(P_JUDGE, user, 200)) or {}
            verdict = (data.get("verdict") or "").strip() if isinstance(data, dict) else ""
            if verdict in ("supported", "needs_evidence", "discarded"):
                return {"verdict": verdict, "note": (data.get("note") or "").strip()}
        except Exception:
            log.exception("judge LLM failed; falling back")
    return {
        "verdict": "supported" if validation.get("facts") else "needs_evidence",
        "note": "",
    }


# --- event persistence (sync; called via run_in_executor) -------------------

def _insert_run(db_name: str) -> int:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO swarm_runs (status) VALUES ('running') RETURNING id;")
        return cur.fetchone()[0]


def _mark_stopped(db_name: str, run_id: int) -> None:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE swarm_runs SET status='stopped', stopped_at=now() WHERE id=%s;",
            (run_id,),
        )


def _emit(db_name, run_id, role, kind, message, *, node_id=None,
          parent_id=None, label=None, metric=None, source=None, status=None):
    try:
        with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_events "
                "(run_id, role, kind, message, node_id, parent_id, label, metric, source, status) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);",
                (run_id, role, kind, message, node_id, parent_id, label, metric, source, status),
            )
    except Exception:
        log.exception("swarm emit failed")


# --- the loop ---------------------------------------------------------------

async def _loop(db_name: str, run_id: int, org: str) -> None:
    loop = asyncio.get_event_loop()

    async def emit(*a, **k):
        await loop.run_in_executor(None, partial(_emit, db_name, run_id, *a, **k))

    async def call(fn, *a):
        return await loop.run_in_executor(None, partial(fn, *a))

    try:
        mode = "LLM agents" if _llm_on() else "heuristic agents (no LLM key)"
        await emit("system", "log", f"Swarm started for {org} · {mode}. Reading the Context Engine…")
        await asyncio.sleep(0.8)

        objective = _format_objective(await call(_read_objective, db_name))
        await emit("system", "log", f"Objective function → {objective}")

        brain = await call(_read_brain, db_name)
        root = "root"
        await emit(
            "system", "node", f"Objective: find where value is leaking at {org}.",
            node_id=root, parent_id=None,
            label=f"Where is value leaking at {org}?", status="investigating",
        )
        if not brain["evidence"]:
            await emit("system", "log",
                       "The brain is thin — connect more sources in the Context Engine for richer findings.")

        await emit("hypothesis", "log", "Hypothesis generation reading the brain + objective function…")
        hypotheses = await call(_gen_hypotheses, org, brain, objective)
        await emit("hypothesis", "log", f"Proposed {len(hypotheses)} hypotheses to test.")

        for idx, h in enumerate(hypotheses):
            nid = f"h-{idx}"
            label = h["label"]
            await emit(
                "hypothesis", "node", f"New hypothesis: {label}",
                node_id=nid, parent_id=root, label=label, status="investigating",
            )
            if h.get("rationale"):
                await emit("hypothesis", "log", f"Why: {h['rationale']}")
            await asyncio.sleep(0.4)

            await emit("planning", "log", f"Planning how to test: {label}")
            steps = await call(_plan, label, objective)
            for step in steps:
                await emit("planning", "log", f"Plan · {step}")
                await asyncio.sleep(0.25)

            await emit("validator", "log", f"Validator gathering evidence for: {label}")
            validation = await call(_validate, label, brain)
            for f in validation["facts"]:
                await emit(
                    "validator", "fact", f"Evidence: {f['text']}",
                    parent_id=nid, label=f["text"], source=f["source"],
                )
                await asyncio.sleep(0.3)
            if validation.get("reasoning"):
                await emit("validator", "log", f"Read: {validation['reasoning']}")

            await emit("sizer", "log", f"Sizing the opportunity: {label}")
            sizing = await call(_size, label, validation["facts"], objective, idx)
            await emit(
                "sizer", "node",
                f"Sized at {sizing['metric']}" + (f" — {sizing['basis']}" if sizing.get("basis") else ""),
                node_id=nid, parent_id=root, label=label,
                metric=sizing["metric"], status="investigating",
            )
            await asyncio.sleep(0.4)

            verdict = await call(_judge, label, validation, sizing)
            await emit(
                "judge", "node",
                f"Judge: {verdict['verdict'].replace('_', ' ')}"
                + (f" — {verdict['note']}" if verdict.get("note") else ""),
                node_id=nid, parent_id=root, label=label,
                metric=sizing["metric"], status=verdict["verdict"],
            )
            await asyncio.sleep(0.6)

        await emit("system", "log", "First pass complete. Monitoring the brain for new evidence…")
        beat = 0
        while True:
            await asyncio.sleep(12)
            beat += 1
            await emit("system", "log",
                       f"Heartbeat {beat}: re-checking the Context Engine for new signals…")
    except asyncio.CancelledError:
        await emit("system", "log", "Swarm stopped by operator.")
        raise
    except Exception:
        log.exception("swarm loop crashed")
        await emit("system", "log", "Swarm hit an error and paused.")


# --- public control surface -------------------------------------------------

def is_running(db_name: str) -> bool:
    entry = _runs.get(db_name)
    return bool(entry and not entry["task"].done())


def status(db_name: str) -> dict:
    running = is_running(db_name)
    roles = [{**r, "active": r["instances"] if running else 0} for r in ROLES]
    total = sum(r["instances"] for r in ROLES) if running else 0
    return {
        "running": running,
        "run_id": _runs.get(db_name, {}).get("run_id"),
        "total": total,
        "roles": roles,
    }


async def start(db_name: str, org: str) -> dict:
    await stop(db_name)  # only ever one run per tenant
    loop = asyncio.get_event_loop()
    run_id = await loop.run_in_executor(None, _insert_run, db_name)
    task = asyncio.create_task(_loop(db_name, run_id, org))
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
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, _mark_stopped, db_name, entry["run_id"]
            )
        except Exception:
            log.exception("swarm mark-stopped failed")
    return status(db_name)


def _latest_run(cur) -> int | None:
    cur.execute("SELECT id FROM swarm_runs ORDER BY id DESC LIMIT 1;")
    row = cur.fetchone()
    return row[0] if row else None


def get_log(db_name: str, since: int = 0, limit: int = 200) -> dict:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        rid = _latest_run(cur)
        if rid is None:
            return {"events": [], "run_id": None, "running": is_running(db_name)}
        cur.execute(
            "SELECT id, extract(epoch FROM ts), role, kind, message, metric, status "
            "FROM agent_events WHERE run_id = %s AND id > %s ORDER BY id DESC LIMIT %s;",
            (rid, since, limit),
        )
        events = [
            {"id": i, "ts": ts, "role": role, "kind": kind,
             "message": msg, "metric": metric, "status": st}
            for (i, ts, role, kind, msg, metric, st) in cur.fetchall()
        ]
    return {"events": events, "run_id": rid, "running": is_running(db_name)}


def get_tree(db_name: str) -> dict:
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        rid = _latest_run(cur)
        if rid is None:
            return {"tree": None, "run_id": None, "running": is_running(db_name)}
        cur.execute(
            "SELECT kind, node_id, parent_id, label, metric, source, status, role "
            "FROM agent_events WHERE run_id = %s ORDER BY id;",
            (rid,),
        )
        rows = cur.fetchall()

    nodes: dict[str, dict] = {}
    order: list[str] = []
    facts: dict[str, list] = {}
    for kind, node_id, parent_id, label, metric, source, status_, role in rows:
        if kind == "node" and node_id:
            nd = nodes.get(node_id)
            if nd is None:
                nodes[node_id] = {
                    "id": node_id, "parent": parent_id, "label": label,
                    "metric": metric, "status": status_, "role": role,
                    "facts": [], "children": [],
                }
                order.append(node_id)
            else:
                if label:
                    nd["label"] = label
                if metric:
                    nd["metric"] = metric
                if status_:
                    nd["status"] = status_
                if parent_id:
                    nd["parent"] = parent_id
        elif kind == "fact":
            facts.setdefault(parent_id, []).append(
                {"text": label, "source": source, "metric": metric}
            )

    for nid, nd in nodes.items():
        nd["facts"] = facts.get(nid, [])

    roots: list[dict] = []
    for nid in order:
        nd = nodes[nid]
        parent = nd["parent"]
        if parent and parent in nodes:
            nodes[parent]["children"].append(nd)
        else:
            roots.append(nd)

    if len(roots) == 1:
        tree = roots[0]
    elif roots:
        tree = {
            "id": "root", "label": "Investigation", "status": "investigating",
            "metric": None, "facts": [], "children": roots,
        }
    else:
        tree = None
    return {"tree": tree, "run_id": rid, "running": is_running(db_name)}
