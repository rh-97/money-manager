#!/bin/sh
# Nightly backup (systemd timer money-manager-backup.timer).
# Writes a consistent copy of the database and keeps 30 days.
# Google Drive upload (rclone crypt) is added once Drive is connected.
set -eu
DIR=/opt/money-manager/data/backups
mkdir -p "$DIR"
chown 1000:1000 "$DIR"
STAMP=$(date +%Y-%m-%d_%H%M)
docker compose -f /opt/money-manager/compose.yml exec -T backend node --no-warnings /app/admin/cli.mjs backup "/data/backups/money-manager-$STAMP.db"
gzip -f "$DIR/money-manager-$STAMP.db"
find "$DIR" -name 'money-manager-*.db.gz' -mtime +30 -delete
echo "Backup done: $DIR/money-manager-$STAMP.db.gz"
