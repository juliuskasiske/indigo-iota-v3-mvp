"""Question answering over the brain — RAG with graph augmentation.

Pipeline (`ask(question)`):
  1. Embed the question (fastembed, local).
  2. Hybrid vector + keyword search against `chunks` → top-K candidates.
  3. Identify the candidate entities (the entities those chunks describe).
  4. Walk the graph 1 hop from each candidate; collect each neighbor's
     `description` chunk as additional context.
  5. Send {question + vector hits + graph-expanded descriptions} to the
     LLM, instructed to answer using only the supplied sources and cite
     each fact with [N].
  6. Return {answer, sources: [...]} so the UI can show what informed
     the answer — vector match vs. graph neighbor.
"""
from __future__ import annotations
from contextlib import nullcontext
from typing import List, Optional

import psycopg

from src.ingestion.index import embeddings
from src.db import chunks as chunks_repo
from src.db.connection import get_connection
from src.ingestion.comprehend.agents.base import Agent


_K_VECTOR = 6       # vector chunks used as candidates / shown to LLM
_K_NEIGHBORS = 8    # max graph-expanded neighbors brought in

# Shown when retrieval surfaces nothing. With zero sources there is nothing for
# the LLM to ground an answer in, so we return this directly and skip the call.
_NO_CONTEXT_ANSWER = (
    "I don't have any information in the brain that's relevant to that "
    "question yet. Once more mail has been ingested and processed, ask again."
)


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def ask(question: str, conn: Optional[psycopg.Connection] = None) -> dict:
    """Answer a natural-language question using chunks + 1-hop graph context.

    Pass ``conn`` to read a specific tenant's brain (the multi-tenant API does
    this); omit it to use the default brain DB (dashboard / demo).
    """
    if not question or not question.strip():
        return {"answer": "", "sources": []}

    # 1-2. Vector + keyword hybrid retrieval.
    q_vec = embeddings.embed_one_query(question)
    if not q_vec:
        return {"answer": "", "sources": []}
    vector_hits = chunks_repo.hybrid_search(question, q_vec, limit=_K_VECTOR, conn=conn)

    # 3-4. Entity expansion via 1-hop graph neighbors. The workspace's principal
    # (its center of gravity) is always treated as a candidate, so its
    # neighbourhood is pulled into context for every question — answers stay
    # anchored to the customer/person the brain is about.
    candidate_ids = {h["entity_id"] for h in vector_hits if h.get("entity_id")}
    principal = _principal_context(conn)
    if principal and principal.get("entity_id"):
        candidate_ids.add(principal["entity_id"])
    neighbor_chunks = _expand_via_graph(list(candidate_ids), _K_NEIGHBORS, conn=conn)

    # 5. Merge into a single citable source list (vector hits first), then anchor
    # the principal's own page in if it isn't already present.
    sources = _merge_sources(vector_hits, neighbor_chunks)
    if principal and principal.get("text"):
        pp = principal.get("page_path")
        if not any((s.get("entity") or {}).get("page_path") == pp for s in sources):
            sources.insert(0, {
                "method": "principal",
                "entity_id": principal["entity_id"],
                "entity": {
                    "type": principal["entity_type"],
                    "name": principal["entity_name"],
                    "page_path": pp,
                },
                "section": "description",
                "date": None,
                "text": principal["text"],
            })
    if not sources:
        # Nothing retrieved — don't spend an LLM call to be told to say so.
        return {"answer": _NO_CONTEXT_ANSWER, "sources": []}

    # 6. LLM synthesis.
    answer = _agent().run(question, sources)
    return {"answer": answer, "sources": sources}


# ---------------------------------------------------------------------------
# Principal (workspace center of gravity)
# ---------------------------------------------------------------------------

