"""CanonicalizerAgent: resolves raw entity mentions to canonical names.

Used to call the cheap LLM, which was unreliable enough that 'Felix'
and 'Dr Felix Kasiske' frequently ended up as two separate brain pages.
Now it's deterministic code (src.ingestion.comprehend.canonicalize), which catches the
cases we care about — subset matching + honorific stripping — without
rolling the dice every call.

Not actually an LLM Agent anymore (no client, no env vars), but the
class name stays for backwards compatibility with pipeline.py.
"""
from __future__ import annotations
from src.ingestion.comprehend.canonicalize import (
    canonicalize_or_keep,
    is_personal_address,
    normalize_email,
)


class CanonicalizerAgent:
    """Maps raw mentions onto already-known entities by email, then token-overlap."""

    def run(
        self,
        raw_mentions: list[dict],
        known_entities: list[dict],
    ) -> list[dict]:
        """For each raw mention, return its canonical name if a known entity of
        the same type matches — by a personal email address first (strongest),
        then by name tokens; otherwise pass through unchanged. A mention's own
        email (when present) is preserved so the page can store it.
        """
        if not raw_mentions:
            return raw_mentions

        # Group known entities by type — only match within type. Names drive the
        # token match; personal addresses drive the (stronger) email match.
        by_type_names: dict[str, list[str]] = {}
        by_type_email: dict[str, dict[str, str]] = {}
        for entity in known_entities:
            etype = entity.get("type")
            name = entity.get("name")
            if not etype or not name:
                continue
            by_type_names.setdefault(etype, []).append(name)
            em = normalize_email(entity.get("email"))
            if em and is_personal_address(em):
                by_type_email.setdefault(etype, {})[em] = name

        result: list[dict] = []
        for raw in raw_mentions:
            t = raw.get("type")
            name = raw.get("name", "")
            if not t or not name:
                result.append(raw)
                continue
            canonical = canonicalize_or_keep(
                name,
                by_type_names.get(t, []),
                raw_email=raw.get("email"),
                known_by_email=by_type_email.get(t),
            )
            out = {"type": t, "name": canonical}
            if raw.get("email"):
                out["email"] = raw["email"]
            result.append(out)
        return result
