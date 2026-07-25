"""Tiny in-process pub/sub bus.

Producers (e.g. the email pipeline, the Agent base class) call publish().
Consumers (the dashboard's SSE handler) call subscribe() to get a thread-
safe Queue they drain. Safe to publish from a worker thread and consume
from the asyncio loop (via asyncio.to_thread).
"""
from __future__ import annotations
import threading
from queue import Empty, Queue
from typing import Dict, List


_subscribers: List[Queue] = []
_lock = threading.Lock()


def subscribe() -> Queue:
    """Register a new subscriber. Returns a Queue the caller drains."""
    q: Queue = Queue()
    with _lock:
        _subscribers.append(q)
    return q


def unsubscribe(q: Queue) -> None:
    """Remove a subscriber. Idempotent."""
    with _lock:
        if q in _subscribers:
            _subscribers.remove(q)


def publish(event_type: str, data: Dict) -> None:
    """Fan-out an event to every subscriber. Safe from any thread."""
    payload = {"type": event_type, "data": data}
    with _lock:
        for q in _subscribers:
            q.put(payload)


def drain(q: Queue) -> List[Dict]:
    """Pull every available event from a queue without blocking."""
    out: List[Dict] = []
    while True:
        try:
            out.append(q.get_nowait())
        except Empty:
            return out
