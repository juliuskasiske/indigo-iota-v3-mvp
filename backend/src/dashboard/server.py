"""FastAPI server for the brain-graph dashboard.

API surface:

    GET  /api/graph         current nodes + edges snapshot
    GET  /api/page?path=    brain page JSON (path-traversal-guarded)
    POST /api/enrich        runs the email pipeline
    GET  /api/stream        Server-Sent Events: node_added / edge_added

Everything that's not /api/* is served as a static file from ./static/.
"""
from __future__ import annotations
import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src import config, events, usage
from src.db.connection import get_connection

app = FastAPI(title="Indigo Iota Brain Graph")

_STATIC_DIR: Path = Path(__file__).parent / "static"


# ---------------------------------------------------------------------------
# Graph + page (unchanged from previous version)
# ---------------------------------------------------------------------------

@app.get("/api/graph")
def get_graph() -> dict:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, type, name, page_path FROM entities ORDER BY id;")
        nodes = [
            {"id": r[0], "type": r[1], "name": r[2], "page_path": r[3]}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT id, subject, predicate, object FROM relationships ORDER BY id;"
        )
        edges = [
            {"id": r[0], "source": r[1], "predicate": r[2], "target": r[3]}
            for r in cur.fetchall()
        ]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/search")
def search_endpoint(q: str = Query(...), limit: int = 10) -> dict:
    """Hybrid search: vector similarity (pgvector) + keyword ts_rank.
    Lazy-imports src.search so fastembed only loads on first query."""
    from src.search import search
    return {"query": q, "results": search(q, limit=limit)}


class AskRequest(BaseModel):
    question: str


@app.post("/api/ask")
def ask_endpoint(req: AskRequest) -> dict:
    """RAG with graph augmentation. Returns {question_id, answer, sources}.

    Saves the Q&A to the questions table so the sidebar can list it and
    so a click can replay it without another LLM call. Sources are
    tagged with `method = "vector" | "graph_neighbor"` so the UI can
    show which retrieval path surfaced each one.
    """
    from src.qa import ask
    from src.db import questions as questions_repo
    result = ask(req.question)
    question_id = questions_repo.save_question(
        req.question, result.get("answer", ""), result.get("sources", [])
    )
    result["question_id"] = question_id
    return result


@app.get("/api/questions")
def list_questions_endpoint() -> dict:
    """Recent questions for the Search-tab sidebar."""
    from src.db.questions import list_questions
    return {"questions": list_questions()}


@app.get("/api/questions/{question_id}")
def get_question_endpoint(question_id: int) -> dict:
    """Replay a saved question: {id, question, answer, sources, created_at}."""
    from src.db.questions import get_question
    q = get_question(question_id)
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")
    return q


@app.delete("/api/questions/{question_id}")
def delete_question_endpoint(question_id: int) -> dict:
    from src.db.questions import delete_question
    delete_question(question_id)
    return {"deleted": question_id}


@app.get("/api/page")
def get_page(path: str = Query(...)) -> dict:
    """Return a brain page's JSON by its page_path (e.g. 'persons/felix.json').

    Pages live in the brain_pages table now, looked up by exact key — there is
    no filesystem to traverse, so the path is just a row key.
    """
    from src.db import brain_pages as brain_pages_repo
    from src.db.connection import get_connection

    with get_connection() as conn:
        data = brain_pages_repo.load_page(conn, path)
    if data is None:
        raise HTTPException(status_code=404, detail="page not found")
    return data


# ---------------------------------------------------------------------------
# Email pipeline
# ---------------------------------------------------------------------------

@app.post("/api/enrich")
def enrich() -> dict:
    """Run the email pipeline against the fixture and enrich the graph."""
    # Imported lazily so the dashboard module isn't coupled to the
    # comprehend pipeline at import time.
    from src.ingestion.comprehend.pipeline import ComprehendPipeline

    fixture_path = config.FIXTURES_DIR / "sample_delta_response.json"
    emails = json.loads(fixture_path.read_text(encoding="utf-8"))["value"]
    pipeline = ComprehendPipeline()
    pipeline.run(emails)
    return {"emails_processed": len(emails)}


# ---------------------------------------------------------------------------
# Token usage
# ---------------------------------------------------------------------------

@app.get("/api/usage")
def get_usage() -> dict:
    """Snapshot of LLM token usage since process start (or last reset)."""
    return usage.snapshot()


@app.post("/api/usage/reset")
def reset_usage() -> dict:
    """Zero the counter. Called by scripts/reset.sh."""
    usage.reset()
    snap = usage.snapshot()
    events.publish("usage_updated", snap)
    return snap


