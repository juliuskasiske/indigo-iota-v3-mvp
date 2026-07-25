"""Hybrid search over the brain graph's chunks.

Public entry point: `search(query, limit)`. Embeds the query once,
hands it off to db.chunks.hybrid_search for the SQL-side combination
of vector similarity and keyword ts_rank.
"""
from __future__ import annotations
from typing import List

from src.ingestion.index import embeddings
from src.db import chunks as chunks_repo


def search(query: str, limit: int = 10) -> List[dict]:
    """Return up to `limit` results, ranked by hybrid score.

    Each result has the chunk's text, the entity it's about, and the
    underlying vec/kw scores so the UI can show which signal fired.
    """
    if not query or not query.strip():
        return []
    q_vec = embeddings.embed_one_query(query)
    if not q_vec:
        return []
    return chunks_repo.hybrid_search(query, q_vec, limit=limit)
