#!/usr/bin/env bash
# One-time setup: format + mount the Hetzner persistent Volume for Postgres data.
#
# Run this ONCE on a fresh box, BEFORE the first deploy.sh.
# It is safe to re-run: all steps are idempotent.
#
# Prerequisites:
#   1. A Hetzner Volume has been created (e.g. "indigo-iota-db", 20 GB SSD).
#   2. The Volume has been ATTACHED to this server in the Hetzner console.
#
# What it does:
#   - Detects the attached Volume device by its Hetzner SCSI id.
#   - Formats it as ext4 if not already formatted.
#   - Creates /mnt/pgdata and mounts the Volume there.
#   - Adds the mount to /etc/fstab so it survives reboots.
#   - Sets ownership so the Postgres container (uid 999) can write to it.
#
# After this script succeeds, run deploy.sh to start the stack.
set -euo pipefail

MOUNT_POINT=/mnt/pgdata
# Hetzner exposes attached Volumes as a stable symlink under /dev/disk/by-id/
# with a name starting "scsi-0HC_Volume_". Find it automatically.
DEVICE=$(ls /dev/disk/by-id/scsi-0HC_Volume_* 2>/dev/null | head -1)

if [ -z "$DEVICE" ]; then
    echo "ERROR: No Hetzner Volume found under /dev/disk/by-id/scsi-0HC_Volume_*" >&2
    echo "       Make sure you have ATTACHED the Volume to this server in the Hetzner console." >&2
    exit 1
fi

echo "[setup-volume] found device: $DEVICE"
REAL_DEVICE=$(realpath "$DEVICE")
echo "[setup-volume] resolves to:  $REAL_DEVICE"

# --- Format (only if the device has no filesystem yet) ---
EXISTING_FS=$(blkid -o value -s TYPE "$REAL_DEVICE" 2>/dev/null || true)
if [ -z "$EXISTING_FS" ]; then
    echo "[setup-volume] no filesystem detected — formatting as ext4..."
    mkfs.ext4 -L pgdata "$REAL_DEVICE"
    echo "[setup-volume] formatted."
else
    echo "[setup-volume] filesystem already present: $EXISTING_FS — skipping format."
fi

# --- Mount point ---
mkdir -p "$MOUNT_POINT"

# --- /etc/fstab (idempotent: add only if the mount point isn't already there) ---
if ! grep -q "$MOUNT_POINT" /etc/fstab; then
    echo "[setup-volume] adding $MOUNT_POINT to /etc/fstab..."
    echo "$DEVICE  $MOUNT_POINT  ext4  defaults,nofail  0  2" >> /etc/fstab
    echo "[setup-volume] added."
else
    echo "[setup-volume] $MOUNT_POINT already in /etc/fstab — skipping."
fi

# --- Mount ---
if mountpoint -q "$MOUNT_POINT"; then
    echo "[setup-volume] $MOUNT_POINT already mounted — skipping."
else
    echo "[setup-volume] mounting..."
    mount -a
    echo "[setup-volume] mounted."
fi

# --- Postgres data subdirectory ---
# Postgres refuses to initialise in the Volume root because ext4 creates a
# lost+found directory there. Use a clean subdirectory instead.
PGDATA_DIR="$MOUNT_POINT/pgdata"
mkdir -p "$PGDATA_DIR"
chown -R 999:999 "$PGDATA_DIR"
echo "[setup-volume] Postgres data directory: $PGDATA_DIR"

echo ""
echo "[setup-volume] done. $MOUNT_POINT is ready."
echo "               $(df -h "$MOUNT_POINT" | tail -1)"
echo ""
echo "Next step: ./infra/prod/deploy.sh"
