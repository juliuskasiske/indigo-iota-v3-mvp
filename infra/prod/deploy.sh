#!/usr/bin/env bash
# Build + (re)start the production stack on the box. Idempotent: run it for the
# first deploy and for every update.
#
# First-time provisioning of the box (run once, by hand):
#   1. Hetzner: create a CPX21/CPX31 in Falkenstein or Nuremberg, Ubuntu 24.04.
#   2. Point an A/AAAA record for $APP_DOMAIN at the box's IP.
#   3. ssh in; install Docker:  curl -fsSL https://get.docker.com | sh
#   4. ufw allow 22,80,443/tcp ; ufw enable
#   5. git clone the repo to /opt/indigo-iota
#   6. cp infra/prod/.env.prod.example infra/prod/.env.prod
#      edit it, fill secrets, then: chmod 600 infra/prod/.env.prod
#   7. ./infra/prod/deploy.sh
#   8. Provision the pilot tenant (once):
#        docker compose --env-file infra/prod/.env.prod \
#          -f infra/prod/docker-compose.prod.yml exec api \
#          python -m src.tenancy.provision create-org \
#          --name "Customer GmbH" --slug customer --admin-email admin@customer.de
#   9. Add the daily backup cron (see backup.sh header).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/.env.prod"
COMPOSE_FILE="$HERE/docker-compose.prod.yml"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE missing. Copy .env.prod.example and fill it in." >&2; exit 1; }

# Postgres data lives on a Hetzner persistent Volume mounted at /mnt/pgdata.
# If the mount isn't there, refuse to start — Docker would silently create an
# empty local directory and Postgres would boot with no data instead of failing.
# First-time setup: run ./infra/prod/setup-volume.sh before deploy.sh.
if ! mountpoint -q /mnt/pgdata 2>/dev/null; then
    echo "ERROR: /mnt/pgdata is not a mount point." >&2
    echo "       Create + attach a Hetzner Volume, then run:" >&2
    echo "         ./infra/prod/setup-volume.sh" >&2
    exit 1
fi

cd "$REPO_ROOT"

# Sync to the latest pushed code. We HARD-RESET to origin/main rather than
# `pull --ff-only`: the server holds no hand edits (secrets live in the gitignored
# .env.prod, which reset never touches), and a diverged tree would make --ff-only
# abort the whole deploy, silently leaving prod on old code. Override with
# SKIP_GIT_PULL=1 when deploying a detached copy.
if [ -d .git ] && [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
    BRANCH="${DEPLOY_BRANCH:-main}"
    echo "[deploy] syncing to origin/$BRANCH"
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"
fi
echo "[deploy] building commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

# The web image bakes the Next static export at build time, so a cached build
# layer is the #1 cause of "I deployed but the UI didn't change". Force a clean
# rebuild of web every deploy; api/sync share one image and can use the cache.
echo "[deploy] building web (no cache) + api"
$COMPOSE build --no-cache web
$COMPOSE build api

echo "[deploy] (re)starting stack — force-recreate so new images always take"
$COMPOSE up -d --force-recreate

echo "[deploy] pruning dangling images"
docker image prune -f >/dev/null || true

echo "[deploy] status:"
$COMPOSE ps
echo "[deploy] done. Tail logs with:  $COMPOSE logs -f api"
