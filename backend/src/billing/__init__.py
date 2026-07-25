"""LLM metering + credit billing for Indigo Iota.

Every LLM API call is metered into the control plane with the model used, input
and output tokens kept separate, and the price that applied *at the time* frozen
into the row — so cost is measured accurately and never changes retroactively.

Prices are edited in ``backend/prices.yaml`` (USD per 1M tokens, input/output
separate). When that file changes, the new price is appended as a dated row to
the price history (``llm_model_prices``) automatically on the next LLM call — so
the DB keeps a full record of when each price took effect, with zero ceremony.

- ``metering`` — the chokepoint: record_llm_usage(), prices.yaml -> dated price
  history sync, credit grants + balance, and recosting of unpriced events.

CLI:
    python -m src.billing sync                  # apply prices.yaml now
    python -m src.billing prices                # show the dated price history
    python -m src.billing usage --slug acme
    python -m src.billing grant --slug acme --amount 100 --kind setup
    python -m src.billing balance --slug acme
    python -m src.billing recost
"""
