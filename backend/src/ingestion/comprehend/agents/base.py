"""The Agent base class. Holds the shared LLM-call machinery."""
from __future__ import annotations
import json
import os
import random
import threading
import time

import openai
from openai import OpenAI
from dotenv import load_dotenv

from src import events, usage
from src.billing import metering

load_dotenv()


# Errors worth retrying — transient network / rate-limit / 5xx. Things
# like AuthenticationError or BadRequestError should fail fast.
_RETRYABLE_LLM_ERRORS = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.InternalServerError,
)
_MAX_LLM_RETRIES = 5      # total attempts; 1 try + 4 retries
_RETRY_BASE_DELAY = 0.8   # seconds; exponential backoff base

# Global concurrency cap on LLM calls across every Agent + every thread.
# LLMBase returns 429 'too_many_concurrent_requests' when the orchestration
# layer fans out aggressively (8 entities × 4 agents = 32 in flight was
# enough to saturate them). The semaphore queues callers down to this many.
# Tune via LLM_BASE_MAX_CONCURRENCY in .env; the default is conservative.
_DEFAULT_CONCURRENCY = 4
_concurrent_llm_calls = threading.Semaphore(
    int(os.environ.get("LLM_BASE_MAX_CONCURRENCY", _DEFAULT_CONCURRENCY))
)


def _extract_json_block(text: str) -> str | None:
    """Return the first balanced {...} or [...] block in ``text``, or None.

    Reasoning models narrate around the JSON ("Let me think… {json} …done"), so a
    plain json.loads fails. This scans for the first opener and matches to its
    balanced closer, ignoring braces inside strings.
    """
    start = None
    for i, ch in enumerate(text):
        if ch in "{[":
            start = i
            break
    if start is None:
        return None
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _meter(*, model, configured_model, usage_obj, request_kind, agent_name, request_id) -> None:
    """Forward an OpenAI-style response's token counts to the durable metering
    ledger, which costs them against the effective-dated price book."""
    meta = None
    if configured_model and configured_model != model:
        meta = {"configured_model": configured_model}
    metering.record_safe(
        model=model,
        prompt_tokens=getattr(usage_obj, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(usage_obj, "completion_tokens", 0) or 0,
        request_kind=request_kind,
        agent_name=agent_name,
        request_id=request_id,
        meta=meta,
    )


class Agent:
    """Parent of all agents. Subclasses only write a prompt and parse a result.

    `_call` is thread-safe: the OpenAI Python SDK uses a thread-safe HTTP
    client under the hood, and we only ever read instance state inside.
    The pipeline fans out agent calls across threads to compress the wall
    clock of multi-LLM-call sequences (per-entity + per-email parallelism).
    """

    # Labels the metered usage. Subclasses (e.g. the Q&A AnswerAgent) override it.
    request_kind: str = "comprehension"

    def __init__(self):
        self.client = OpenAI(
            api_key=os.environ["LLM_BASE_API_KEY"],
            base_url=os.environ["LLM_BASE_BASE_URL"],
        )
        self.model = os.environ["LLM_BASE_MODEL"]

    def _call(self, prompt: str, max_tokens: int = 500, system: str | None = None) -> str:
        """Send a prompt to the model, return the raw text response.

        ``system`` is an optional system message prepended to the conversation —
        use it to set the model's role / standing instructions (e.g. the Q&A
        agent's "be thorough and exhaustive" brief) separately from the per-call
        user prompt.

        Acquires the global concurrency semaphore around the network
        call so we never exceed LLMBase's concurrent-request limit,
        regardless of how aggressively the orchestration layer fans
        out. Retries up to 5 times on transient errors (429 / timeout
        / 5xx) with exponential backoff + jitter. Token usage is
        recorded to src.usage and broadcast as `usage_updated`.
        """
        # Hard credit cap: block BEFORE the call fires if the org is over its
        # limit. Raises CreditLimitExceeded (not retryable) so it propagates and
        # aborts; no-op for system usage (no org in context).
        metering.enforce_credit_limit()
        last_exc: Exception | None = None
        for attempt in range(_MAX_LLM_RETRIES):
            try:
                # Semaphore released as soon as the API call returns
                # (or raises); the retry backoff sleep happens OUTSIDE
                # so we don't hold a slot while idle.
                messages = (
                    [{"role": "system", "content": system}] if system else []
                ) + [{"role": "user", "content": prompt}]
                with _concurrent_llm_calls:
                    resp = self.client.chat.completions.create(
                        model=self.model,
                        max_tokens=max_tokens,
                        messages=messages,
                    )
                u = getattr(resp, "usage", None)
                if u is not None and getattr(u, "prompt_tokens", None) is not None:
                    snapshot = usage.record(u.prompt_tokens, u.completion_tokens)
                    events.publish("usage_updated", snapshot)
                    # Durable, costed metering. Best-effort: a billing/DB hiccup
                    # must never break comprehension, so swallow + log and move on.
                    _meter(
                        model=getattr(resp, "model", None) or self.model,
                        configured_model=self.model,
                        usage_obj=u,
                        request_kind=self.request_kind,
                        agent_name=type(self).__name__,
                        request_id=getattr(resp, "id", None),
                    )
                return resp.choices[0].message.content
            except _RETRYABLE_LLM_ERRORS as exc:
                last_exc = exc
                if attempt == _MAX_LLM_RETRIES - 1:
                    raise
                # Exponential backoff with jitter so retried callers
                # don't reconverge on the API at the same moment.
                delay = _RETRY_BASE_DELAY * (2 ** attempt)
                delay += random.uniform(0, _RETRY_BASE_DELAY)
                time.sleep(delay)
        # Defensive — unreachable because the last attempt re-raises.
        raise last_exc  # type: ignore[misc]

    def _call_json(self, prompt: str, default, max_tokens: int = 500):
        """
        Send a prompt expecting JSON. Parse defensively: on malformed JSON,
        return `default` instead of crashing (cheap models are unreliable).

        Handles reasoning models that wrap the JSON in explanatory prose (and
        ```-fences) by extracting the outermost {...} or [...] block before parsing.
        """
        raw = self._call(prompt, max_tokens)
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        # Fall back: pull out the first balanced object/array from the surrounding
        # text (reasoning models often narrate around the JSON).
        snippet = _extract_json_block(cleaned)
        if snippet is not None:
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                pass
        return default
