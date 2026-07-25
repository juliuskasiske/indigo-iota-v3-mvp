"""Unit tests for GraphMailClient.probe_mailbox status mapping.

probe_mailbox is the live "can we actually read this mailbox?" check. We don't
call Microsoft here — we stand in for it with a fake HTTP response and assert
that each status code maps to the right verdict:

  200 -> readable, 403 -> blocked, 404 -> not_found, anything else -> error,
  and a network failure -> error (never an exception that crashes the caller).

The token call is stubbed too, so nothing touches the network.
"""
import httpx
import pytest

from src.ingestion.capture import graph_client
from src.ingestion.capture.graph_client import GraphConfig, GraphMailClient


class FakeResp:
    def __init__(self, status_code, text="body"):
        self.status_code = status_code
        self.text = text


@pytest.fixture
def client(monkeypatch):
    c = GraphMailClient(cfg=GraphConfig(tenant_id="t", client_id="c", client_secret="s"))
    # Never mint a real token / hit the network for auth.
    monkeypatch.setattr(c, "_access_token", lambda: "fake-token")
    return c


def _patch_get(monkeypatch, resp_or_exc):
    def fake_get(url, **kwargs):
        if isinstance(resp_or_exc, Exception):
            raise resp_or_exc
        return resp_or_exc
    monkeypatch.setattr(graph_client.httpx, "get", fake_get)


def test_200_is_readable(client, monkeypatch):
    _patch_get(monkeypatch, FakeResp(200))
    verdict, _ = client.probe_mailbox("box@acme.com")
    assert verdict == "readable"


def test_403_is_blocked(client, monkeypatch):
    _patch_get(monkeypatch, FakeResp(403))
    verdict, msg = client.probe_mailbox("box@acme.com")
    assert verdict == "blocked"
    assert "access policy" in msg.lower()


def test_404_is_not_found(client, monkeypatch):
    _patch_get(monkeypatch, FakeResp(404))
    verdict, _ = client.probe_mailbox("nope@acme.com")
    assert verdict == "not_found"


def test_other_status_is_error(client, monkeypatch):
    _patch_get(monkeypatch, FakeResp(500, text="boom"))
    verdict, msg = client.probe_mailbox("box@acme.com")
    assert verdict == "error"
    assert "500" in msg


def test_network_failure_is_error_not_exception(client, monkeypatch):
    _patch_get(monkeypatch, httpx.ConnectError("no route"))
    verdict, msg = client.probe_mailbox("box@acme.com")
    assert verdict == "error"
    assert "network error" in msg.lower()
