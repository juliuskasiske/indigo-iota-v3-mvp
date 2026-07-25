"""PredicateNormalizerAgent: collapse free-text predicates onto a canonical set.

Open relationship inference (RelationshipAgent) lets the model name a predicate
freely, which otherwise causes synonym sprawl — works_with / collaborates_with /
partners_with all meaning the same thing, fragmenting the graph. This agent maps
each raw predicate onto a canonical one:

  - deterministic pre-normalization to snake_case;
  - exact hit against the existing registry → reuse it (no LLM);
  - otherwise ask the model whether it means the same as an existing predicate
    (reuse that) or is genuinely new (the cleaned form becomes the new canonical).

An in-process cache (keyed by the normalized form) means each distinct wording
costs at most one LLM call per run.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from src.ingestion.comprehend.agents.base import Agent

_CLEAN_RE = re.compile(r"[^a-z0-9]+")


def slug_predicate(raw: str) -> str:
    """Lowercase snake_case form, e.g. 'Collaborates With' -> 'collaborates_with'."""
    return _CLEAN_RE.sub("_", (raw or "").strip().lower()).strip("_")


class PredicateNormalizerAgent(Agent):
    """Maps a raw predicate to a canonical one, merging synonyms."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cache: dict[str, str] = {}

    def run(self, raw_predicate: str, known: Iterable[str]) -> Optional[str]:
        base = slug_predicate(raw_predicate)
        if not base:
            return None
        if base in self._cache:
            return self._cache[base]

        known_set = {k for k in known if k}
        # Exact match (or nothing to merge against yet) → no LLM call needed.
        if base in known_set or not known_set:
            self._cache[base] = base
            return base

        known_list = "\n".join(f"- {k}" for k in sorted(known_set))
        prompt = (
            "You maintain a canonical vocabulary of relationship predicates "
            "(short snake_case verb phrases). Given a NEW predicate and the "
            "EXISTING canonical predicates, decide:\n"
            "- If the NEW predicate means essentially the same as one of the "
            "EXISTING ones, return that existing predicate EXACTLY.\n"
            "- Otherwise return the NEW predicate as a clean snake_case phrase.\n"
            "Return ONLY the predicate token — no quotes, no explanation.\n\n"
            f"NEW: {base}\n\nEXISTING:\n{known_list}"
        )
        chosen = slug_predicate(self._call(prompt, max_tokens=16)) or base
        self._cache[base] = chosen
        return chosen
