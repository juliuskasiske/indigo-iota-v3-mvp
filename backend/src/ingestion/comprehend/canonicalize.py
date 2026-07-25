"""Fuzzy-match a raw name onto a list of known canonical names.

Deterministic; pure functions; no LLM calls. The cheap LLM the rest of
the system uses turned out unreliable for this specific task, and the
heuristics that actually matter are simple:

  - Same name modulo case + leading honorific ('Dr Felix Kasiske' ==
    'Felix Kasiske' for matching purposes).
  - One name is a token-subset of the other ('Felix' ⊆ 'Felix Kasiske',
    'Acme' ⊆ 'Acme GmbH').

Used by:
  - src.ingestion.comprehend.agents.canonicalizer.CanonicalizerAgent — collapses
    raw entity mentions from email/website text onto existing brain-page
    names (so 'Felix' in an email lands on the 'Dr Felix Kasiske' page).
  - src.ingestion.index.graph_sync — canonicalizes the object name of each
    relationship stored on a page before resolving it as an entity, so a triple
    pointing at 'Acme GmbH' collapses onto the existing
    'Acme' entity instead of spawning an orphan.
"""
from __future__ import annotations
import re
from typing import Iterable, Optional


def clean_person_name(name: Optional[str]) -> str:
    """A human display name, never an email address.

    A bare address ('michael.dempsey@acme.com') becomes 'Michael Dempsey' —
    the local part split on . _ - + and title-cased. A real name is returned
    as-is (trimmed of surrounding quotes). Empty in → empty out.
    """
    if not name:
        return ""
    name = name.strip().strip("\"'").strip()
    # "Display Name <addr>" -> "Display Name".
    if "<" in name:
        name = name.split("<", 1)[0].strip().strip("\"'").strip()
    if name and "@" in name:  # a bare address -> derive a name from the local part
        local = name.split("@", 1)[0]
        parts = [p for p in re.split(r"[._+\-]+", local) if p]
        name = " ".join(p.capitalize() for p in parts) if parts else local
    return name.strip()


_HONORIFICS: frozenset[str] = frozenset({
    "dr", "dr.",
    "mr", "mr.",
    "mrs", "mrs.",
    "ms", "ms.",
    "prof", "prof.",
    "sir", "madam", "lord", "lady",
})


def _strip_honorific(parts: list[str]) -> list[str]:
    return parts[1:] if parts and parts[0].lower() in _HONORIFICS else parts


# German umlaut / ß folding. Translation leaves proper names untouched ('Müller'
# stays 'Müller'), but the same name can surface either umlauted ('Müller') or
# transliterated ('Mueller') across emails — folding both to one form so they
# canonicalize onto a single brain page instead of spawning a duplicate.
_UMLAUT_FOLD = {
    "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
}


def _fold_umlauts(text: str) -> str:
    for src, dst in _UMLAUT_FOLD.items():
        text = text.replace(src, dst)
    return text


def _normalized(name: str) -> str:
    return _fold_umlauts(" ".join(_strip_honorific(name.lower().split())))


def _tokens(name: str) -> frozenset[str]:
    return frozenset(_normalized(name).split())


# Shared / role inboxes are NOT identity — many different people send from them,
# so matching on them would merge unrelated entities into one. Only personal
# addresses count as an identity signal.
_ROLE_LOCALPARTS: frozenset[str] = frozenset({
    "info", "noreply", "no-reply", "donotreply", "do-not-reply", "support",
    "sales", "hello", "contact", "team", "admin", "office", "mail", "help",
    "service", "billing", "accounts", "notifications", "notification", "news",
    "newsletter", "marketing", "careers", "jobs", "hr", "press", "webmaster",
    "postmaster", "abuse", "security", "privacy",
})


def normalize_email(addr: Optional[str]) -> Optional[str]:
    """Lowercase + trim an address, or None if blank."""
    if not addr:
        return None
    addr = addr.strip().lower()
    return addr or None


def is_personal_address(addr: Optional[str]) -> bool:
    """True if ``addr`` is a specific person/box usable as identity — not a
    shared/role inbox (info@, noreply@, sales@ …) that many people send from."""
    norm = normalize_email(addr)
    if not norm or "@" not in norm:
        return False
    local = norm.split("@", 1)[0].split("+", 1)[0]  # drop any +tag
    return local not in _ROLE_LOCALPARTS


def canonicalize_against_known(
    raw_name: str,
    known_names: Iterable[str],
    raw_email: Optional[str] = None,
    known_by_email: Optional[dict] = None,
) -> Optional[str]:
    """Return the matched canonical from known_names, or None if no match.

    Match rules (first satisfied wins):
      0. Email identity — if ``raw_email`` is a personal address that an existing
         entity is known by (``known_by_email``: normalized-email -> name), that
         wins outright. Strongest, unambiguous signal.
      1. Exact name match after lowercasing + honorific-strip.
      2. Token-set subset in either direction (raw ⊆ candidate, or
         candidate ⊆ raw).

    When multiple candidates qualify under rule 2, the one with the most
    overlapping tokens wins; ties broken by longer (more specific) name.
    """
    norm_email = normalize_email(raw_email)
    if norm_email and is_personal_address(norm_email) and known_by_email:
        match = known_by_email.get(norm_email)
        if match:
            return match
    if not raw_name:
        return None
    raw_norm = _normalized(raw_name)
    raw_toks = _tokens(raw_name)
    if not raw_toks:
        return None

    candidates: list[tuple[int, int, str]] = []
    # (overlap_count, len_of_normalized_candidate, original_candidate_name)

    for name in known_names:
        if not name:
            continue
        cand_norm = _normalized(name)
        if cand_norm == raw_norm:
            return name  # exact match short-circuit
        cand_toks = _tokens(name)
        if not cand_toks:
            continue
        if raw_toks.issubset(cand_toks) or cand_toks.issubset(raw_toks):
            overlap = len(raw_toks & cand_toks)
            candidates.append((overlap, len(cand_norm), name))

    if not candidates:
        return None
    candidates.sort(key=lambda c: (-c[0], -c[1]))
    return candidates[0][2]


def canonicalize_or_keep(
    raw_name: str,
    known_names: Iterable[str],
    raw_email: Optional[str] = None,
    known_by_email: Optional[dict] = None,
) -> str:
    """canonicalize_against_known(...) but fall back to raw_name on no match."""
    matched = canonicalize_against_known(
        raw_name, known_names, raw_email=raw_email, known_by_email=known_by_email
    )
    return matched if matched is not None else raw_name
