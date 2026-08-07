"""The swarm's LLM call: metered, capped, retried, and honest about truncation.

The swarm used to build a fresh OpenAI client per call and return
``resp.choices[0].message.content or ""`` — no retry, no concurrency limit, no
usage recording, and no credit enforcement. That was survivable when the loop
made five calls a run; the restructured loop makes forty, so this brings it in
line with ``ingestion/comprehend/agents/base.py::_call``.

Two things here are load-bearing and easy to get wrong:

``org_id`` is an explicit PARAMETER, never the ambient contextvar.
    ``swarm.start`` spawns a detached ``asyncio.create_task`` and the LLM call
    then runs in a default-executor thread. ``run_in_executor`` does not copy
    contextvars, and ``create_task`` snapshots the context at creation — from a
    request handler that never set the org. So ``metering.current_org()`` is
    ``None`` inside the loop, and every swarm call would land as unattributed
    system usage: free to the customer and invisible in their spend. Passing it
    down cannot silently regress the way a contextvar can.

``finish_reason == "length"`` is logged loudly.
    A truncated completion is an unclosed JSON document. It parses to nothing,
    the agent falls back to its heuristic, and the tree quietly comes out
    shallower than it should — with no error anywhere. Reasoning models make
    this the common case rather than the rare one, because their reasoning
    tokens consume the same budget as the answer.
"""
from __future__ import annotations

import logging
import os
import random
import threading
import time
from functools import lru_cache

from src import config, events, usage
from src.billing import metering

log = logging.getLogger("iota.swarm.llm")

# All swarm spend is metered under one kind so it can be told apart from
# ingestion and Q&A in the usage breakdowns.
REQUEST_KIND = "swarm"

_MAX_RETRIES = 4
_RETRY_BASE_DELAY = 0.8

# The same global throttle the comprehend agents respect, so a swarm run and a
# backfill running together cannot together exceed the provider's limit.
_MAX_CONCURRENCY = int(os.environ.get("LLM_BASE_MAX_CONCURRENCY", "4"))
_concurrent_calls = threading.Semaphore(_MAX_CONCURRENCY)


class EmptyCompletion(RuntimeError):
    """The provider returned no usable content (often a truncated reasoning model)."""


def _retryable():
    import openai

    return (
        openai.RateLimitError,
        openai.APITimeoutError,
        openai.APIConnectionError,
        openai.InternalServerError,
    )


@lru_cache(maxsize=1)
def _client():
    """One client for the whole process, not one per call."""
    from openai import OpenAI

    return OpenAI(api_key=config.LLM_BASE_API_KEY, base_url=config.LLM_BASE_BASE_URL)


def enabled() -> bool:
    return bool(
        config.LLM_BASE_API_KEY and config.LLM_BASE_BASE_URL and config.LLM_BASE_MODEL
    )


def call(
    system: str,
    user: str,
    *,
    max_tokens: int,
    org_id: int | None,
    agent_name: str,
) -> str:
    """One metered chat completion. Raises rather than returning something unusable.

    Raises ``CreditLimitExceeded`` when the workspace is out of credits (the
    caller stops the run cleanly) and ``EmptyCompletion`` when the provider
    returns nothing usable (the caller falls back to its heuristic).
    """
    # Hard credit cap BEFORE the call fires, so an out-of-credits workspace
    # cannot burn tokens through the swarm the way it could before.
    metering.enforce_credit_limit(org_id)

    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            with _concurrent_calls:
                resp = _client().chat.completions.create(
                    model=config.LLM_BASE_MODEL,
                    max_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                )

            # Meter first: the tokens were spent whether or not the answer is
            # usable, and an unbilled failure is still a real cost.
            u = getattr(resp, "usage", None)
            if u is not None and getattr(u, "prompt_tokens", None) is not None:
                snapshot = usage.record(u.prompt_tokens, u.completion_tokens)
                events.publish("usage_updated", snapshot)
                metering.record_safe(
                    model=getattr(resp, "model", None) or config.LLM_BASE_MODEL,
                    prompt_tokens=u.prompt_tokens or 0,
                    completion_tokens=u.completion_tokens or 0,
                    org_id=org_id,
                    request_kind=REQUEST_KIND,
                    agent_name=agent_name,
                    request_id=getattr(resp, "id", None),
                )

            choice = resp.choices[0]
            content = choice.message.content
            finish = getattr(choice, "finish_reason", None)

            if finish == "length":
                log.warning(
                    "swarm %s hit max_tokens (%d) — the response is truncated and its "
                    "JSON is probably unclosed",
                    agent_name,
                    max_tokens,
                )
            if not content or not content.strip():
                # Reasoning models spend the whole budget on reasoning tokens and
                # return content=None. Say so instead of returning "" and letting
                # the caller think the model had nothing to add.
                raise EmptyCompletion(
                    f"{agent_name}: empty completion (finish_reason={finish!r}). "
                    f"If {config.LLM_BASE_MODEL} is a reasoning model, its reasoning "
                    f"tokens are consuming the {max_tokens}-token budget."
                )
            return content

        except _retryable() as exc:
            last_exc = exc
            if attempt == _MAX_RETRIES - 1:
                raise
            delay = _RETRY_BASE_DELAY * (2**attempt) + random.uniform(0, _RETRY_BASE_DELAY)
            time.sleep(delay)

    raise last_exc  # pragma: no cover — the last attempt re-raises
