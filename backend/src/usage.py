"""LLM token-usage counter.

The Agent base class records the usage from each chat-completion response.
The dashboard reads snapshot() for /api/usage and re-broadcasts after
every record() so the UI counter ticks live.
"""
from __future__ import annotations
import threading
from typing import Dict


_lock = threading.Lock()
_stats: Dict[str, int] = {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0,
    "calls": 0,
}


def record(prompt_tokens: int, completion_tokens: int) -> Dict[str, int]:
    """Add to the running totals. Returns the current snapshot."""
    with _lock:
        _stats["prompt_tokens"] += prompt_tokens
        _stats["completion_tokens"] += completion_tokens
        _stats["total_tokens"] += prompt_tokens + completion_tokens
        _stats["calls"] += 1
        return dict(_stats)


def snapshot() -> Dict[str, int]:
    """Current totals."""
    with _lock:
        return dict(_stats)


def reset() -> None:
    """Zero everything."""
    with _lock:
        for k in _stats:
            _stats[k] = 0
