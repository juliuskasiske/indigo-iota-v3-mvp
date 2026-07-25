"""Unit tests for the billing arithmetic (no database, no network, no LLM).

These pin the money math that the ledger and the customer-facing figures rely
on: exact per-token cost, the single x10 markup applied on the way out and
undone on the way in, and the pipeline fan-out token estimate. All pure
functions — they run in milliseconds and never touch the control DB.
"""
from decimal import Decimal

from src.billing.metering import (
    AVG_OUTPUT_TOKENS_PER_CALL,
    CUSTOMER_MARKUP,
    ESTIMATE_MARKUP,
    PIPELINE_CALLS_PER_ENTITY,
    _cost,
    _pipeline_tokens,
    from_customer_facing,
    to_customer_facing,
)


def test_cost_is_exact_per_million_tokens():
    # 1,000,000 tokens at $3 / Mtok == exactly $3.
    assert _cost(1_000_000, Decimal(3)) == Decimal(3)
    assert _cost(500_000, Decimal(2)) == Decimal(1)
    assert _cost(0, Decimal(99)) == Decimal(0)


def test_cost_uses_exact_decimal_not_float():
    # 333,333 tokens at $1/Mtok — must be exact decimal, no float drift.
    assert _cost(333_333, Decimal(1)) == Decimal("0.333333")


def test_markup_is_ten_x():
    assert CUSTOMER_MARKUP == Decimal(10)
    assert ESTIMATE_MARKUP == Decimal(10)
    # The quote markup and the live-spend markup are the SAME factor (so a
    # backfill estimate and the spend it becomes stay consistent).
    assert CUSTOMER_MARKUP == ESTIMATE_MARKUP


def test_to_customer_facing_multiplies_by_markup():
    assert to_customer_facing(Decimal("1.50")) == Decimal("15.00")


def test_from_customer_facing_divides_by_markup():
    assert from_customer_facing(Decimal("15")) == Decimal("1.5")


def test_markup_round_trip_is_lossless():
    raw = Decimal("2.7340")
    assert from_customer_facing(to_customer_facing(raw)) == raw


def test_markup_passes_none_through():
    # An uncapped budget / unknown amount stays None, never becomes 0.
    assert to_customer_facing(None) is None
    assert from_customer_facing(None) is None


def test_pipeline_tokens_fan_out():
    # 1 identifier call + 4 agents per entity, and the body is re-read each call.
    body, entities = 100, 2
    calls = 1 + PIPELINE_CALLS_PER_ENTITY * entities  # 9
    in_tok, out_tok = _pipeline_tokens(body, entities)
    assert in_tok == body * calls            # 900
    assert out_tok == AVG_OUTPUT_TOKENS_PER_CALL * calls  # 1620


def test_pipeline_tokens_with_no_entities_is_just_the_identifier_call():
    in_tok, out_tok = _pipeline_tokens(50, 0)
    assert in_tok == 50 * 1
    assert out_tok == AVG_OUTPUT_TOKENS_PER_CALL * 1
