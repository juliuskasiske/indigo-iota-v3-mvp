"""Local text embeddings via fastembed (ONNX runtime, no external API).

The model (sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2,
384-dim) is downloaded once on first use and cached under ~/.cache/fastembed
(~120 MB). Much lighter than the previous jina-v3 (1024-dim, ~560 MB ONNX)
while remaining multilingual.

Why a multilingual model: emails arrive in German as well as English. Two
places lean on these vectors cross-lingually:
  - the scope-gate triage (src/ingestion/triage/classify.py) embeds each raw
    email and compares it to English anchor phrases — only a multilingual model
    lands a German email near a same-meaning English anchor;
  - search embeds brain-page content, which is translated to English at
    comprehend time, so it is English by the time it reaches here.

paraphrase-multilingual-MiniLM-L12-v2 is a symmetric model — no
query/passage prefix is required. ``embed()`` and ``embed_one_query()``
produce equivalent vectors; the distinction is kept in the API so callers
remain correct if the model is ever swapped for an asymmetric one.

We use a process-wide singleton (`_model()` is memoized) so the model
doesn't reload between embedding calls.
"""
from __future__ import annotations
from functools import lru_cache
from typing import List


# Multilingual, 384-dim. Changing either of these requires a pgvector column
# migration (VECTOR(384)) plus a re-embed (python -m src.reinit).
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384


@lru_cache(maxsize=1)
def _model():
    # Lazy import + lazy construct: the heavy fastembed module + ONNX
    # session only loads when something actually needs an embedding.
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=MODEL_NAME)


def embed(texts: List[str]) -> List[List[float]]:
    """Embed a batch of passage texts (adds 'passage: ' prefix for e5 models).

    Use for document chunks, scope-gate anchor phrases, and any content
    that will be stored in the DB and compared against query vectors.
    """
    if not texts:
        return []
    return [v.tolist() for v in _model().embed(texts)]


def embed_one(text: str) -> List[float]:
    """Embed a single passage text. Convenience wrapper around embed()."""
    out = embed([text])
    return out[0] if out else []


def embed_one_query(text: str) -> List[float]:
    """Embed a single query text (adds 'query: ' prefix for e5 models).

    Use for user search queries and QA questions — NOT for stored content.
    For multilingual-e5 the query and passage spaces are asymmetric; mixing
    them up degrades cosine similarity scores significantly.
    """
    if not text:
        return []
    return next(iter(_model().query_embed([text]))).tolist()


def to_pg_vector(vec: List[float]) -> str:
    """Format a float list as pgvector's textual literal: '[0.1,0.2,...]'.

    Used with `%s::vector` casts in SQL — avoids needing the pgvector
    Python adapter package as a dependency.
    """
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"
