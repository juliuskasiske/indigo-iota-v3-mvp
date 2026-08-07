"""The objective's target arithmetic and headline staleness.

`resolved_target` is the number the Sizer is briefed with AND the denominator of
the coverage bar, so if it drifts, the agents and the UI quietly disagree about
what the program is.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.db.objective import Objective, describe, readback


def _obj(**kw) -> Objective:
    base = dict(
        impact_metric="revenue",
        impact_type="recurring",
        currency="EUR",
        baseline_amount=Decimal("6200000"),
    )
    base.update(kw)
    return Objective(**base)


# --- resolved_target --------------------------------------------------------

def test_absolute_target_is_the_number_itself():
    obj = _obj(target_basis="absolute", target_amount=Decimal("12400000"))
    assert obj.resolved_target() == Decimal("12400000")


def test_percent_target_is_an_uplift_on_the_baseline():
    obj = _obj(target_basis="percent", target_amount=Decimal("25"))
    assert obj.resolved_target() == Decimal("7750000")  # 6.2M + 25%


def test_multiple_target_is_a_factor_of_the_baseline():
    obj = _obj(target_basis="multiple", target_amount=Decimal("2"))
    assert obj.resolved_target() == Decimal("12400000")


def test_absolute_target_needs_no_baseline():
    obj = _obj(baseline_amount=None, target_basis="absolute", target_amount=Decimal("9000000"))
    assert obj.resolved_target() == Decimal("9000000")


def test_relative_targets_are_meaningless_without_a_baseline():
    # Better to return nothing than to invent a denominator: the UI hides the
    # coverage bar and the Sizer prompt simply omits the target.
    for basis in ("percent", "multiple"):
        obj = _obj(baseline_amount=None, target_basis=basis, target_amount=Decimal("2"))
        assert obj.resolved_target() is None


def test_no_target_at_all_resolves_to_none():
    assert _obj(target_amount=None).resolved_target() is None


# --- headline staleness -----------------------------------------------------

def _now():
    return datetime.now(timezone.utc)


def test_headline_is_stale_when_the_objective_changed_after_it_was_written():
    obj = _obj(headline="Grow revenue.", headline_at=_now() - timedelta(hours=1),
               updated_at=_now())
    assert obj.headline_stale is True


def test_headline_is_fresh_when_written_after_the_last_edit():
    obj = _obj(headline="Grow revenue.", headline_at=_now(),
               updated_at=_now() - timedelta(hours=1))
    assert obj.headline_stale is False


def test_an_empty_headline_is_never_stale():
    # Nothing has been claimed yet, so there is nothing to be out of date.
    assert _obj(headline="", updated_at=_now()).headline_stale is False


def test_a_headline_with_no_timestamp_is_treated_as_stale():
    assert _obj(headline="Grow revenue.", headline_at=None).headline_stale is True


# --- rendering --------------------------------------------------------------

def test_ranked_labels_honour_rank_not_array_order():
    obj = _obj(priorities=[
        {"label": "Win rate", "rank": 1},
        {"label": "Revenue growth", "rank": 0},
    ])
    assert obj.ranked_labels() == ["Revenue growth", "Win rate"]


def test_readback_states_the_program_without_a_model():
    obj = _obj(target_basis="multiple", target_amount=Decimal("2"), run_rate_year=2027)
    text = readback(obj)
    assert "EUR 6.2M" in text and "EUR 12.4M" in text
    assert "recurring run-rate" in text and "FY2027" in text


def test_describe_briefs_an_agent_with_every_constraint():
    from datetime import date

    obj = _obj(
        priorities=[{"label": "Revenue growth", "rank": 0}],
        target_basis="multiple", target_amount=Decimal("2"),
        run_rate_year=2027, program_end_date=date(2027, 12, 31),
        reporting_cadence="monthly", context="Do not cut Ops headcount.",
    )
    brief = describe(obj)
    assert "Revenue growth" in brief
    assert "EUR 12.4M" in brief
    assert "FY2027" in brief
    assert "2027-12-31" in brief
    assert "monthly" in brief
    assert "Do not cut Ops headcount." in brief


def test_custom_metric_uses_the_label_the_user_typed():
    obj = _obj(impact_metric="custom", impact_metric_label="contribution margin")
    assert obj.metric_label == "contribution margin"


def test_money_drops_trailing_zeros():
    # "EUR 6.20M" reads as false precision on an estimate.
    from src.db.objective import _fmt_amount

    assert _fmt_amount(Decimal("6200000"), "EUR") == "EUR 6.2M"
    assert _fmt_amount(Decimal("12000000"), "EUR") == "EUR 12M"
    assert _fmt_amount(Decimal("450000"), "EUR") == "EUR 450k"
