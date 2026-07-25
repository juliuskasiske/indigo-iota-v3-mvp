"""ThirdPartyAgent: classify the OTHER side of an email and resolve who it is.

Every email is, at bottom, a contact between the workspace's principal (or one of
its people) and a third party. Getting the third party right is the anchor for
the whole comprehension: it seeds the Identifier, decides how a role inbox
resolves (to a company, not a phantom person), and forms the principal↔third-party
pair the RelationshipAgent must always consider.

For INBOUND mail the third party is the sender; for OUTBOUND it's the primary
recipient. This agent reads the address (+ whether it's a personal vs shared/role
inbox) and the body's greeting/signature cues, and classifies into one bucket:

  - person_private  — a person writing in a personal capacity (no company).
  - person_as_agent — a person acting for a company ("James from Acme", or a
                      personal address whose signature names a company). Yields
                      BOTH a person and a company entity.
  - company_only    — a company with no identifiable person (a role inbox like
                      noreply@/support@, or a purely corporate sender).

Deterministic address signal (is_personal_address) is passed in as a strong prior;
the model refines it from the text (a noreply@ whose body is signed "James" is
person_as_agent; a personal address signed "Acme Support Team" leans company).
"""
from __future__ import annotations

from src.ingestion.comprehend.agents.base import Agent
from src.ingestion.comprehend.canonicalize import (
    clean_person_name,
    is_personal_address,
)

_BUCKETS = ("person_private", "person_as_agent", "company_only")


class ThirdPartyAgent(Agent):
    """Classify + resolve the third party on one email."""

    def run(
        self,
        *,
        direction: str,            # 'inbound' | 'outbound'
        address: str | None,       # the third party's email address
        display_name: str | None,  # display name from the header, if any
        subject: str,
        body: str,
        debug: dict | None = None,
    ) -> dict:
        """Return {bucket, person_name, company_name, address}.

        person_name / company_name may be None depending on the bucket. Never
        raises — on any failure falls back to a deterministic guess from the
        address (personal → person_private, role inbox → company_only)."""
        addr = (address or "").strip()
        personal = is_personal_address(addr)
        fallback = self._fallback(addr, display_name, personal)
        if not addr:
            if debug is not None:
                debug["third_party"] = {**fallback, "via": "no_address"}
            return fallback

        side = "the SENDER" if direction == "inbound" else "the primary RECIPIENT"
        prompt = (
            f"This is an {direction} email. Identify the THIRD PARTY — {side} — "
            "i.e. the external counterparty (NOT our own side).\n\n"
            f"Their email address: {addr}\n"
            f"Header display name: {display_name or '(none)'}\n"
            f"Address looks {'PERSONAL (a specific person)' if personal else 'like a SHARED/ROLE inbox (e.g. info@, noreply@, support@)'}.\n\n"
            "Classify into exactly one bucket:\n"
            "- person_private: a named person writing in a personal capacity, no company.\n"
            "- person_as_agent: a named person acting on behalf of a company (e.g. a "
            "signature 'James, Acme GmbH', or 'this is James from Acme'). Return BOTH "
            "the person and the company.\n"
            "- company_only: a company with NO identifiable individual (a role/shared "
            "inbox, or a purely corporate sender). Return the company only.\n\n"
            "Use the greeting and signature to decide. A role-inbox address signed by a "
            "named person is person_as_agent; a personal address with no company signal "
            "is person_private. Derive the company from the signature/body or, if "
            "clearly corporate, the email domain.\n\n"
            'Return ONLY a JSON object: {"bucket": "...", "person_name": "<full name '
            'or null>", "company_name": "<company or null>"}.\n\n'
            f"SUBJECT: {subject}\n\nEMAIL:\n{body}"
        )
        result = self._call_json(prompt, default={})
        out = self._coerce(result, addr, personal, fallback)
        if debug is not None:
            debug["third_party"] = {**out, "via": "llm", "raw": result}
        return out

    # --- helpers ---------------------------------------------------------

    def _coerce(self, result, addr: str, personal: bool, fallback: dict) -> dict:
        """Validate the model output; fall back on anything malformed."""
        if not isinstance(result, dict):
            return fallback
        bucket = result.get("bucket")
        if bucket not in _BUCKETS:
            return fallback
        person = clean_person_name(result.get("person_name") or "") or None
        company = (result.get("company_name") or "").strip() or None
        # Enforce bucket invariants so downstream seeding is consistent.
        if bucket == "company_only":
            person = None
            company = company or self._company_from_domain(addr)
        elif bucket == "person_as_agent":
            if not person:
                # Claimed an agent but named no person → treat as company_only.
                return {"bucket": "company_only", "person_name": None,
                        "company_name": company or self._company_from_domain(addr),
                        "address": addr}
            company = company or self._company_from_domain(addr)
        else:  # person_private
            person = person or clean_person_name(addr) or None
            company = None
            if not person:
                return fallback
        return {"bucket": bucket, "person_name": person,
                "company_name": company, "address": addr}

    def _fallback(self, addr: str, display_name: str | None, personal: bool) -> dict:
        """Deterministic classification when the LLM can't be used."""
        if addr and not personal:
            return {"bucket": "company_only", "person_name": None,
                    "company_name": self._company_from_domain(addr), "address": addr}
        name = clean_person_name(display_name or "") or clean_person_name(addr) or None
        if not name:
            return {"bucket": "company_only", "person_name": None,
                    "company_name": self._company_from_domain(addr), "address": addr}
        return {"bucket": "person_private", "person_name": name,
                "company_name": None, "address": addr}

    @staticmethod
    def _company_from_domain(addr: str) -> str | None:
        """A rough company label from an address domain (acme.com -> 'Acme').

        Drops common free-mail/provider domains so we don't mint 'Gmail' as a
        company; returns None for those."""
        if "@" not in addr:
            return None
        domain = addr.split("@", 1)[1].strip().lower()
        host = domain.split(".")[0] if domain else ""
        _FREE = {"gmail", "googlemail", "outlook", "hotmail", "yahoo", "gmx",
                 "icloud", "me", "web", "t-online", "proton", "protonmail"}
        if not host or host in _FREE:
            return None
        return host.replace("-", " ").title()
