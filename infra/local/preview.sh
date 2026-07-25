#!/usr/bin/env bash
# Bring up the local preview of the production stack on http://localhost:8080.
# Same images + migrations + same-origin routing as the Hetzner box, over HTTP.
#
#   ./infra/local/preview.sh           # build + start, then prints the URL
#   ./infra/local/preview.sh seed      # create the 'acme' demo tenant + credits
#   ./infra/local/preview.sh down      # stop and remove the local stack
#   ./infra/local/preview.sh logs      # follow API logs
set -euo pipefail

# Demo tenant the `seed` command provisions (dev-login uses this slug + email).
SEED_NAME="Acme GmbH"
SEED_SLUG="acme"
SEED_ADMIN_EMAIL="admin@acme-demo.de"
SEED_GRANT="200"   # raw credits granted; the Admin Center shows the x10 figure.
                   # Spend is capped at exactly what's granted — no separate limit.

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/.env.local"
COMPOSE="docker compose --env-file $ENV_FILE -f $HERE/docker-compose.local.yml"

if [ ! -f "$ENV_FILE" ]; then
    echo "[preview] creating $ENV_FILE from the example (edit it if you like)"
    cp "$HERE/.env.local.example" "$ENV_FILE"
fi

# The api container layers backend/.env (LLM key + SESSION_SECRET) under
# .env.local, so backend/.env must exist or compose rejects the env_file.
BACKEND_ENV="$REPO_ROOT/backend/.env"
if [ ! -f "$BACKEND_ENV" ]; then
    echo "[preview] creating backend/.env from the example — set LLM_BASE_API_KEY there for live extraction"
    cp "$REPO_ROOT/backend/.env.example" "$BACKEND_ENV"
fi

cd "$REPO_ROOT"

case "${1:-up}" in
    down) $COMPOSE down ;;
    logs) $COMPOSE logs -f api ;;
    seed)
        # Provision a demo tenant inside the running api container so you can
        # actually sign in to the Admin Center. Re-runnable: each step tolerates
        # "already exists". The control DB + tenant migrations were applied by
        # the api entrypoint on `up`.
        echo "[seed] creating org '$SEED_SLUG' (admin: $SEED_ADMIN_EMAIL)..."
        $COMPOSE exec -T api python -m src.tenancy.provision create-org \
            --name "$SEED_NAME" --slug "$SEED_SLUG" --admin-email "$SEED_ADMIN_EMAIL" \
            || echo "[seed]   (org likely already exists — continuing)"
        echo "[seed] granting $SEED_GRANT credits..."
        $COMPOSE exec -T api python -m src.billing grant \
            --slug "$SEED_SLUG" --amount "$SEED_GRANT" --note "local pilot setup" \
            || echo "[seed]   (grant failed — continuing)"
        echo
        echo "[seed] done. Test the Admin Center:"
        echo "[seed]   1. Open    http://localhost:8080/admin/"
        echo "[seed]   2. Click   'Dev login (local preview)'"
        echo "[seed]   3. Slug    $SEED_SLUG"
        echo "[seed]      Email   $SEED_ADMIN_EMAIL"
        echo "[seed]   You'll see remaining credits (x10 of the raw grant), the spend chart, and the scope editor."
        ;;
    up)
        echo "[preview] building + starting (db -> api -> web)..."
        $COMPOSE up -d --build
        echo
        echo "[preview] up. Open:        http://localhost:8080"
        echo "[preview]   Admin Center:   http://localhost:8080/admin/"
        echo "[preview]   health:         http://localhost:8080/healthz"
        echo "[preview]   API (JSON):     http://localhost:8080/api/admin/ping"
        echo "[preview]   Postgres:       psql postgresql://iota:iota@localhost:5434/iota_brain"
        echo "[preview]   dev login:      POST http://localhost:8080/auth/dev-login (IOTA_DEV_LOGIN=1)"
        echo "[preview]   logs:           ./infra/local/preview.sh logs"
        echo "[preview]   stop:           ./infra/local/preview.sh down"
        echo
        echo "[preview] NEXT: seed a demo tenant so you can sign in:"
        echo "[preview]   ./infra/local/preview.sh seed"
        ;;
    *) echo "usage: $0 [up|seed|down|logs]" >&2; exit 2 ;;
esac
