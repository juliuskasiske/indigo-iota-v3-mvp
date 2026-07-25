"""End-to-end scope-gate checks against the REAL local embedding model.

Confirms the embedder + decision logic sort obvious mail correctly — the pure
math is covered in test_classify_decision.py; this guards the wiring. Skipped
automatically where fastembed isn't installed (e.g. a bare host); it runs in
the api container, which bakes the model.
"""
import pytest

pytest.importorskip("fastembed")

from src.ingestion.triage.classify import classify, INCLUDE_BUCKET  # noqa: E402

# Distinctive anchors per bucket so the model's verdict is unambiguous.
DEFINITIONS = {
    "margin": 0.03,
    "buckets": {
        "in_scope": {
            "anchors": [
                "Lattice Pay merchant onboarding API integration",
                "project milestone delivery schedule for the payment platform",
            ],
        },
        "redzone": {
            "anchors": [
                "employee salary and compensation review",
                "confidential HR disciplinary investigation and termination",
                "attorney-client privileged legal advice",
            ],
        },
        "spam": {
            "anchors": [
                "congratulations you won a free prize claim now",
                "limited time discount offer buy now",
            ],
        },
        "out_of_scope": {
            "anchors": [
                "let's grab lunch this weekend",
                "your amazon package has shipped",
            ],
        },
    },
}


def test_clear_in_scope_is_included():
    d = classify(
        "Following up on the Lattice Pay merchant onboarding API milestones "
        "for next sprint's delivery schedule.",
        DEFINITIONS,
    )
    assert d.include is True
    assert d.bucket == INCLUDE_BUCKET


def test_spam_is_excluded():
    d = classify(
        "CONGRATULATIONS!!! You have WON a FREE prize — claim your limited "
        "time discount now!!!",
        DEFINITIONS,
    )
    assert d.include is False
    assert d.bucket == "spam"


def test_sensitive_mail_is_kept_out():
    d = classify(
        "Confidential: the employee's salary review and the disciplinary "
        "termination decision from HR.",
        DEFINITIONS,
    )
    assert d.include is False
    assert d.bucket == "redzone"


def test_empty_text_is_excluded_as_out_of_scope():
    d = classify("   ", DEFINITIONS)
    assert d.include is False
    assert d.bucket == "out_of_scope"
