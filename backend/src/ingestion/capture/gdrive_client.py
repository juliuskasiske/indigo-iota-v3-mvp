"""Minimal Google Drive access check for the v0 "Connect a folder" flow.

This is deliberately TINY: it does NOT fetch or ingest files. Its only jobs are
(1) pull a folder id out of a pasted Drive URL and (2) verify, via our shared
service account, that we can actually read that folder — so the Admin Center can
give the same "test connection" verdict the IMAP source does. Listing/reading the
folder's files (the real connector) is a later phase.

Access model: ONE service account (key in GDRIVE_SERVICE_ACCOUNT_JSON, email in
GDRIVE_SERVICE_ACCOUNT_EMAIL — see src/config.py) serves every customer. The
customer shares their Drive folder with that email inside Google Drive; we then
read it with the service account's own credentials. No per-user OAuth, no
domain-wide delegation, no per-source secret.
"""
from __future__ import annotations

import json
import re
from typing import Tuple

from src import config

# Read-only Drive scope — we never write to the customer's Drive.
_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Folder ids appear as …/drive/folders/<ID>, …/drive/u/0/folders/<ID>,
# …/folders/<ID>?usp=sharing, or the bare id. Drive ids are URL-safe tokens.
_FOLDER_URL_RE = re.compile(r"/folders/([A-Za-z0-9_-]+)")
_BARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")


def parse_folder_id(url_or_id: str) -> str | None:
    """Extract a Drive folder id from a pasted link (or accept a bare id).

    Returns None if nothing that looks like a folder id is present, so callers can
    reject the input with a clear message instead of probing garbage.
    """
    s = (url_or_id or "").strip()
    if not s:
        return None
    m = _FOLDER_URL_RE.search(s)
    if m:
        return m.group(1)
    # Some share links use ?id=<ID> (older Drive UI / open?id= form).
    m = re.search(r"[?&]id=([A-Za-z0-9_-]+)", s)
    if m:
        return m.group(1)
    if _BARE_ID_RE.match(s):
        return s
    return None


def is_configured() -> bool:
    """Whether the shared service account is wired up on this server."""
    return bool(config.GDRIVE_SERVICE_ACCOUNT_JSON)


def share_target() -> str:
    """The service-account email customers share their folders with (may be '')."""
    return config.GDRIVE_SERVICE_ACCOUNT_EMAIL


def _load_credentials():
    """Build read-only Drive credentials from the shared service-account key.

    GDRIVE_SERVICE_ACCOUNT_JSON is either the raw JSON or a path to the key file.
    """
    from google.oauth2 import service_account

    raw = config.GDRIVE_SERVICE_ACCOUNT_JSON.strip()
    if raw.startswith("{"):
        info = json.loads(raw)
        return service_account.Credentials.from_service_account_info(info, scopes=_SCOPES)
    # Otherwise treat it as a path to the JSON key file.
    return service_account.Credentials.from_service_account_file(raw, scopes=_SCOPES)


def probe(folder_id: str) -> Tuple[str, str]:
    """Live check: can our service account read this Drive folder?

    Mirrors imap_client.probe / graph_client.probe_mailbox so the admin "test
    connection" button gets a uniform verdict:
      * "readable"       — the service account can see the folder
      * "auth_failed"    — Drive refused access (folder not shared with us, or no
                           such folder we can see) → admin needs to share it
      * "not_configured" — the server has no service-account key set
      * "error"          — anything else (network, bad key, API disabled)
    Never raises; returns the verdict so the API can surface it.
    """
    if not is_configured():
        return "not_configured", "No Google Drive service account is configured on the server."
    if not folder_id:
        return "error", "No folder id."

    try:
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except Exception as exc:  # pragma: no cover - import/runtime guard
        return "error", f"Google API client unavailable: {exc}"

    try:
        creds = _load_credentials()
    except Exception as exc:
        return "error", f"Bad service-account key: {exc}"

    try:
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        # supportsAllDrives=True so this also covers Shared Drives, not just My Drive.
        meta = (
            service.files()
            .get(fileId=folder_id, fields="id, name, mimeType", supportsAllDrives=True)
            .execute()
        )
    except HttpError as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        if status in (403, 404):
            return (
                "auth_failed",
                "We can't see that folder yet — share it with our service account "
                f"({share_target() or 'our service-account email'}) and try again.",
            )
        return "error", f"Drive API error: {exc}"
    except Exception as exc:
        return "error", f"Could not reach Google Drive: {exc}"

    if meta.get("mimeType") != "application/vnd.google-apps.folder":
        return (
            "error",
            "That link points to a file, not a folder. Paste a Drive folder (or "
            "Shared Drive) link.",
        )
    return "readable", meta.get("name") or "ok"


