"""TranslatorAgent: render non-English email text into English before comprehend.

Policy decision: the brain is English-only. Brain pages, the knowledge graph,
chunks, embeddings, and keyword (FTS) search are all built from English text, so
a German email is translated to English ONCE here — at the top of the comprehend
pipeline — and everything downstream is English by construction.

Where this sits in the pipeline:
    capture -> TRIAGE (scope gate) -> comprehend[translate -> identify -> ...]
The scope gate runs earlier, at capture time, on the raw (possibly German) text
and uses a *multilingual* embedding model, so spam/redzone is still dropped
cheaply BEFORE we ever pay for a translation. Only in-scope emails reach here
and get translated.

Cost control: we don't blindly translate every email — an English-only customer
should pay nothing extra. ``looks_german`` is a cheap, dependency-free signal
(umlauts/ß, or a cluster of common German function words); only text that trips
it gets the (metered) LLM translation call. Everything else passes through
untouched.
"""
from __future__ import annotations

from src.billing import metering
from src.ingestion.comprehend.agents.base import Agent


# Common German function words. These are short, extremely frequent, and rare as
# whole words in English, so a small cluster of them is a strong German signal
# even when an email happens to carry no umlauts.
_GERMAN_STOPWORDS: frozenset[str] = frozenset({
    "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "einen", "einem",
    "ich", "sie", "wir", "mit", "für", "auf", "von", "zu", "den", "dem", "des",
    "im", "am", "wird", "werden", "haben", "hat", "sein", "sehr", "auch", "noch",
    "nur", "oder", "aber", "wenn", "dann", "weil", "dass", "bitte", "danke",
    "freundlichen", "grüßen", "sehr", "geehrte", "geehrter", "herr", "frau",
})

# Characters that essentially only appear in German (vs. English) text.
_GERMAN_CHARS = frozenset("äöüÄÖÜß")

# How many distinct German function-word HITS before we treat the text as German
# on stopwords alone (umlauts/ß short-circuit to German immediately).
_STOPWORD_THRESHOLD = 3


def looks_german(text: str) -> bool:
    """Cheap, dependency-free heuristic: does this text look like German?

    True if it contains any German-specific character (ä/ö/ü/ß), or if it uses
    at least ``_STOPWORD_THRESHOLD`` common German function words. Tuned to avoid
    false positives on English (so English-only customers never pay for an
    unnecessary translation call) while reliably catching real German emails.
    """
    if not text:
        return False
    if any(ch in _GERMAN_CHARS for ch in text):
        return True
    words = text.lower().split()
    hits = sum(1 for w in (w.strip(".,;:!?\"'()[]") for w in words) if w in _GERMAN_STOPWORDS)
    return hits >= _STOPWORD_THRESHOLD


class TranslatorAgent(Agent):
    """Translate text to English. Used only when ``looks_german`` is True."""

    # Labels the metered usage so translation cost is attributable in the ledger.
    request_kind: str = "translation"

    # Translation output is roughly as long as the input; an email body can run
    # long, so give it generous headroom (most bodies are far under this).
    _MAX_TOKENS = 4000

    def run(self, text: str) -> str:
        """Return the English translation, or the original text on any failure.

        Falls back to the original (never raises) so a translation hiccup
        degrades to "comprehend the German text as-is" rather than dropping the
        email — the multilingual model still gives partial value downstream.
        """
        cleaned = (text or "").strip()
        if not cleaned:
            return text
        prompt = (
            "Translate the text below into English. Keep it faithful and "
            "complete. Preserve proper names, company names, email addresses, "
            "URLs, numbers, and the original line structure. Do NOT add notes, "
            "labels, or commentary. If the text is already English, return it "
            "unchanged. Output ONLY the translated text.\n\n"
            f"TEXT:\n{cleaned}"
        )
        try:
            out = self._call(prompt, max_tokens=self._MAX_TOKENS)
        except metering.CreditLimitExceeded:
            # The hard credit cap must stop the run cleanly (the runner catches
            # it), so let it propagate instead of degrading to untranslated.
            raise
        except Exception:
            return text
        out = (out or "").strip()
        return out or text


def translate_if_needed(translator: TranslatorAgent, text: str) -> str:
    """Translate ``text`` to English only when it looks German; else pass through."""
    if looks_german(text):
        return translator.run(text)
    return text
