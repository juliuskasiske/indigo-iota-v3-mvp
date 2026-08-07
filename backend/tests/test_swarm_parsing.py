"""The swarm's parsing and cost guards — the parts that must not break on junk.

Cheap models return fenced JSON, narrate around it, cite evidence that does not
exist, and occasionally return nothing at all. None of that may crash a run or
silently fabricate a citation.
"""
import pytest

from src.agents import swarm
from src.db import hypothesis as tree


# --- JSON parsing -----------------------------------------------------------

def test_parses_plain_json():
    assert swarm._parse('{"a": 1}') == {"a": 1}


def test_parses_fenced_json():
    assert swarm._parse('```json\n{"a": 1}\n```') == {"a": 1}


def test_parses_json_a_reasoning_model_narrated_around():
    raw = 'Let me think about this.\n{"verdict": "supported"}\nThat is my answer.'
    assert swarm._parse(raw) == {"verdict": "supported"}


def test_parses_braces_inside_strings_correctly():
    # A regex-greedy extractor gets this wrong; the balanced scanner does not.
    raw = 'prose {"note": "a } inside a string", "ok": true} trailing'
    assert swarm._parse(raw) == {"note": "a } inside a string", "ok": True}


def test_returns_none_on_truncated_json():
    # A response cut off by max_tokens must fail cleanly, not half-parse.
    assert swarm._parse('{"branches": [{"label": "Pri') is None


def test_returns_none_on_empty_or_garbage():
    assert swarm._parse("") is None
    assert swarm._parse("no json here at all") is None


# --- citation resolution ----------------------------------------------------

EVIDENCE = [
    {"text": "a", "source": "s1", "page_path": None},
    {"text": "b", "source": "s2", "page_path": None},
    {"text": "c", "source": "s3", "page_path": None},
]


def test_resolves_cited_indices_in_order():
    assert [e["text"] for e in swarm._cited([2, 0], EVIDENCE)] == ["c", "a"]


def test_hallucinated_indices_are_dropped_not_fabricated():
    # The model citing [9] against a 3-item list must not IndexError, and must
    # not silently attach the wrong fact either.
    assert [e["text"] for e in swarm._cited([9, 1, -3], EVIDENCE)] == ["b"]


def test_duplicate_citations_are_deduped():
    assert len(swarm._cited([1, 1, 1], EVIDENCE)) == 1


def test_non_numeric_citations_are_ignored():
    assert swarm._cited(["banana", None, {}], EVIDENCE) == []


def test_citations_that_are_not_a_list_are_ignored():
    assert swarm._cited("0", EVIDENCE) == []


# --- normalisation ----------------------------------------------------------

def test_str_list_accepts_a_semicolon_separated_string():
    # Models routinely return a sentence where a list was asked for.
    out = swarm._str_list("first; second; third")
    assert out == ["first", "second", "third"]


def test_str_list_drops_empties_and_caps_length():
    assert swarm._str_list(["a", "", None, "b", "c", "d", "e", "f"], 3) == ["a", "b", "c"]


# --- cost guards ------------------------------------------------------------

def test_budget_stops_at_the_limit():
    budget = swarm._Budget(limit=3)
    assert [budget.take("decomposition") for _ in range(5)] == [True, True, True, False, False]
    assert budget.used == 3


def test_budget_tracks_calls_per_role():
    budget = swarm._Budget(limit=10)
    budget.take("sizer")
    budget.take("sizer")
    budget.take("judge")
    assert budget.by_role == {"sizer": 2, "judge": 1}


def test_ask_makes_no_call_once_the_budget_is_spent(monkeypatch):
    monkeypatch.setattr(swarm.llm, "enabled", lambda: True)
    calls = []
    monkeypatch.setattr(swarm.llm, "call", lambda *a, **k: calls.append(1) or '{"ok":1}')

    budget = swarm._Budget(limit=1)
    assert swarm._ask("s", "u", role="judge", org_id=None, budget=budget, max_tokens=10)
    assert swarm._ask("s", "u", role="judge", org_id=None, budget=budget, max_tokens=10) is None
    assert len(calls) == 1


