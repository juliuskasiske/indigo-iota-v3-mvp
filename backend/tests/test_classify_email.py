"""End-to-end sanity tests for the email scope classifier.

Unlike test_classify_decision.py (which pins the pure include/exclude math with
hand-made numbers), these run the FULL classify() path on real email text: the
text is embedded locally (fastembed, no LLM, no network at runtime) and matched
against the buckets defined in classification.yaml.

We only assert clearly-separable cases — an obvious in-scope note, obvious spam,
and the security-critical one: a privileged/legal email must be EXCLUDED. We
deliberately do NOT assert borderline text here; that lives in the deterministic
number-based tests, which can't drift with the model.

Needs the local embedding model available (skipped if fastembed isn't
installed). No LLM tokens, no network calls at classify time.
"""
import pytest

pytest.importorskip("fastembed")

from src.ingestion.triage.classify import INCLUDE_BUCKET, classify  # noqa: E402


def test_obvious_in_scope_email_is_included():
    text = (
        "Project kickoff agenda and milestone plan for the engagement. Here is a "
        "status update on the deliverables and next steps with the client team, "
        "plus review feedback on the draft we sent for the agreed scope of work."
    )
    d = classify(text)
    assert d.include is True
    assert d.bucket == INCLUDE_BUCKET


def test_obvious_spam_is_excluded():
    text = (
        "Limited time offer — click here to unsubscribe from our newsletter. "
        "Huge discount today only, act now to claim your free trial!"
    )
    d = classify(text)
    assert d.include is False
    assert d.bucket == "spam"


def test_privileged_legal_email_is_excluded_as_redzone():
    # The single worst-case failure for a pilot: sensitive mail leaking in.
    text = (
        "Privileged and confidential: legal advice from outside counsel regarding "
        "the settlement discussion for the pending litigation. Do not forward."
    )
    d = classify(text)
    assert d.include is False
    assert d.bucket == "redzone"


def test_unrelated_personal_chat_is_excluded():
    text = "Hey, want to grab lunch this weekend? Let's sort out the weekend logistics."
    d = classify(text)
    assert d.include is False


def test_empty_text_is_excluded_without_a_model_call():
    # Deterministic guard: empty input never reaches the model and is dropped.
    d = classify("   ")
    assert d.include is False
    assert d.bucket == "out_of_scope"