# ---------------------------------------------------------------------------
# Server-Sent Events: poll DB + CI file, broadcast diffs
# ---------------------------------------------------------------------------

@app.get("/api/stream")
async def stream() -> StreamingResponse:
    """SSE stream of graph + CI changes. Polls every 2s.

    Decouples the dashboard layer from the comprehend/seed pipelines
    (no instrumentation needed downstream). Sync DB calls are wrapped
    in `asyncio.to_thread` so the event loop stays responsive.
    """
    return StreamingResponse(
        _stream_events(), media_type="text/event-stream"
    )


async def _stream_events():
    """Yield SSE-formatted events forever.

    Two sources are merged:
    - Event bus (in-process pub/sub): email_started, email_completed,
      usage_updated. Low-latency, published by the comprehend pipeline
      + Agent base.
    - DB id-diff: node_added, node_removed, edge_added, edge_removed.
      We diff the current DB id-sets against the ids we've already
      pushed to this client. Critical for `_removed`: the sync layer
      deletes-and-re-inserts edges on every page re-sync, and the
      frontend was accumulating ghost edges because deletions never
      reached it.
    """
    sent_node_ids: set[int] = set()
    sent_edge_ids: set[int] = set()
    bus = events.subscribe()

    try:
        # Initial heartbeat so the client knows the connection is established.
        yield "event: hello\ndata: {}\n\n"

        while True:
            await asyncio.sleep(2.0)

            # 1. Drain the in-process event bus first (low-latency events).
            for evt in await asyncio.to_thread(events.drain, bus):
                yield (
                    f"event: {evt['type']}\n"
                    f"data: {json.dumps(evt['data'])}\n\n"
                )

            # 2. Diff DB against what we've already sent.
            added_nodes, removed_node_ids, added_edges, removed_edge_ids = (
                await asyncio.to_thread(
                    _diff_db, sent_node_ids, sent_edge_ids
                )
            )
            for nid in removed_node_ids:
                sent_node_ids.discard(nid)
                yield f"event: node_removed\ndata: {json.dumps({'id': nid})}\n\n"
            for eid in removed_edge_ids:
                sent_edge_ids.discard(eid)
                yield f"event: edge_removed\ndata: {json.dumps({'id': eid})}\n\n"
            for node in added_nodes:
                sent_node_ids.add(node["id"])
                yield f"event: node_added\ndata: {json.dumps(node)}\n\n"
            for edge in added_edges:
                sent_edge_ids.add(edge["id"])
                yield f"event: edge_added\ndata: {json.dumps(edge)}\n\n"
    finally:
        events.unsubscribe(bus)


# ---------------------------------------------------------------------------
# Helpers (sync I/O — invoked via asyncio.to_thread from the SSE generator)
# ---------------------------------------------------------------------------

def _diff_db(sent_node_ids: set[int], sent_edge_ids: set[int]):
    """Diff the current DB id-sets against what we've already pushed.

    Returns (added_nodes, removed_node_ids, added_edges, removed_edge_ids).
    Only full rows are fetched for adds; removals are id-only since
    the client already has the row data.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM entities;")
        current_node_ids = {r[0] for r in cur.fetchall()}
        cur.execute("SELECT id FROM relationships;")
        current_edge_ids = {r[0] for r in cur.fetchall()}

        new_node_ids = current_node_ids - sent_node_ids
        new_edge_ids = current_edge_ids - sent_edge_ids

        added_nodes: list[dict] = []
        if new_node_ids:
            cur.execute(
                "SELECT id, type, name, page_path FROM entities "
                "WHERE id = ANY(%s);",
                (list(new_node_ids),),
            )
            added_nodes = [
                {"id": r[0], "type": r[1], "name": r[2], "page_path": r[3]}
                for r in cur.fetchall()
            ]

        added_edges: list[dict] = []
        if new_edge_ids:
            cur.execute(
                "SELECT id, subject, predicate, object FROM relationships "
                "WHERE id = ANY(%s);",
                (list(new_edge_ids),),
            )
            added_edges = [
                {"id": r[0], "source": r[1], "predicate": r[2], "target": r[3]}
                for r in cur.fetchall()
            ]

    removed_node_ids = sent_node_ids - current_node_ids
    removed_edge_ids = sent_edge_ids - current_edge_ids
    return added_nodes, removed_node_ids, added_edges, removed_edge_ids


# Static frontend mounted last (catches everything not handled above).
app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
