#!/usr/bin/env sh
# API container entrypoint. Idempotent and safe to run on every boot:
#
#   1. wait for Postgres to accept connections,
#   2. ensure the control-plane DB exists and is migrated (init-control),
#   3. bring the default brain DB (DATABASE_URL) up to schema head,
#   4. exec uvicorn.
#
# Per-customer tenant brain DBs are provisioned separately (Phase 1), once:
#   docker compose -f infra/prod/docker-compose.prod.yml exec api \
#       python -m src.tenancy.provision create-org \
#       --name "Customer GmbH" --slug customer --admin-email admin@customer.de
set -eu

echo "[entrypoint] waiting for Postgres..."
python - <<'PY'
import os, sys, time
import psycopg
url = os.environ["DATABASE_URL"]
for _ in range(60):
    try:
        psycopg.connect(url).close()
        print("[entrypoint] Postgres is up.")
        sys.exit(0)
    except Exception:
        time.sleep(2)
print("[entrypoint] ERROR: Postgres did not become ready in time", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] ensuring control-plane DB is provisioned + migrated..."
python -m src.tenancy.provision init-control

echo "[entrypoint] bringing default brain DB (DATABASE_URL) to schema head..."
python -m src.db.init_db

# Bring every already-provisioned tenant brain DB up to head too. Without this,
# a newly added tenant migration only lands on freshly-provisioned customers,
# leaving existing ones on the old schema (e.g. the API 500s when querying a
# column the migration adds). A broken single tenant is logged but must not
# block boot, so we don't let its non-zero exit abort the entrypoint.
echo "[entrypoint] bringing existing tenant brain DBs to schema head..."
python -m src.tenancy.provision migrate-tenants || \
    echo "[entrypoint] WARNING: one or more tenants failed to migrate (see log above)."

echo "[entrypoint] starting API on :8000"
# --proxy-headers + forwarded-allow-ips: we sit behind Caddy, so trust the
# X-Forwarded-* headers it sets (correct scheme/host for redirects + Secure cookies).
exec uvicorn src.api.app:app \
    --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips='*'
