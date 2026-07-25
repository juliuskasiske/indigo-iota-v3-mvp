"""Microsoft Graph mail client — app-only (application permissions).

This is the ONLY part of the connector that talks to Microsoft, so it's the only
part that needs live credentials. It also normalizes each raw Graph message into
a ``NormalizedCapturedEvent`` before returning, so everything downstream (scope
gate → captured_events → audit) is provider-agnostic and fully testable offline
by injecting a fake fetcher with the same ``fetch()`` shape.

Auth: OAuth2 client-credentials against the customer's tenant. Two modes:
  * certificate (recommended): a signed client-assertion JWT (RS256, x5t header)
  * client secret (simpler; fine for early testing)
Configured via env (GraphConfig.from_env). Mail.Read is an *application*
permission, so it must be constrained to the in-scope mailboxes with an
Application Access Policy on the customer side — see the onboarding runbook.

Scope read: GET /users/{mailbox}/mailFolders/{folder}/messages/delta, following
@odata.nextLink pages and returning the final @odata.deltaLink as the cursor for
the next incremental sync.
"""
from __future__ import annotations

import base64
import hashlib
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Tuple
from urllib.parse import quote

import httpx
import jwt

from src.ingestion.capture import normalize

_AUTHORITY = "https://login.microsoftonline.com"
_GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPE = "https://graph.microsoft.com/.default"
_HTTP_TIMEOUT = 30.0

# Folders we never pull: spam, trash, and unsent drafts are noise, not signal,
# so they must not feed the brain. Matched on Graph's wellKnownFolderName (a stable,
# locale-independent id for built-in folders), so a German "Gelöschte Elemente"
# is still recognised as deleteditems. Custom folders have no wellKnownFolderName and
# are therefore always pulled.
_EXCLUDED_WELL_KNOWN = frozenset({"junkemail", "deleteditems", "drafts"})

# What we read off each mailFolders entry (id is the opaque, mailbox-specific
# folder id we sync against; wellKnownFolderName is only present for built-in folders).
_FOLDER_SELECT = "id,displayName,wellKnownFolderName,childFolderCount"


def select_sync_folders(folders: List[dict]) -> List[dict]:
    """Filter a raw Graph mailFolders list down to the folders we sync.

    Drops the noise folders (junk/deleted/drafts) by wellKnownFolderName and returns a
    tidy ``{"id", "name", "well_known"}`` per remaining folder. Pure (no I/O) so
    the exclusion policy is unit-testable without touching Microsoft.
    """
    kept: List[dict] = []
    for f in folders:
        well_known = (f.get("wellKnownFolderName") or "").lower() or None
        if well_known in _EXCLUDED_WELL_KNOWN:
            continue
        fid = f.get("id")
        if not fid:
            continue
        kept.append(
            {
                "id": fid,
                "name": f.get("displayName") or well_known or fid,
                "well_known": well_known,
            }
        )
    return kept

# Fields we ask Graph for. Keep it tight — less data over the wire, and we only
# persist raw payloads for INCLUDED mail anyway.
_SELECT = (
    "id,conversationId,receivedDateTime,sentDateTime,subject,from,"
    "toRecipients,ccRecipients,bodyPreview,body,hasAttachments,internetMessageId"
)


@dataclass
class GraphConfig:
    tenant_id: str
    client_id: str
    client_secret: str | None = None
    cert_path: str | None = None
    cert_key_path: str | None = None

    @classmethod
    def from_env(cls) -> "GraphConfig":
        cfg = cls(
            tenant_id=os.environ.get("GRAPH_TENANT_ID", ""),
            client_id=os.environ.get("GRAPH_CLIENT_ID", ""),
            client_secret=os.environ.get("GRAPH_CLIENT_SECRET") or None,
            cert_path=os.environ.get("GRAPH_CLIENT_CERT_PATH") or None,
            cert_key_path=os.environ.get("GRAPH_CLIENT_KEY_PATH") or None,
        )
        missing = [k for k in ("tenant_id", "client_id") if not getattr(cfg, k)]
        if missing:
            raise RuntimeError(
                "Missing Graph config: "
                + ", ".join("GRAPH_" + m.upper() for m in missing)
                + ". Set the connector credentials in the environment."
            )
        if not cfg.client_secret and not (cfg.cert_path and cfg.cert_key_path):
            raise RuntimeError(
                "Graph needs either GRAPH_CLIENT_SECRET or "
                "GRAPH_CLIENT_CERT_PATH + GRAPH_CLIENT_KEY_PATH."
            )
        return cfg


