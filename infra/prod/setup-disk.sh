#!/usr/bin/env bash
# Generic Postgres data-disk setup for a non-Hetzner box (an AWS EBS volume, or
# any second block device). The Hetzner-specific setup-volume.sh detects the
# volume by its Hetzner SCSI id; this one takes the device explicitly, so it
# works on EC2 (/dev/nvme1n1), DigitalOcean, Netcup, etc.
#
# It formats the disk ext4 (only if empty), mounts it at /mnt/pgdata, persists
# the mount via fstab BY UUID (device names like /dev/nvme1n1 can shift across
# reboots on Nitro), and prepares the pgdata subdir for the Postgres container
# (uid 999). The prod compose bind-mounts /mnt/pgdata/pgdata, unchanged.
#
# Usage:  sudo ./infra/prod/setup-disk.sh /dev/nvme1n1
#   Find the device first with:  lsblk
# Safe to re-run: every step is idempotent, and it refuses to touch a disk that
# is already mounted (so it can never reformat the root volume).
set -euo pipefail

MOUNT_POINT=/mnt/pgdata
DEVICE="${1:-}"

if [ -z "$DEVICE" ]; then
    echo "Usage: $0 <device>   (e.g. /dev/nvme1n1)" >&2
    echo "" >&2
    echo "Block devices on this box:" >&2
    lsblk -dpno NAME,SIZE,TYPE,MOUNTPOINT >&2
    exit 1
fi

[ -b "$DEVICE" ] || { echo "ERROR: $DEVICE is not a block device." >&2; exit 1; }

# Safety: never touch a disk (or its partitions) that is already mounted.
if lsblk -no MOUNTPOINT "$DEVICE" 2>/dev/null | grep -q '[^[:space:]]'; then
    echo "ERROR: $DEVICE or a partition of it is already mounted. Refusing." >&2
    exit 1
fi

EXISTING_FS=$(blkid -o value -s TYPE "$DEVICE" 2>/dev/null || true)
if [ -z "$EXISTING_FS" ]; then
    echo "[setup-disk] no filesystem on $DEVICE — formatting ext4..."
    mkfs.ext4 -L pgdata "$DEVICE"
else
    echo "[setup-disk] filesystem already present ($EXISTING_FS) — skipping format."
fi

mkdir -p "$MOUNT_POINT"

UUID=$(blkid -o value -s UUID "$DEVICE")
if ! grep -q "$UUID" /etc/fstab; then
    echo "UUID=$UUID  $MOUNT_POINT  ext4  defaults,nofail  0  2" >> /etc/fstab
    echo "[setup-disk] added UUID=$UUID -> $MOUNT_POINT to /etc/fstab"
else
    echo "[setup-disk] fstab entry already present — skipping."
fi

if mountpoint -q "$MOUNT_POINT"; then
    echo "[setup-disk] $MOUNT_POINT already mounted."
else
    mount -a
    echo "[setup-disk] mounted $MOUNT_POINT."
fi

# Postgres refuses to init in the mount root (ext4 lost+found); use a subdir.
PGDATA_DIR="$MOUNT_POINT/pgdata"
mkdir -p "$PGDATA_DIR"
chown -R 999:999 "$PGDATA_DIR"

echo "[setup-disk] ready: $(df -h "$MOUNT_POINT" | tail -1)"
echo "Next: fill infra/prod/.env.prod, then ./infra/prod/deploy.sh"
