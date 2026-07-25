"""Trust-boundary tests for the scope gate's include/exclude logic.

These exercise the pure ``_decide`` step (no embedding model) so the
security-critical math — Layer-1 argmax and the Layer-2 redzone runoff — is
pinned deterministically. The single worst-case failure for a pilot is a
redzone email leaking into the brain, so the redzone paths are covered hardest.
"""
from src.ingestion.triage.classify import _decide, INCLUDE_BUCKET, REQUIRED_BUCKETS


def scores(in_scope, redzone, spam, out_of_scope):
    """Per-bucket scores in REQUIRED_BUCKETS order (in_scope first).

    classify() builds the dict in this order, and _decide's tie-breaking
    relies on it (max keeps the first key on a tie), so the tests must too.
    """
    s = {
        "in_scope": in_scope,
        "redzone": redzone,
        "spam": spam,
        "out_of_scope": out_of_scope,
    }
    assert list(s) == list(REQUIRED_BUCKETS)
    return s


# --- Layer 1: nearest bucket wins, only in_scope can be included -------------

def test_layer1_excludes_when_redzone_is_top():
    d = _decide(scores(0.40, 0.80, 0.10, 0.10), margin=0.03)
    assert d.include is False
    assert d.bucket == "redzone"
    assert d.layer2_applied is False
    assert "Layer 1" in d.reason


def test_layer1_excludes_when_spam_is_top():
    d = _decide(scores(0.20, 0.10, 0.75, 0.10), margin=0.03)
    assert d.include is False
    assert d.bucket == "spam"
    assert d.layer2_applied is False


def test_layer1_excludes_when_out_of_scope_is_top():
    d = _decide(scores(0.20, 0.10, 0.10, 0.75), margin=0.03)
    assert d.include is False
    assert d.bucket == "out_of_scope"
    assert d.layer2_applied is False


def test_includes_clear_in_scope():
    d = _decide(scores(0.80, 0.20, 0.10, 0.10), margin=0.03)
    assert d.include is True
    assert d.bucket == INCLUDE_BUCKET
    assert d.layer2_applied is True


# --- Layer 2: redzone runoff under the in_scope branch -----------------------

def test_layer2_excludes_redzone_within_margin():
    # in_scope is the Layer-1 winner, but redzone is close enough that the
    # margin tips it out: 0.48 + 0.03 >= 0.50.
    d = _decide(scores(0.50, 0.48, 0.10, 0.10), margin=0.03)
    assert d.include is False
    assert d.bucket == "redzone"
    assert d.layer2_applied is True
    assert "Layer 2" in d.reason


def test_layer2_boundary_is_inclusive_to_exclusion():
    # rz + margin == in_scope must EXCLUDE (>=). margin 0.0 keeps the float math
    # exact, so the boundary is unambiguous.
    excluded = _decide(scores(0.50, 0.50, 0.10, 0.10), margin=0.0)
    assert excluded.include is False
    assert excluded.bucket == "redzone"

    included = _decide(scores(0.50, 0.49, 0.10, 0.10), margin=0.0)
    assert included.include is True
    assert included.bucket == INCLUDE_BUCKET


def test_redzone_tie_with_in_scope_is_excluded():
    # The key security property: when redzone ties in_scope, in_scope wins the
    # Layer-1 argmax (first key) but the Layer-2 runoff still keeps it out.
    d = _decide(scores(0.70, 0.70, 0.10, 0.10), margin=0.0)
    assert d.include is False
    assert d.bucket == "redzone"
    assert d.layer2_applied is True


def test_spam_tie_with_in_scope_does_not_block():
    # A spam tie is not a security risk: in_scope wins Layer 1, and Layer 2 only
    # weighs redzone (low here), so the email is included.
    d = _decide(scores(0.70, 0.10, 0.70, 0.10), margin=0.0)
    assert d.include is True
    assert d.bucket == INCLUDE_BUCKET


def test_higher_margin_excludes_more():
    # Same scores, different caution levels: a wider margin flips include->exclude.
    s = scores(0.60, 0.50, 0.10, 0.10)
    assert _decide(s, margin=0.0).include is True       # balanced: 0.50 < 0.60
    assert _decide(s, margin=0.18).include is False      # strict:  0.68 >= 0.60


def test_scores_are_passed_through_unchanged():
    s = scores(0.80, 0.20, 0.10, 0.10)
    d = _decide(s, margin=0.03)
    assert d.scores == s