def _client_assertion(cfg: GraphConfig, token_endpoint: str) -> str:
    """Build a signed client-assertion JWT from the certificate (RS256, x5t)."""
    cert_der = _load_cert_der(cfg.cert_path)
    thumbprint = hashlib.sha1(cert_der).digest()
    x5t = base64.urlsafe_b64encode(thumbprint).decode().rstrip("=")
    private_key = open(cfg.cert_key_path, "rb").read()
    now = int(time.time())
    claims = {
        "aud": token_endpoint,
        "iss": cfg.client_id,
        "sub": cfg.client_id,
        "jti": str(uuid.uuid4()),
        "nbf": now,
        "iat": now,
        "exp": now + 600,
    }
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"x5t": x5t})


def _load_cert_der(cert_path: str | None) -> bytes:
    """Load a PEM cert and return its DER bytes (for the x5t thumbprint)."""
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import Encoding

    with open(cert_path, "rb") as fh:
        cert = x509.load_pem_x509_certificate(fh.read())
    return cert.public_bytes(Encoding.DER)


class GraphMailClient:
    """Fetches mail via Graph delta queries. Implements the ``fetch`` boundary."""

    def __init__(self, cfg: GraphConfig | None = None, folder: str = "inbox"):
        self.cfg = cfg or GraphConfig.from_env()
        self.folder = folder
        self._token: str | None = None
        self._token_exp: float = 0.0

    def _token_endpoint(self) -> str:
        return f"{_AUTHORITY}/{self.cfg.tenant_id}/oauth2/v2.0/token"

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        endpoint = self._token_endpoint()
        data = {
            "client_id": self.cfg.client_id,
            "scope": _SCOPE,
            "grant_type": "client_credentials",
        }
        if self.cfg.client_secret:
            data["client_secret"] = self.cfg.client_secret
        else:
            data["client_assertion_type"] = (
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
            )
            data["client_assertion"] = _client_assertion(self.cfg, endpoint)
        resp = httpx.post(endpoint, data=data, timeout=_HTTP_TIMEOUT)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Microsoft token endpoint returned {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ) from exc
        tok = resp.json()
        self._token = tok["access_token"]
        self._token_exp = time.time() + int(tok.get("expires_in", 3600))
        return self._token

    def _get(self, url: str) -> dict:
        resp = httpx.get(
            url,
            headers={"Authorization": f"Bearer {self._access_token()}"},
            timeout=_HTTP_TIMEOUT,
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Graph API returned {exc.response.status_code} "
                f"for {exc.request.url}: {exc.response.text[:300]}"
            ) from exc
        return resp.json()

    def fetch(
        self, mailbox: str, delta_link: str | None = None
    ) -> Tuple[List[normalize.NormalizedCapturedEvent], str | None]:
        """Pull a mailbox via delta. Returns (normalized events, delta_link).

        With no ``delta_link`` this is the initial full backfill of the folder;
        with one, only what changed since. Follows nextLink pagination and
        returns the new deltaLink to persist for the next run. Each raw Graph
        message (and delta tombstone) is normalized here so the caller never
        sees Graph's wire shape.
        """
        if delta_link:
            url = delta_link
        else:
            url = (
                f"{_GRAPH}/users/{mailbox}/mailFolders/{self.folder}"
                f"/messages/delta?$select={_SELECT}"
            )
        events: List[normalize.NormalizedCapturedEvent] = []
        new_delta: str | None = None
        while url:
            page = self._get(url)
            events.extend(normalize.normalize_message(m) for m in page.get("value", []))
            if "@odata.nextLink" in page:
                url = page["@odata.nextLink"]
            else:
                new_delta = page.get("@odata.deltaLink")
                url = ""
        return events, new_delta

    def fetch_window(
        self,
        mailbox: str,
        since: datetime,
        max_count: int,
        folder: str | None = None,
    ) -> List[normalize.NormalizedCapturedEvent]:
        """Pull up to ``max_count`` messages received on/after ``since``.

        For a bounded historical backfill — distinct from ``fetch`` in two ways:
        it filters by ``receivedDateTime`` (the delta endpoint can't), and it
        returns NO delta cursor, so the caller must not persist one (a backfill
        is a one-off catch-up, not the incremental baseline). Newest first, so a
        small ``max_count`` returns the most recent window. Returns normalized
        events, same as ``fetch``.
        """
        folder = (folder or self.folder).strip() or "inbox"
        if max_count <= 0:
            return []
        # Graph wants UTC; emit a Z-suffixed instant for the OData filter.
        since_utc = since.astimezone(timezone.utc) if since.tzinfo else since.replace(
            tzinfo=timezone.utc
        )
        since_str = since_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        filter_q = quote(f"receivedDateTime ge {since_str}", safe="")
        page_size = min(max_count, 1000)  # Graph caps $top at 1000
        url = (
            f"{_GRAPH}/users/{mailbox}/mailFolders/{folder}/messages"
            f"?$select={_SELECT}&$filter={filter_q}"
            f"&$orderby=receivedDateTime%20desc&$top={page_size}"
        )
        events: List[normalize.NormalizedCapturedEvent] = []
        while url and len(events) < max_count:
            page = self._get(url)
            events.extend(normalize.normalize_message(m) for m in page.get("value", []))
            url = page.get("@odata.nextLink", "")
        return events[:max_count]

    def probe_mailbox(self, mailbox: str) -> Tuple[str, str]:
        """Live check: can the connector actually read this mailbox right now?

        Makes one tiny mail call (one folder). Because it hits the same Mail.Read
        surface the sync uses, the verdict is the live truth about the customer's
        Exchange access policy — the same thing Test-ApplicationAccessPolicy tells
        you, but from our side:
          * "readable"  — Microsoft returned mail (the mailbox IS in the policy)
          * "blocked"   — 403: the mailbox is NOT in the access policy
          * "not_found" — 404: no such mailbox in the connected tenant
          * "error"     — anything else (returned verbatim for debugging)

        Never raises on an access verdict; only a missing-credentials RuntimeError
        propagates (that's a platform misconfig, not a per-mailbox answer).
        """
        url = f"{_GRAPH}/users/{mailbox}/mailFolders?$top=1&$select=id"
        try:
            resp = httpx.get(
                url,
                headers={"Authorization": f"Bearer {self._access_token()}"},
                timeout=_HTTP_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            return "error", f"network error: {exc}"
        if resp.status_code == 200:
            return "readable", "ok"
        if resp.status_code == 403:
            return (
                "blocked",
                "Microsoft denied access — this mailbox is not in the access policy.",
            )
        if resp.status_code == 404:
            return "not_found", "No such mailbox in the connected tenant."
        return "error", f"HTTP {resp.status_code}: {resp.text[:200]}"

    def list_sync_folders(self, mailbox: str) -> List[dict]:
        """Every folder of ``mailbox`` we should sync, re-discovered live.

        Walks the whole folder tree (top level + nested subfolders, e.g. a
        project folder filed under another) and drops the noise folders. The
        caller runs this on every sync, so folders the user adds or removes are
        always picked up. Each entry is ``{"id", "name", "well_known"}``; sync
        the ``id`` (it works in the message path for built-in and custom alike).
        """
        return select_sync_folders(self._list_all_folders(mailbox))

    def _list_all_folders(self, mailbox: str) -> List[dict]:
        """Raw Graph mailFolders for a mailbox, recursing into child folders."""
        collected: List[dict] = []

        def walk(url: str) -> None:
            while url:
                page = self._get(url)
                for folder in page.get("value", []):
                    collected.append(folder)
                    if folder.get("childFolderCount", 0) > 0:
                        walk(
                            f"{_GRAPH}/users/{mailbox}/mailFolders/{folder['id']}"
                            f"/childFolders?$top=100&$select={_FOLDER_SELECT}"
                        )
                url = page.get("@odata.nextLink", "")

        walk(f"{_GRAPH}/users/{mailbox}/mailFolders?$top=100&$select={_FOLDER_SELECT}")
        return collected
