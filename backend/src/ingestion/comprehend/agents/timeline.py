"""TimelineAgent: produces one dated timeline entry from an email."""
from __future__ import annotations
from src.ingestion.comprehend.agents.base import Agent


class TimelineAgent(Agent):
    """Creates a timeline entry describing what an email tells us about an entity."""

    def run(
        self, email_text: str, name: str, email_date: str,
        neighbor_context: str | None = None,
    ) -> dict:
        context_block = ""
        if neighbor_context:
            context_block = (
                "For CONTEXT only (related entities; do NOT invent facts not in "
                "the email):\n" + neighbor_context + "\n\n"
            )
        prompt = (
            f"Write a ONE-sentence timeline entry recording what the email "
            f"below tells us about '{name}'. Be concrete and factual.\n\n"
            + context_block
            + 'Return ONLY a JSON object: {"entry": "<one sentence>"}.\n\n'
            f"EMAIL:\n{email_text}"
        )
        result = self._call_json(prompt, default={"entry": ""})
        return {"date": email_date[:10], "entry": result.get("entry", "")}