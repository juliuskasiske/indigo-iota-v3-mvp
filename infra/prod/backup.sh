#!/usr/bin/env bash
# Daily off-box backup of ALL databases on the box (control plane + every
# tenant brain DB + roles/globals) via pg_dumpall.
#
# Flow: pg_dumpall inside the db container -> gzip -> optional gpg encryption
# -> optional rsync to a remote (e.g. Hetzner Storage Box) -> prune old local
# dumps. Reads infra/prod/.env.prod for credentials + targets.
#
# Wire it to cron on the box (daily 03:30):
#   30 3 * * * /opt/indigo-iota/infra/prod/backup.sh >> /var/log/iota-backup.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/.env.prod"
COMPOSE="docker compose --env-file $ENV_FILE -f $HERE/docker-compose.prod.yml"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/iota_all_${STAMP}.sql.gz"
echo "[backup] dumping all databases -> $OUT"
$COMPOSE exec -T db pg_dumpall -U "$POSTGRES_USER" | gzip -c > "$OUT"

# Encrypt at rest before it leaves the box, if a passphrase is configured.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    echo "[backup] encrypting (gpg, AES256)"
    gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" \
        --symmetric --cipher-algo AES256 -o "${OUT}.gpg" "$OUT"
    rm -f "$OUT"
    OUT="${OUT}.gpg"
fi

# Ship off-box (so a lost server doesn't mean lost data).
if [ -n "${BACKUP_REMOTE:-}" ]; then
    echo "[backup] rsync -> $BACKUP_REMOTE"
    rsync -az --partial "$OUT" "$BACKUP_REMOTE"
fi

echo "[backup] pruning local dumps older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -name 'iota_all_*.sql.gz*' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done: $OUT"
