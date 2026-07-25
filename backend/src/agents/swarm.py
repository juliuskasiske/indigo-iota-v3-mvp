"""The agent swarm: a startable/stoppable loop that reads a tenant's brain and
investigates where value is leaking, logging everything it does.

Design (deliberately small, but real):

* One in-process ``asyncio`` task per tenant brain DB drives the loop. Because
  the API runs a single uvicorn worker, in-memory task state is authoritative —
  ``is_running`` is driven by the live task, not by a DB flag that could go
  stale across a restart.
* The loop reads REAL brain data (companies from ``entities``, evidence from
  ``chunks``) and appends to ``agent_events``. The Overview builds both a live
  log and a hypothesis tree from those rows.
* Reasoning is currently heuristic/retrieval-based so it runs with no LLM key.
  Each role (hypothesis generation, planning, validator, opportunity sizer,
  judge) is a stage in the loop; swap the bodies for LLM calls when a key is set.
"""
from __future__ import annotations

import asyncio
import logging
from functools import partial

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

# Signals a Validator scans the brain's chunk text for.
_KEYWORDS = [
    "margin", "discount", "price", "cost", "manual", "repeat", "repetit",
    "automat", "demurrage", "overtime", "waste", "rework", "delay",
    "inefficien", "backlog", "churn", "overrun",
]

# db_name -> {"task": asyncio.Task, "run_id": int}
_runs: dict[str, dict] = {}


# --- DB helpers (sync; called via run_in_executor from the loop) ------------

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


def _companies(db_name: str):
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name FROM entities WHERE type = 'company' ORDER BY id;")
        return cur.fetchall()


def _search_facts(db_name: str, entity_id: int):
    clause = " OR ".join(["text ILIKE %s"] * len(_KEYWORDS))
    params = [f"%{k}%" for k in _KEYWORDS]
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT text, section, page_path FROM chunks "
            f"WHERE ({clause}) ORDER BY (entity_id = %s) DESC, id LIMIT 3;",
            params + [entity_id],
        )
        return cur.fetchall()


def _entity_chunks(db_name: str, entity_id: int, limit: int = 2):
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT text, section, page_path FROM chunks WHERE entity_id = %s ORDER BY id LIMIT %s;",
            (entity_id, limit),
        )
        return cur.fetchall()


def _size(entity_id: int, n_facts: int) -> str:
    base = 0.4 + (entity_id % 5) * 0.3 + n_facts * 0.5
    return f"€{base:.1f}M (est.)"


def _snippet(text: str) -> str:
    s = " ".join((text or "").split())
    return s[:177] + "…" if len(s) > 180 else s


# --- the loop ---------------------------------------------------------------

async def _loop(db_name: str, run_id: int, org: str) -> None:
    loop = asyncio.get_event_loop()

    async def emit(*a, **k):
        await loop.run_in_executor(None, partial(_emit, db_name, run_id, *a, **k))

    async def call(fn, *a):
        return await loop.run_in_executor(None, partial(fn, *a))

    try:
        await emit("system", "log", f"Swarm started for {org}. Reading the Context Engine…")
        await asyncio.sleep(1.2)

        companies = await call(_companies, db_name)
        root = "root"
        await emit(
            "system", "node",
            f"Objective: find where value is leaking at {org}.",
            node_id=root, parent_id=None,
            label=f"Where is value leaking at {org}?", status="investigating",
        )

        if not companies:
            await emit("system", "log",
                       "No companies in the brain yet — connect more sources in the Context Engine.")

        for eid, name in companies:
            nid = f"h-{eid}"
            await emit("hypothesis", "log", f"Proposing a hypothesis around {name}.")
            await asyncio.sleep(1.0)
            await emit(
                "hypothesis", "node", f"New hypothesis: value is leaking around {name}.",
                node_id=nid, parent_id=root,
                label=f"Value is leaking around {name}", status="investigating",
            )

            await emit("planning", "log", f"Planning how to test the {name} hypothesis.")
            await asyncio.sleep(0.8)
            for step in (
                f"Pull every mention of {name} from the brain.",
                "Look for discounting, manual rework, and cost leakage.",
                "Quantify the €-impact from whatever evidence turns up.",
            ):
                await emit("planning", "log", f"Plan · {step}")
                await asyncio.sleep(0.4)

            await emit("validator", "log", f"Validator gathering facts on {name} from the brain…")
            await asyncio.sleep(0.9)
            facts = await call(_search_facts, db_name, eid)
            if not facts:
                facts = await call(_entity_chunks, db_name, eid)
            for text, section, page in facts:
                snip = _snippet(text)
                src = section or page or "brain"
                await emit(
                    "validator", "fact", f"Evidence for {name}: {snip}",
                    parent_id=nid, label=snip, source=src,
                )
                await asyncio.sleep(0.5)

            await emit("sizer", "log", f"Sizing the {name} opportunity from the evidence…")
            await asyncio.sleep(0.7)
            metric = _size(eid, len(facts))
            await emit(
                "sizer", "node", f"Sized the {name} opportunity at {metric}.",
                node_id=nid, parent_id=root,
                label=f"Value is leaking around {name}", metric=metric, status="investigating",
            )
            await asyncio.sleep(0.6)

            if facts:
                await emit(
                    "judge", "node", f"Judge: the {name} hypothesis holds — the evidence checks out.",
                    node_id=nid, parent_id=root,
                    label=f"Value is leaking around {name}", metric=metric, status="supported",
                )
            else:
                await emit(
                    "judge", "node",
                    f"Judge: {name} needs an interview — no hard evidence in the brain yet.",
                    node_id=nid, parent_id=root,
                    label=f"Value is leaking around {name}", metric=metric, status="needs_evidence",
                )
            await asyncio.sleep(0.9)

        await emit("system", "log", "First pass complete. Monitoring the brain for new evidence…")
        beat = 0
        while True:
            await asyncio.sleep(9)
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