def test_ask_returns_none_when_no_model_is_configured(monkeypatch):
    monkeypatch.setattr(swarm.llm, "enabled", lambda: False)
    budget = swarm._Budget()
    assert swarm._ask("s", "u", role="judge", org_id=None, budget=budget, max_tokens=10) is None
    assert budget.used == 0  # a call that never fired must not be billed


def test_credit_limit_propagates_rather_than_being_swallowed(monkeypatch):
    """An out-of-credits workspace must stop the run, not fall back to heuristics.

    Every other failure is caught and degraded; this one has to reach `_loop` so
    the run can end with an honest "out of credits" instead of quietly producing
    a heuristic tree the customer never paid for.
    """
    from decimal import Decimal

    from src.billing.metering import CreditLimitExceeded

    monkeypatch.setattr(swarm.llm, "enabled", lambda: True)

    def boom(*a, **k):
        raise CreditLimitExceeded(1, Decimal("100"), Decimal("100"))

    monkeypatch.setattr(swarm.llm, "call", boom)
    with pytest.raises(CreditLimitExceeded):
        swarm._ask("s", "u", role="sizer", org_id=1, budget=swarm._Budget(), max_tokens=10)


def test_other_llm_failures_degrade_instead_of_killing_the_run(monkeypatch):
    monkeypatch.setattr(swarm.llm, "enabled", lambda: True)

    def boom(*a, **k):
        raise RuntimeError("provider had a moment")

    monkeypatch.setattr(swarm.llm, "call", boom)
    assert swarm._ask("s", "u", role="sizer", org_id=1, budget=swarm._Budget(), max_tokens=10) is None


# --- verdict fallback -------------------------------------------------------

def test_unproven_initiatives_never_default_to_supported():
    # Defaulting to the optimistic verdict is exactly the unearned confidence
    # the Judge exists to prevent.
    assert swarm._fallback_verdict({"supported": True, "facts": []}) == tree.STATUS_NEEDS_EVIDENCE
    assert swarm._fallback_verdict({"supported": False, "facts": [1]}) == tree.STATUS_NEEDS_EVIDENCE
    assert swarm._fallback_verdict({"supported": True, "facts": [1]}) == tree.STATUS_SUPPORTED


# --- coverage ---------------------------------------------------------------

def _initiative(amount, status="supported", value_type="recurring"):
    return {
        "id": 1, "parent_id": None, "kind": tree.KIND_INITIATIVE, "label": "x",
        "rationale": "", "mece_note": "", "status": status, "sort_order": 0,
        "evidence": [], "card": {"value_amount": amount, "value_type": value_type},
    }


def test_coverage_excludes_discarded_initiatives():
    nodes = [_initiative(1000), _initiative(9999, status=tree.STATUS_DISCARDED)]
    assert tree.coverage(nodes)["sized_total"] == 1000


def test_coverage_reports_one_time_value_separately():
    # Adding a one-off gain into a recurring run-rate goal is a modelling error,
    # so it is counted on its own line instead.
    nodes = [_initiative(1000), _initiative(500, value_type="one_time")]
    cov = tree.coverage(nodes, impact_type="recurring")
    assert cov["sized_total"] == 1000
    assert cov["one_time_total"] == 500


def test_coverage_counts_unsized_initiatives_but_not_their_value():
    nodes = [_initiative(1000), _initiative(None)]
    cov = tree.coverage(nodes)
    assert cov["initiatives"] == 2
    assert cov["initiatives_sized"] == 1


def test_coverage_splits_by_status():
    nodes = [_initiative(1000), _initiative(400, status=tree.STATUS_NEEDS_EVIDENCE)]
    cov = tree.coverage(nodes)
    assert cov["by_status"] == {"supported": 1000, "needs_evidence": 400}
