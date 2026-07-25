"""CLI for the mail connector: capture a mailbox, then optionally comprehend.

    # Live (needs GRAPH_* creds + the customer's admin consent):
    python -m src.ingestion --mailbox user@customer.com
    python -m src.ingestion --mailbox user@customer.com --process

    # Offline dry-run against a captured-messages JSON file (a list of Graph
    # message objects) — validates the gate end-to-end with no credentials:
    python -m src.ingestion --mailbox user@customer.com --from-file sample.json

Ingestion writes to the database named by DATABASE_URL (the dev/single brain
DB). Per-tenant targeting rides on get_tenant_connection once the connector is
wired to the control-plane registry.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Tuple

from src.db.connection import get_connection
from src.ingestion.capture import mail


class _FileFetcher:
    """A fetcher that replays Graph messages from a JSON file (offline)."""

    def __init__(self, path: str):
        self._messages = json.loads(Path(path).read_text(encoding="utf-8"))

    def fetch(self, mailbox: str, delta_link: str | None) -> Tuple[List[dict], str | None]:
        return self._messages, None


def main() -> None:
    p = argparse.ArgumentParser(description="Ingest mail through the scope gate.")
    p.add_argument("--mailbox", required=True, help="Mailbox UPN/address to pull.")
    p.add_argument("--from-file", default=None,
                   help="Offline: replay Graph messages from a JSON file.")
    p.add_argument("--folder", default="inbox", help="Mail folder (live mode).")
    p.add_argument("--process", action="store_true",
                   help="After capture, comprehend unprocessed events into the brain.")
    args = p.parse_args()

    if args.from_file:
        fetcher = _FileFetcher(args.from_file)
    else:
        from src.ingestion.capture.graph_client import GraphMailClient
        fetcher = GraphMailClient(folder=args.folder)

    with get_connection() as conn:
        summary = mail.ingest_mailbox(conn, args.mailbox, fetcher, folder=args.folder)
    print(f"[capture] {summary.as_dict()}")

    if args.process:
        from src import config
        from src.ingestion.comprehend.pipeline import ComprehendPipeline
        from src.ingestion import runner

        config.require_llm_config()
        pipeline = ComprehendPipeline()
        with get_connection() as conn:
            ps = runner.comprehend_pending(conn, pipeline)
        print(f"[comprehend] {ps}")


if __name__ == "__main__":
    sys.exit(main())