# --- Phase 2: read the folder's files -------------------------------------------

_FOLDER_MIME = "application/vnd.google-apps.folder"
# Skip files bigger than this (avoid huge downloads / slow MarkItDown).
_MAX_BYTES = 25 * 1024 * 1024

# Google-native docs can't be downloaded as-is — export them to a binary format
# MarkItDown understands. (mimeType -> (export_mime, extension))
_GOOGLE_EXPORT = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
}
# Uploaded/binary types we download directly (mimeType -> extension hint).
_DOWNLOAD_EXT = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.ms-powerpoint": ".ppt",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "text/html": ".html",
    "application/rtf": ".rtf",
    "application/json": ".json",
}


def is_supported(mime: str) -> bool:
    """Whether we can turn this Drive mimeType into Markdown (v1 format set)."""
    return mime in _GOOGLE_EXPORT or mime in _DOWNLOAD_EXT


def _service():
    """Build the Drive v3 client from the shared service-account credentials."""
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=_load_credentials(), cache_discovery=False)


def list_tree(folder_id: str, *, max_files: int = 5000) -> list[dict]:
    """Recursively list the SUPPORTED files under ``folder_id`` (metadata only).

    Walks folders → subfolders → leaf files via ``files.list``. Cheap (no content
    download). Returns ``[{id, name, mimeType, modifiedTime, size, web_view_link,
    path}]`` for files whose type we can convert; folders and unsupported types are
    skipped. ``path`` is the slash-joined folder path for display/debugging.
    """
    svc = _service()
    out: list[dict] = []
    stack: list[tuple[str, str]] = [(folder_id, "")]
    seen: set[str] = set()
    while stack and len(out) < max_files:
        fid, prefix = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        page_token: str | None = None
        while True:
            resp = (
                svc.files()
                .list(
                    q=f"'{fid}' in parents and trashed = false",
                    fields=(
                        "nextPageToken, files(id, name, mimeType, modifiedTime, "
                        "size, webViewLink)"
                    ),
                    pageSize=200,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageToken=page_token,
                )
                .execute()
            )
            for f in resp.get("files", []):
                if f.get("mimeType") == _FOLDER_MIME:
                    stack.append((f["id"], f"{prefix}/{f['name']}"))
                elif is_supported(f.get("mimeType", "")):
                    out.append(
                        {
                            "id": f["id"],
                            "name": f.get("name") or f["id"],
                            "mimeType": f["mimeType"],
                            "modifiedTime": f.get("modifiedTime"),
                            "size": int(f["size"]) if f.get("size") else None,
                            "web_view_link": f.get("webViewLink"),
                            "path": f"{prefix}/{f.get('name', '')}".lstrip("/"),
                        }
                    )
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    return out


def fetch_markdown(file_meta: dict) -> str:
    """Download (or export) one file and convert it to Markdown via MarkItDown.

    Returns "" for files we should skip (over the size cap, unsupported, empty, or
    a conversion error) — the caller treats "" as "nothing to ingest". Plain text
    / markdown are decoded directly; everything else goes through MarkItDown, which
    strips the structural/XML noise that would otherwise burn tokens downstream.
    """
    import io

    mime = file_meta.get("mimeType", "")
    size = file_meta.get("size")
    if size and size > _MAX_BYTES:
        return ""

    if mime in _GOOGLE_EXPORT:
        export_mime, ext = _GOOGLE_EXPORT[mime]
        request_factory = lambda svc: svc.files().export_media(  # noqa: E731
            fileId=file_meta["id"], mimeType=export_mime
        )
    elif mime in _DOWNLOAD_EXT:
        ext = _DOWNLOAD_EXT[mime]
        request_factory = lambda svc: svc.files().get_media(  # noqa: E731
            fileId=file_meta["id"], supportsAllDrives=True
        )
    else:
        return ""

    try:
        from googleapiclient.http import MediaIoBaseDownload

        svc = _service()
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request_factory(svc))
        done = False
        while not done:
            _status, done = downloader.next_chunk()
        data = buf.getvalue()
    except Exception:
        return ""

    if not data:
        return ""
    return _to_markdown(data, ext)


def _to_markdown(data: bytes, ext: str) -> str:
    """Convert downloaded bytes to Markdown. Text formats are decoded directly;
    binaries/office/pdf go through MarkItDown. Never raises — returns "" on error."""
    if ext in (".txt", ".md"):
        return data.decode("utf-8", errors="replace").strip()
    import os
    import tempfile

    path = ""
    try:
        from markitdown import MarkItDown

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            path = tmp.name
        result = MarkItDown().convert(path)
        return (getattr(result, "text_content", "") or "").strip()
    except Exception:
        return ""
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
