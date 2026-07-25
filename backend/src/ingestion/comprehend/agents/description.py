"""Description agents: one writer (create path), one updater (update path)."""
from __future__ import annotations
from src.ingestion.comprehend.agents.base import Agent


class DescriptionWriterAgent(Agent):
    """Writes the initial compiled-summary for a brand-new page."""

    def run(
        self, email_text: str, name: str, entity_type: str,
        neighbor_context: str | None = None,
    ) -> str:
        context_block = ""
        if neighbor_context:
            context_block = (
                "For CONTEXT only (related entities; do NOT state facts the email "
                "doesn't support):\n" + neighbor_context + "\n\n"
            )
        prompt = (
            f"Write a 2-3 sentence factual summary of the {entity_type} "
            f"'{name}', based only on the email below. State only what the "
            "email supports. Return ONLY the summary text, no preamble.\n\n"
            + context_block
            + f"EMAIL:\n{email_text}"
        )
        return self._call(prompt, max_tokens=300).strip()


class DescriptionUpdaterAgent(Agent):
    """
    Conservative updater. Only revises the description if the email
    materially changes it — defaults to no change.
    """

    def run(
        self, email_text: str, name: str, current_description: str,
        neighbor_context: str | None = None,
    ) -> str:
        context_block = ""
        if neighbor_context:
            context_block = (
                "For CONTEXT only (related entities; do NOT add facts the email "
                "doesn't support):\n" + neighbor_context + "\n\n"
            )
        prompt = (
            f"Below is the current summary of '{name}' and a new email.\n\n"
            "Decide if the summary needs revising. It is EXPECTED and CORRECT "
            "that most emails need no change — routine events belong in the "
            "timeline, not the summary. Only revise if the email contradicts "
            "the summary or materially changes who/what this is.\n\n"
            + context_block
            + "Return ONLY a JSON object:\n"
            '{"update_needed": true|false, "reason": "...", '
            '"new_description": "..." or null}\n\n'
            f"CURRENT SUMMARY:\n{current_description}\n\n"
            f"NEW EMAIL:\n{email_text}"
        )
        default = {"update_needed": False, "new_description": None}
        result = self._call_json(prompt, default=default)
        if result.get("update_needed") and result.get("new_description"):
            return result["new_description"]
        return current_description