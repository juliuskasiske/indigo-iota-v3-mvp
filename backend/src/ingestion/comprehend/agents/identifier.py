"""IdentifierAgent: lists the entities mentioned in an email.

The kinds of entity it looks for are not hardcoded — they come from the
tenant's ontology (entity_types). Each type's one-line description is fed to
the model so it knows what counts as, say, a 'company' for this customer. The
model picks a type from that closed list; it never invents a new one.
"""
from __future__ import annotations
from typing import Sequence

from src.ingestion.comprehend.agents.base import Agent
from src.ingestion.comprehend.canonicalize import clean_person_name
from src.db.ontology import EntityTypeSpec


class IdentifierAgent(Agent):
    """Given an email, return every entity mentioned, typed by the ontology."""

    def run(
        self,
        email_text: str,
        entity_types: Sequence[EntityTypeSpec],
        seed_entities: Sequence[dict] = (),
        neighbor_context: str | None = None,
    ) -> list[dict]:
        if not entity_types:
            return []
        allowed = {t.key for t in entity_types}
        type_lines = "\n".join(f"- {t.key}: {t.description}" for t in entity_types)
        example_key = entity_types[0].key
        # The principal + resolved third party are already known to be involved;
        # listing them anchors the model and avoids re-typing them. It still finds
        # any ADDITIONAL entities the email mentions.
        seed_block = ""
        seeds = [s for s in seed_entities if s.get("name") and s.get("type")]
        if seeds:
            seed_lines = "\n".join(f"- {s['name']} ({s['type']})" for s in seeds)
            seed_block = (
                "Already known to be involved in this email (you MAY include them, "
                "but focus on finding ADDITIONAL entities):\n" + seed_lines + "\n\n"
            )
        context_block = ""
        if neighbor_context:
            context_block = (
                "For CONTEXT only (related entities already in the brain — helps you "
                "recognise names; do NOT list these unless this email mentions them):\n"
                + neighbor_context + "\n\n"
            )
        prompt = (
            "List every distinct entity mentioned in the email below that "
            "matches one of the types defined here:\n\n"
            f"{type_lines}\n\n"
            + seed_block
            + context_block
            + "Return ONLY a JSON list of objects, each with 'type', 'name', and "
            "optionally 'email'. "
            f"'type' must be exactly one of: {', '.join(sorted(allowed))}. "
            "Use full canonical names. Include 'email' ONLY when the email text "
            "clearly gives that entity's own address (e.g. a signature, the "
            "From/To line, or 'reach me at …'); otherwise omit it — never guess. "
            "Pick the single best-fitting type for each entity; never invent a "
            "type. No commentary.\n\n"
            f'Example: [{{"type":"{example_key}","name":"Jane Doe",'
            '"email":"jane@acme.com"}]\n\n'
            f"EMAIL:\n{email_text}"
        )
        result = self._call_json(prompt, default=[])
        out: list[dict] = []
        for e in result:
            if not isinstance(e, dict) or e.get("type") not in allowed or not e.get("name"):
                continue
            # Never let an email address become the entity name (e.g. when the
            # model lifts an address out of the "From:" line) — derive a name.
            name = clean_person_name(e["name"])
            if not name:
                continue
            entity = {"type": e["type"], "name": name}
            email = e.get("email")
            if isinstance(email, str) and email.strip():
                entity["email"] = email.strip()
            out.append(entity)
        return out
