#!/usr/bin/env bash
# Restore ALL databases from a pg_dumpall backup produced by backup.sh.
#
# DESTRUCTIVE: pg_dumpall restores include DROP/CREATE for every database and
# role. Run only on a fresh box or when you intend to overwrite current state.
#
#   ./restore.sh /opt/indigo-iota/backups/iota_all_20260601T033000Z.sql.gz
#   ./restore.sh /path/to/iota_all_....sql.gz.gpg   # decrypts with BACKUP_PASSPHRASE
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/.env.prod"
COMPOSE="docker compose --env-file $ENV_FILE -f $HERE/docker-compose.prod.yml"

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
    echo "usage: $0 <dump-file (.sql.gz or .sql.gz.gpg)>" >&2
    exit 2
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

printf '!! This OVERWRITES all databases on this box from %s\n   Type "yes" to continue: ' "$DUMP"
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "aborted."; exit 1; }

decrypt_and_gunzip() {
    case "$DUMP" in
        *.gpg) gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" -d "$DUMP" | gunzip -c ;;
        *.gz)  gunzip -c "$DUMP" ;;
        *)     cat "$DUMP" ;;
    esac
}

echo "[restore] streaming dump into Postgres (as superuser ${POSTGRES_USER})..."
decrypt_and_gunzip | $COMPOSE exec -T db psql -U "$POSTGRES_USER" -d postgres

echo "[restore] done. Restart the API so it reconnects:"
echo "    $COMPOSE restart api"
