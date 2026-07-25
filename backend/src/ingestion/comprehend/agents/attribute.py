"""AttributeAgent: extracts a type's structured frontmatter fields.

One generic agent replaces the old per-type frontmatter agents. It is driven
by the entity type's FieldSpec list (from the ontology): each field's key +
description tells the model what to pull, and ``is_list`` whether to return a
single value or a list. The model only fills fields the email actually states;
anything not stated stays null (or an empty list).
"""
from __future__ import annotations
from typing import Sequence

from src.ingestion.comprehend.agents.base import Agent
from src.db.ontology import FieldSpec


class AttributeAgent(Agent):
    """Reads the configured attribute fields for one entity off the email."""

    def run(
        self, email_text: str, name: str, type_label: str,
        fields: Sequence[FieldSpec], neighbor_context: str | None = None,
    ) -> dict:
        if not fields:
            return {}
        field_lines = "\n".join(
            f"- {f.field_key}: {f.description}"
            + (" (return a JSON list of values)" if f.is_list else "")
            for f in fields
        )
        keys = ", ".join(f.field_key for f in fields)
        context_block = ""
        if neighbor_context:
            context_block = (
                "For CONTEXT only (related entities; do NOT use as a fact source — "
                "only the email states facts):\n" + neighbor_context + "\n\n"
            )
        prompt = (
            f"From the email below, extract these facts about the {type_label} "
            f"'{name}', if and only if the email clearly states them. For "
            "anything not stated, use null (or [] for list fields). Do not guess.\n\n"
            f"Fields:\n{field_lines}\n\n"
            + context_block
            + f"Return ONLY a JSON object with exactly these keys: {keys}.\n\n"
            f"EMAIL:\n{email_text}"
        )
        default = {f.field_key: ([] if f.is_list else None) for f in fields}
        result = self._call_json(prompt, default=default)
        if not isinstance(result, dict):
            return default
        return {f.field_key: result.get(f.field_key, default[f.field_key]) for f in fields}
