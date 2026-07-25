"""Four-bucket, embedding-only email scope classifier.

Sorts each email into exactly one of four buckets defined in natural language
in ``backend/classification.yaml``:

    in_scope      -> INCLUDE
    redzone       -> EXCLUDE  (sensitive / privileged / off-limits)
    spam          -> EXCLUDE
    out_of_scope  -> EXCLUDE

Everything runs locally via fastembed (jinaai/jina-embeddings-v3, multilingual)
— no LLM, no network, nothing leaves the box. EU/GDPR-safe by construction. The
model is multilingual on purpose: emails arrive in German, the anchor phrases
are English, and only a multilingual model lands a German email near a
same-meaning English anchor so the gate compares them soundly.

Two layers
----------
Layer 1   Embed the email, take its cosine similarity to every bucket (the max
          over that bucket's example anchor phrases), and pick the nearest
          bucket (argmax). The bucket's prose description is explanatory only
          and is NOT embedded — atomic anchors match far better than a blurry
          paragraph average.

Layer 2   Security runoff. ONLY when Layer 1 says ``in_scope``, re-vote between
          *just* redzone and in_scope, biased toward exclusion: redzone wins
          (the email is dropped) whenever ``redzone + margin >= in_scope``.
          So a merely-close redzone match still keeps sensitive mail out.

The returned ``Decision`` carries only metadata (bucket, include flag, scores,
reason) — never the email body — so excluded mail leaves a transparent audit
trail without persisting its content.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

from src.ingestion.index.embeddings import embed

# The single human-editable definition file (sibling of prices.yaml, at the
# backend/ root). classify.py sits at src/ingestion/triage/, so the backend root
# is parents[3] (src -> ingestion -> triage). Override with IOTA_CLASSIFICATION_FILE.
_CLASSIFICATION_FILE = Path(
    os.environ.get("IOTA_CLASSIFICATION_FILE")
    or (Path(__file__).resolve().parents[3] / "classification.yaml")
)

# Bucket -> include/exclude is fixed policy; only in_scope is ever ingested.
_INCLUDE_BUCKET = "in_scope"
_REQUIRED_BUCKETS = ("in_scope", "redzone", "spam", "out_of_scope")

# Public aliases for the store + Admin API (which bucket includes is policy,
# fixed in code — admins edit text/anchors/margin, never the action).
INCLUDE_BUCKET = _INCLUDE_BUCKET
REQUIRED_BUCKETS = _REQUIRED_BUCKETS
BUCKET_ACTIONS = {
    "in_scope": "include",
    "redzone": "exclude",
    "spam": "exclude",
    "out_of_scope": "exclude",
}

_DEFAULT_MARGIN = 0.03


# --------------------------------------------------------------------------
#  Compiled (embedded) bucket anchors, cached by the CONTENT of the
#  definitions that produced them. The definitions can come from the YAML file
#  (default / CLI) or from a tenant's brain DB (the admin-editable store) — the
#  classifier doesn't care which; it just consumes the same dict shape:
#
#    {"margin": float,
#     "buckets": {"<bucket>": {"action", "description", "anchors": [...]}, ...}}
#
#  Embedding is the expensive step, so we memoize per distinct definitions
#  content. Editing the definitions (file or DB) yields a new hash → rebuild.
# --------------------------------------------------------------------------
@dataclass
class _Compiled:
    """Embedded natural-language anchors for every bucket, plus the margin."""

    margin: float
    # bucket name -> list of unit-normalized anchor vectors
    vectors: Dict[str, List[List[float]]] = field(default_factory=dict)


_compiled_cache: Dict[str, _Compiled] = {}
_lock = threading.Lock()


def _normalize(vec: List[float]) -> List[float]:
    n = math.sqrt(sum(x * x for x in vec))
    if n == 0.0:
        return vec
    return [x / n for x in vec]


def _cosine(a: List[float], b: List[float]) -> float:
    """Cosine similarity of two already-unit-normalized vectors (a dot b)."""
    return sum(x * y for x, y in zip(a, b))


def read_definitions() -> dict:
    """Parse classification.yaml. Never raises — returns {} if unreadable."""
    import yaml

    try:
        with _CLASSIFICATION_FILE.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except (OSError, yaml.YAMLError):
        return {}
    return data if isinstance(data, dict) else {}


def _bucket_texts(spec: dict) -> List[str]:
    """The texts embedded for a bucket: its example anchors, one vector each.

    The human-readable ``description`` is deliberately NOT embedded — it is
    explanatory copy for the admin. The bucket's score is the best (max) cosine
    match over these atomic anchors.
    """
    return [
        a.strip()
        for a in spec.get("anchors") or []
        if isinstance(a, str) and a.strip()
    ]


def _definitions_key(definitions: dict) -> str:
    """A stable hash of the definitions, so identical content reuses embeddings."""
    blob = json.dumps(definitions, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _compile(definitions: dict) -> _Compiled:
    """Embed every bucket's anchor texts (once) for the given definitions."""
    margin = definitions.get("margin", _DEFAULT_MARGIN)
    try:
        margin = float(margin)
    except (TypeError, ValueError):
        margin = _DEFAULT_MARGIN

    buckets = definitions.get("buckets") or {}
    missing = [b for b in _REQUIRED_BUCKETS if b not in buckets]
    if missing:
        raise RuntimeError(
            f"scope definitions are missing required bucket(s): {missing}. "
            f"Expected all of {_REQUIRED_BUCKETS}."
        )

    # Embed all anchor texts in one batch, then slice back per bucket.
    order: List[str] = []
    flat: List[str] = []
    for name in _REQUIRED_BUCKETS:
        texts = _bucket_texts(buckets[name])
        if not texts:
            raise RuntimeError(
                f"scope bucket {name!r} has no example anchors to compare "
                "against — add at least one anchor snippet."
            )
        order.extend([name] * len(texts))
        flat.extend(texts)

    embedded = embed(flat)
    vectors: Dict[str, List[List[float]]] = {b: [] for b in _REQUIRED_BUCKETS}
    for name, vec in zip(order, embedded):
        vectors[name].append(_normalize(vec))

    return _Compiled(margin=margin, vectors=vectors)


