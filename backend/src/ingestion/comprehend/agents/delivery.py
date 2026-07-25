"""DeliveryAgent: infer a person's imminent to-dos AND proactive next steps.

Unlike the comprehend agents (which read ONE email), this reads a person's
accumulated brain context — their description, dated timeline, relationships, and
recent neighbour activity — and returns two lists:
  * ``todos`` — concrete actions due in the next 24h (may be empty).
  * ``suggestions`` — ALWAYS ~3 proactive next steps to progress different lines
    of work, so the Delivery tab is useful even when nothing is strictly due.

Each item also carries a specific ask Indigo Iota could execute, which the
Delivery tab pre-fills when the user delegates it.
"""
from __future__ import annotations

from src.ingestion.comprehend.agents.base import Agent


class DeliveryAgent(Agent):
    """A person's ≤24h action items + a few proactive next steps, from the brain."""

    request_kind = "delivery"

    def __init__(self):
        super().__init__()
        from src import config

        # Reasoning over the whole brain to propose next steps needs more than the
        # cheap comprehension model — use the stronger Q&A model when set.
        if getattr(config, "LLM_QA_MODEL", ""):
            self.model = config.LLM_QA_MODEL

    def run(self, person_name: str, today: str, context: str) -> dict:
        """Return ``{"todos": [...], "suggestions": [...]}``.

        ``today`` is an ISO date string; ``context`` is the assembled brain text
        (description + dated timeline + relationships + recent neighbour notes).
        """
        prompt = (
            f"Today is {today}. You are triaging the work of '{person_name}' from "
            "their context below, producing two lists.\n\n"
            "1) todos — concrete actions THIS PERSON must take within the next 24 "
            "hours: replies they owe, deliverables due, time-sensitive decisions "
            "or follow-ups. Use the dated timeline and any deadlines to judge "
            "urgency; ignore anything already done or clearly not due yet. This "
            "list MAY be empty if nothing is genuinely due in 24h.\n\n"
            "2) suggestions — ALWAYS propose exactly 3 proactive next steps that "
            "would move DIFFERENT open lines of work forward (different "
            "projects/relationships/deals), even when no strict to-do exists. "
            "These are opportunities to make progress, not hard deadlines.\n\n"
            "Each suggestion MUST be specific and reasoned from the context — name "
            "the actual situation, recent activity, open thread, or commitment it "
            "builds on, and say WHAT to do and WHY now. Vary them; draw on "
            "concrete details (decisions, dates, documents, people, amounts) from "
            "the context. Do NOT output vague placeholders like 'Advance work with "
            "X', 'follow up with Y', or 'keep the relationship moving' — those are "
            "useless. If two entities only have a name and nothing else, prefer a "
            "step about whichever entities the context actually says something "
            "about.\n\n"
            "For EVERY item in both lists, propose a SPECIFIC ask Indigo Iota "
            "could carry out (e.g. 'Draft a reply to Müller confirming the revised "
            "Q3 timeline', 'Prepare a 1-page risk summary for the Atlas board') — "
            "concrete enough to act on.\n\n"
            "Return ONLY a JSON object of the form:\n"
            '{"todos": [{"title": "<short imperative>", '
            '"context": "<one sentence on why it matters>", '
            '"source": "<where this came from, e.g. email from X / project Y>", '
            '"due_in_hours": <integer 0-24>, "urgency": "critical|soon|today", '
            '"suggested_ask": "<a concrete instruction for Indigo Iota>"}], '
            '"suggestions": [{"title": "<short imperative>", '
            '"context": "<one sentence on the opportunity>", '
            '"source": "<the line of work it advances>", '
            '"suggested_ask": "<a concrete instruction for Indigo Iota>"}]}\n'
            "urgency: critical = <3h or overdue, soon = <8h, today = <24h.\n"
            "Keep every field to ONE short sentence. Output ONLY the JSON object — "
            "no preamble, no explanation, no markdown.\n\n"
            f"CONTEXT for {person_name}:\n{context}"
        )
        # Generous cap: a reasoning model spends tokens before the JSON, so a tight
        # limit truncates the array mid-object (→ unparseable → empty pool).
        result = self._call_json(
            prompt, default={"todos": [], "suggestions": []}, max_tokens=9000,
        )
        if not isinstance(result, dict):
            return {"todos": [], "suggestions": []}
        todos = result.get("todos")
        suggestions = result.get("suggestions")
        return {
            "todos": todos if isinstance(todos, list) else [],
            "suggestions": suggestions if isinstance(suggestions, list) else [],
        }
