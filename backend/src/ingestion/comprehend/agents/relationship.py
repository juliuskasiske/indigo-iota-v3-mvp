"""RelationshipAgent: infer the relationship (if any) for ONE pair of entities.

The old agent was handed every entity at once and asked to find all links from a
subject — too broad, so it missed pairs. This version judges a single unordered
pair {A, B}: does the email support a relationship between them, and if so, which
way does it point and what is the predicate? Running pair-by-pair (driven by the
pipeline's diligence mode) makes each decision focused and auditable.

Predicates are OPEN: the model coins a short snake_case predicate, preferring the
tenant's house vocabulary when one fits. The PredicateNormalizerAgent collapses
synonyms downstream and graph_sync caps predicates per pair.
"""
from __future__ import annotations
from typing import Optional, Sequence

from src.ingestion.comprehend.agents.base import Agent


class RelationshipAgent(Agent):
    """Judge the relationship between a single pair of entities."""

    def run(
        self,
        email_text: str,
        entity_a: dict,
        entity_b: dict,
        preferred_predicates: Sequence[str] = (),
        neighbor_context: Optional[str] = None,
        debug: dict | None = None,
        force: bool = False,
    ) -> dict:
        """Return a triple ``{predicate, subject, object, object_type}`` (names),
        or ``{}`` when the email supports no relationship between A and B.

        ``subject``/``object`` are the entity NAMES, oriented by the model; the
        object's type is filled from whichever of A/B is the object. When a
        ``debug`` dict is passed it records the raw model output.

        ``force=True`` requires a substantive answer: the pair is known to be
        connected (e.g. the principal and the person they corresponded with), so
        the model MUST orient them and name the deepest relationship it can infer
        — it may NOT return ``related: false``. A generic communication predicate
        is still forbidden; if the model misbehaves we fall back to
        ``associated_with`` so the connectivity edge always exists.
        """
        a_name, a_type = entity_a.get("name"), entity_a.get("type")
        b_name, b_type = entity_b.get("name"), entity_b.get("type")
        if not a_name or not b_name or a_name == b_name:
            return {}

        # The single most important instruction: the predicate must capture the
        # SUBSTANTIVE business relationship the email reveals — never the mere fact
        # that the two were on an email together. Generic communication predicates
        # are banned; if the only thing the email supports is "they were in touch",
        # there is NO relationship worth recording.
        depth = (
            "The predicate must name the SUBSTANTIVE relationship the email "
            "reveals between A and B — what one IS TO the other (role, hierarchy, "
            "commercial tie, project, ownership, advisory, etc.). Read for the "
            "deeper meaning: WHY are these two connected? "
            "Do NOT use generic communication predicates such as "
            "communicates_with, contacted, emailed, sent_email_to, replied_to, "
            "spoke_with, in_touch_with, mentioned, or knows — they merely restate "
            "that they appear on an email, which is already known and adds nothing "
            "to the graph. If the email shows only that they corresponded and "
            "implies no deeper relationship, return related: false. "
        )

        if preferred_predicates:
            guidance = (
                depth
                + "PREFER one of these house predicates when it fits:\n"
                + "\n".join(f"- {p}" for p in preferred_predicates)
                + "\nIf none fits, coin your own concise, specific snake_case "
                "predicate. "
            )
        else:
            guidance = (
                depth
                + "Choose a SHORT, specific snake_case predicate (e.g. works_at, "
                "reports_to, client_of, vendor_of, manages, advises, "
                "introduced, negotiating_with, partnered_on). "
            )

        context_block = ""
        if neighbor_context:
            context_block = (
                "\n\nFor CONTEXT only (do not infer relationships not in THIS email):\n"
                + neighbor_context
            )

        if force:
            task = (
                "These two entities ARE connected (they appear together in this "
                "correspondence). Orient them — pick which is the SUBJECT and which "
                "is the OBJECT — and name the deepest relationship the email and "
                f"context support. {guidance}\n"
                "You MUST return related: true with a substantive predicate; do NOT "
                "return related: false and do NOT fall back to a generic "
                "communication predicate. If the email is thin, infer the most "
                "likely substantive relationship from their names, roles, "
                "signatures, and the email's purpose.\n\n"
                'Return ONLY a JSON object: '
                '{"related": true, "subject": "<A or B name, exactly>", '
                '"object": "<the other name, exactly>", "predicate": "<snake_case>"}.'
            )
        else:
            task = (
                "Using ONLY the email below, decide whether it DIRECTLY states or "
                "clearly implies a relationship between A and B. If yes, orient it: "
                "pick which entity is the SUBJECT and which is the OBJECT, and the "
                f"predicate FROM subject TO object. {guidance}\n"
                "If the email does not support a SUBSTANTIVE relationship between "
                "these two (only that they corresponded, or nothing at all), say so.\n\n"
                'Return ONLY a JSON object. If related: '
                '{"related": true, "subject": "<A or B name, exactly>", '
                '"object": "<the other name, exactly>", "predicate": "<snake_case>"}. '
                'If not: {"related": false}.'
            )

        prompt = (
            "Consider exactly these two entities:\n"
            f"- A: {a_name} ({a_type})\n"
            f"- B: {b_name} ({b_type})\n\n"
            + task
            + context_block
            + f"\n\nEMAIL:\n{email_text}"
        )
        result = self._call_json(prompt, default={})
        if debug is not None:
            debug["raw"] = result

        if not isinstance(result, dict) or not result.get("related"):
            # Forced pairs are known-connected: never drop them. Fall back to a
            # generic (non-communication) predicate only if the model misbehaved.
            if force:
                return {
                    "predicate": "associated_with",
                    "subject": a_name, "object": b_name, "object_type": b_type,
                }
            return {}
        subj = (result.get("subject") or "").strip()
        obj = (result.get("object") or "").strip()
        pred = str(result.get("predicate") or "").strip()
        names = {a_name: a_type, b_name: b_type}
        # Subject and object must be exactly our two entities, one each.
        if not pred or subj not in names or obj not in names or subj == obj:
            if force:
                return {
                    "predicate": pred or "associated_with",
                    "subject": a_name, "object": b_name, "object_type": b_type,
                }
            return {}
        return {
            "predicate": pred,
            "subject": subj,
            "object": obj,
            "object_type": names[obj],
        }