def _get_compiled(definitions: dict) -> _Compiled:
    """Return compiled anchors for these definitions, embedding once and caching."""
    key = _definitions_key(definitions)
    cached = _compiled_cache.get(key)
    if cached is not None:
        return cached
    with _lock:
        cached = _compiled_cache.get(key)
        if cached is None:
            cached = _compile(definitions)
            # Bound the cache: scope edits are rare, but never grow without limit.
            if len(_compiled_cache) >= 32:
                _compiled_cache.clear()
            _compiled_cache[key] = cached
        return cached


# --------------------------------------------------------------------------
#  The decision.
# --------------------------------------------------------------------------
@dataclass
class Decision:
    """Outcome of classifying one email. Carries metadata only — no body."""

    bucket: str                     # in_scope / redzone / spam / out_of_scope
    include: bool                   # True only for in_scope that survives Layer 2
    scores: Dict[str, float]        # cosine sim to each bucket (Layer 1)
    layer2_applied: bool            # did the redzone-vs-in_scope runoff run?
    reason: str                     # human-readable explanation for the audit log

    def as_log(self) -> dict:
        """Compact dict for an audit/transparency log (no content)."""
        return {
            "bucket": self.bucket,
            "include": self.include,
            "scores": {k: round(v, 4) for k, v in self.scores.items()},
            "layer2_applied": self.layer2_applied,
            "reason": self.reason,
        }


def _bucket_score(email_vec: List[float], anchor_vecs: List[List[float]]) -> float:
    """Best (max) cosine similarity of the email to any of a bucket's anchors."""
    return max((_cosine(email_vec, a) for a in anchor_vecs), default=-1.0)


