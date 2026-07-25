#!/usr/bin/env bash
# Reset the demo back to the empty-state form AND start the dashboard.
#
# What this does:
#   1. Stops any uvicorn already on port 8000
#   2. Deletes every brain page JSON under brain_pages/
#   3. Removes the persisted CI (data/ci.json)
#   4. Truncates the nodes and edges tables in Postgres
#   5. Starts the dashboard (foreground; Ctrl-C to stop)
#
# Token counter resets implicitly because we're starting a fresh server.
#
# After this runs, hard-refresh the browser (Cmd-Shift-R) — you'll be
# back on the "Initialize a new Brain" card. Type the company name and
# URL there.
#
# Usage:  ./scripts/reinitialize.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- 1. stop any running uvicorn on :8000 -----------------------------------
PIDS="$(lsof -ti:8000 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "stopping existing server on :8000 (pids: $PIDS)"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  # Give the OS a moment to release the port.
  for _ in 1 2 3 4 5; do
    sleep 0.2
    lsof -ti:8000 >/dev/null 2>&1 || break
  done
fi

# --- 2-4. wipe brain pages + ci.json + Postgres -----------------------------
find brain_pages -name "*.json" -type f -delete 2>/dev/null || true
rm -f data/ci.json

.venv/bin/python <<'PY'
from src.db.init_db import main as init_schema
from src.db.connection import get_connection

# Ensure every table exists (chats was added after the initial schema;
# this is a no-op on already-applied schemas because everything uses
# CREATE TABLE IF NOT EXISTS).
init_schema()

with get_connection() as conn, conn.cursor() as cur:
    # chunks first because it FKs back to nodes; CASCADE would cover it
    # but explicit ordering keeps the intent obvious.
    cur.execute("TRUNCATE TABLE questions, chunks, edges, nodes RESTART IDENTITY;")
    conn.commit()
PY

echo "state cleared:"
echo "  - brain pages"
echo "  - ci.json"
echo "  - DB nodes/edges/chunks/questions"
echo ""
echo "starting dashboard on http://127.0.0.1:8000  (Ctrl-C to stop)"
echo "hard-refresh the browser (Cmd-Shift-R) for the empty-state form"
echo ""

# --- 5. start the dashboard in the foreground -------------------------------
# `exec` replaces this shell so Ctrl-C goes straight to uvicorn.
exec .venv/bin/python -m src.dashboard