def _principal_context(conn: Optional[psycopg.Connection]) -> Optional[dict]:
    """The principal entity + its description chunk, or None if none is set.

    The principal is the brain page flagged ``data->>'is_principal' = 'true'``;
    we resolve it to its derived entity row (by page_path) so QA can both pull
    its neighbourhood and cite its own description. Runs on ``conn`` (a tenant
    brain) when given; else the default brain DB.
    """
    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT e.id, e.type, e.name, e.page_path, ch.text
            FROM brain_pages bp
            JOIN entities e ON e.page_path = bp.page_path
            LEFT JOIN chunks ch
              ON ch.entity_id = e.id AND ch.section = 'description'
            WHERE bp.data->>'is_principal' = 'true'
            LIMIT 1;
            """
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {
        "entity_id": row[0],
        "entity_type": row[1],
        "entity_name": row[2],
        "page_path": row[3],
        "text": row[4],
    }


# ---------------------------------------------------------------------------
# Graph expansion
# ---------------------------------------------------------------------------

def _expand_via_graph(
    entity_ids: List[int], limit: int, conn: Optional[psycopg.Connection] = None
) -> List[dict]:
    """For each candidate entity, find its 1-hop neighbors and return each
    neighbor's description-chunk text (when present).

    Returns one dict per neighbor with the relationship predicate + direction
    used to discover it — useful both for the LLM context and for the
    UI's "selected via graph traversal" badge.

    Runs on ``conn`` (a tenant brain) when given; else the default brain DB.
    """
    if not entity_ids:
        return []

    cand_set = set(entity_ids)

    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT
              CASE WHEN e.subject = ANY(%s) THEN e.object  ELSE e.subject END AS neighbor_id,
              e.predicate,
              CASE WHEN e.subject = ANY(%s) THEN 'out'     ELSE 'in'      END AS direction,
              CASE WHEN e.subject = ANY(%s) THEN e.subject ELSE e.object  END AS via_id
            FROM relationships e
            WHERE e.subject = ANY(%s) OR e.object = ANY(%s);
            """,
            (entity_ids, entity_ids, entity_ids, entity_ids, entity_ids),
        )
        rel_rows = cur.fetchall()

    # Drop self-loops back into the candidate set. ``via_id`` is the candidate
    # endpoint the neighbor was reached from — kept so the answer prompt can
    # render the actual relationship ("Alice manages Bob"), not just the neighbor.
    neighbors: list[tuple[int, str, str, int]] = []
    seen: set[int] = set()
    for nid, predicate, direction, via_id in rel_rows:
        if nid in cand_set or nid in seen:
            continue
        seen.add(nid)
        neighbors.append((nid, predicate, direction, via_id))
        if len(neighbors) >= limit:
            break
    if not neighbors:
        return []

    neighbor_ids = [n for n, _, _, _ in neighbors]
    via_ids = list({v for _, _, _, v in neighbors})
    pred_lookup = {n: (p, d, v) for n, p, d, v in neighbors}

    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT n.id, n.type, n.name, n.page_path, c.text
            FROM entities n
            LEFT JOIN chunks c
              ON c.entity_id = n.id AND c.section = 'description'
            WHERE n.id = ANY(%s);
            """,
            (neighbor_ids,),
        )
        rows = cur.fetchall()
        # Names of the candidate endpoints, for the relationship phrase.
        cur.execute("SELECT id, name FROM entities WHERE id = ANY(%s);", (via_ids,))
        via_name = {vid: name for vid, name in cur.fetchall()}

    out = []
    for r in rows:
        pred, direction, via_id = pred_lookup.get(r[0], (None, None, None))
        out.append({
            "entity_id": r[0],
            "entity_type": r[1],
            "entity_name": r[2],
            "page_path": r[3],
            "text": r[4],
            "predicate": pred,
            "direction": direction,
            "related_to": via_name.get(via_id),
        })
    return out


# ---------------------------------------------------------------------------
# Source merging
# ---------------------------------------------------------------------------

def _merge_sources(
    vector_hits: List[dict], neighbor_chunks: List[dict]
) -> List[dict]:
    """Build the citable source list. Vector hits first (higher-signal);
    graph neighbors appended, skipping any whose description-chunk was
    already part of the vector hits."""
    out: List[dict] = []
    seen: set[tuple] = set()

    for v in vector_hits:
        key = (v.get("page_path"), v.get("section"), v.get("date"))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "method": "vector",
            "score": float(v.get("vec_score") or 0.0),
            "kw_score": float(v.get("kw_score") or 0.0),
            "entity_id": v.get("entity_id"),
            "entity": v.get("entity"),
            "section": v.get("section"),
            "date": v.get("date"),
            "text": v.get("text"),
        })

    for n in neighbor_chunks:
        if not n.get("text"):
            continue
        key = (n.get("page_path"), "description", None)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "method": "graph_neighbor",
            "predicate": n.get("predicate"),
            "direction": n.get("direction"),
            "related_to": n.get("related_to"),
            "entity_id": n.get("entity_id"),
            "entity": {
                "type": n.get("entity_type"),
                "name": n.get("entity_name"),
                "page_path": n.get("page_path"),
            },
            "section": "description",
            "date": None,
            "text": n.get("text"),
        })

    return out


# ---------------------------------------------------------------------------
# Synthesis agent (inherits Agent so it auto-tracks tokens)
# ---------------------------------------------------------------------------

def _relationship_phrase(source: dict) -> Optional[str]:
    """Render a graph_neighbor source's relationship as "Subject predicate Object".

    ``related_to`` is the candidate endpoint the neighbor was reached from;
    ``direction`` says whether that candidate ('out') or the neighbor ('in') is
    the subject of the triple. Returns None for vector hits or when the predicate
    or peer name is missing.
    """
    if source.get("method") != "graph_neighbor":
        return None
    predicate = source.get("predicate")
    peer = source.get("related_to")
    neighbor = (source.get("entity") or {}).get("name")
    if not predicate or not peer or not neighbor:
        return None
    pred = str(predicate).replace("_", " ").strip()
    if source.get("direction") == "out":
        subj, obj = peer, neighbor      # candidate --predicate--> neighbor
    else:
        subj, obj = neighbor, peer      # neighbor  --predicate--> candidate
    return f"{subj} {pred} {obj}"


_QA_SYSTEM = (
    "You are Indigo Iota's analyst answering questions over a consultancy's "
    "knowledge brain. Be THOROUGH and diligent: work through every source before "
    "answering, and synthesise across them rather than quoting the first match.\n"
    "- Read all numbered SOURCES; weigh entity descriptions, dated timeline "
    "entries, and the relationships that connect people, companies, and projects.\n"
    "- Reason step by step internally, then give a complete, well-structured "
    "answer that covers every relevant fact — names, dates, commitments, "
    "amounts, and the connections between entities. Do not stop at the most "
    "obvious point; surface the fuller picture the sources support.\n"
    "- Ground EVERY claim in the sources and cite it with [N]. Never invent, "
    "assume, or fill gaps from outside knowledge.\n"
    "- Note relevant tensions or gaps (conflicting sources, missing information) "
    "instead of papering over them.\n"
    "- If, after considering all sources, they genuinely do not answer the "
    "question, say so plainly and state what is missing."
)


class AnswerAgent(Agent):
    """Synthesizes a cited answer over a question + list of source snippets.

    Runs on the stronger Q&A model (config.LLM_QA_MODEL) rather than the cheap
    comprehension default — answering over the whole brain needs more reasoning
    and thoroughness than extracting one email."""

    request_kind = "qa"

    def __init__(self):
        super().__init__()
        from src import config

        # Per-agent model override: Q&A is the place we pay for a bigger model.
        if config.LLM_QA_MODEL:
            self.model = config.LLM_QA_MODEL

    def run(self, question: str, sources: List[dict]) -> str:
        if not sources:
            return _NO_CONTEXT_ANSWER

        lines = []
        for i, s in enumerate(sources, 1):
            entity = s.get("entity") or {}
            name = entity.get("name") or "(unknown)"
            etype = entity.get("type") or ""
            section = s.get("section") or ""
            date = s.get("date") or ""
            head = f"[{i}] {name}"
            if etype:
                head += f" ({etype})"
            if date:
                head += f" — {date}"
            # For graph neighbors, state the actual relationship that pulled them
            # in, so the model can use it ("Alice manages Bob"), not just the
            # neighbor's description. Direction tells which end is the subject.
            rel = _relationship_phrase(s)
            if rel:
                head += f" — {rel}"
            head += f" — {section}: {s.get('text', '')}"
            lines.append(head)

        prompt = (
            "Answer the user's QUESTION using ONLY the information in the "
            "SOURCES below. Be thorough: consider every source and synthesise a "
            "complete answer, not just the first relevant fact. Cite each fact "
            "you state with [N] where N is the source number. If the sources "
            "don't answer the question, say so plainly — do not invent facts.\n\n"
            f"QUESTION: {question}\n\n"
            "SOURCES:\n" + "\n".join(lines)
        )
        return self._call(prompt, max_tokens=1200, system=_QA_SYSTEM).strip()


_answer_agent: Optional[AnswerAgent] = None


def _agent() -> AnswerAgent:
    """Process-wide singleton so we don't reinstantiate the OpenAI client
    on every question."""
    global _answer_agent
    if _answer_agent is None:
        _answer_agent = AnswerAgent()
    return _answer_agent