def _decide(scores: Dict[str, float], margin: float) -> Decision:
    """Pure include/exclude verdict from per-bucket scores and the margin.

    Embedding-free and deterministic: this IS the scope gate's security
    boundary, kept apart from the model call in ``classify`` so it can be
    tested directly. On a Layer-1 tie ``max`` keeps the first bucket, so
    callers must pass ``scores`` in ``_REQUIRED_BUCKETS`` order (in_scope
    first) — a redzone tie with in_scope then still falls to the Layer-2
    runoff below rather than escaping as a Layer-1 win.
    """
    # Layer 1: nearest bucket wins.
    top = max(scores, key=scores.get)

    if top != _INCLUDE_BUCKET:
        return Decision(
            bucket=top,
            include=False,
            scores=scores,
            layer2_applied=False,
            reason=(
                f"Layer 1: nearest bucket is {top!r} "
                f"(sim={scores[top]:.4f}) — excluded."
            ),
        )

    # Layer 2 security runoff: redzone vs in_scope only, biased to exclude.
    rz = scores["redzone"]
    insc = scores[_INCLUDE_BUCKET]
    if rz + margin >= insc:
        return Decision(
            bucket="redzone",
            include=False,
            scores=scores,
            layer2_applied=True,
            reason=(
                f"Layer 2 security vote: redzone {rz:.4f} + margin "
                f"{margin:.4f} >= in_scope {insc:.4f} — excluded as "
                "redzone despite looking in-scope."
            ),
        )

    return Decision(
        bucket=_INCLUDE_BUCKET,
        include=True,
        scores=scores,
        layer2_applied=True,
        reason=(
            f"Layer 1: in_scope (sim={insc:.4f}). Layer 2: cleared redzone "
            f"runoff (redzone {rz:.4f} + margin {margin:.4f} < "
            f"{insc:.4f}) — included."
        ),
    )


def classify(text: str, definitions: dict | None = None) -> Decision:
    """Classify one email's text into a bucket and decide include/exclude.

    ``definitions`` is the bucket/margin config (DB- or YAML-sourced). When
    omitted it falls back to ``classification.yaml`` — used by the CLI and any
    cred-free path that has no per-tenant store to read from.
    """
    if definitions is None:
        definitions = read_definitions()
    anchors = _get_compiled(definitions)

    cleaned = (text or "").strip()
    if not cleaned:
        return Decision(
            bucket="out_of_scope",
            include=False,
            scores={b: 0.0 for b in _REQUIRED_BUCKETS},
            layer2_applied=False,
            reason="empty text — nothing to classify; excluded by default.",
        )

    email_vec = _normalize(embed([cleaned])[0])
    scores = {
        name: _bucket_score(email_vec, vecs)
        for name, vecs in anchors.vectors.items()
    }
    return _decide(scores, anchors.margin)


def _cli(argv: List[str]) -> int:
    import argparse

    p = argparse.ArgumentParser(
        description="Classify email text into scope buckets (local embeddings)."
    )
    p.add_argument("text", nargs="?", default=None, help="Email text to classify.")
    p.add_argument("--file", default=None, help="Read email text from a file.")
    args = p.parse_args(argv)

    if args.file:
        text = Path(args.file).read_text(encoding="utf-8")
    elif args.text is not None:
        text = args.text
    else:
        import sys as _sys
        text = _sys.stdin.read()

    d = classify(text)
    verdict = "INCLUDE" if d.include else "EXCLUDE"
    print(f"[classify] {verdict}  bucket={d.bucket}")
    print(f"[classify] scores:")
    for name in _REQUIRED_BUCKETS:
        mark = " <-" if name == d.bucket else ""
        print(f"    {name:14} {d.scores[name]:.4f}{mark}")
    print(f"[classify] {d.reason}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_cli(sys.argv[1:]))
