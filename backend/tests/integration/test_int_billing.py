"""Integration test: the prepaid-credit ceiling, against the real control plane.

This is the spend guardrail that keeps a pilot from running up an open-ended
bill: a workspace can spend exactly the credits it funded, never more. We drive
the REAL path — ``grant_credits`` writes a real credit entry, the
``org_credit_balance`` view aggregates it, ``balance`` reads it back, and
``enforce_credit_limit`` decides — all against the throwaway control DB.

No LLM and no tokens are needed: enforcement is pure arithmetic over the
credits ledger, checked BEFORE any model call would fire.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from src.billing import metering
from src.billing.metering import CreditLimitExceeded


def test_unfunded_workspace_is_blocked_immediately(make_org):
    org_id = make_org("nofunds")["org_id"]
    # granted 0, spent 0 -> projected 0 >= granted 0 -> blocked (paused).
    with pytest.raises(CreditLimitExceeded):
        metering.enforce_credit_limit(org_id)


def test_funded_workspace_passes_until_projection_hits_the_ceiling(make_org):
    org_id = make_org("funded")["org_id"]
    metering.grant_credits(org_id, Decimal("5"), note="integration test grant")

    bal = metering.balance(org_id)
    assert bal["credits_granted"] == Decimal("5")
    assert bal["credits_spent"] == Decimal("0")

    # Well under the ceiling: allowed.
    metering.enforce_credit_limit(org_id)  # must not raise
    metering.enforce_credit_limit(org_id, estimated_cost=Decimal("4.99"))  # must not raise

    # A call that WOULD push projected spend to the funded amount is blocked.
    with pytest.raises(CreditLimitExceeded):
        metering.enforce_credit_limit(org_id, estimated_cost=Decimal("5"))


def test_topping_up_credits_lifts_the_block(make_org):
    org_id = make_org("topup")["org_id"]
    metering.grant_credits(org_id, Decimal("2"))

    # At the ceiling -> blocked.
    with pytest.raises(CreditLimitExceeded):
        metering.enforce_credit_limit(org_id, estimated_cost=Decimal("2"))

    # Admin tops up; the same call now clears.
    metering.grant_credits(org_id, Decimal("3"), kind="adjustment")
    assert metering.balance(org_id)["credits_granted"] == Decimal("5")
    metering.enforce_credit_limit(org_id, estimated_cost=Decimal("2"))  # must not raise
