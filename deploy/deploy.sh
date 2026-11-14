#!/usr/bin/env bash
# Builds Money Manager in the Docker dev container and deploys it to the VM.
#
#   ./deploy/deploy.sh            # build, upload, install, restart
#
# Needs: Docker running locally, and SSH access to the VM (see MM_SSH below).
# Safe to run again: data in /opt/money-manager/data is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

MM_SSH_KEY="${MM_SSH_KEY:-$HOME/Documents/Oracle Remote Instance Keys/private_138_2_66_148.key}"
MM_HOST="${MM_HOST:-ubuntu@138.2.66.148}"
SSH=(ssh -o BatchMode=yes -i "$MM_SSH_KEY" "$MM_HOST")

echo "1/4 Building (tests must pass)…"
./scripts/dev.sh sh -c 'npm test >/dev/null && npm run build:prod -w backend >/dev/null && npm run build -w frontend >/dev/null' 2>/dev/null

echo "2/4 Uploading…"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/app/admin" "$STAGE/www"
cp backend/dist-prod/server.mjs "$STAGE/app/"
cp backend/dist-prod/admin/cli.mjs "$STAGE/app/admin/"
cp -R frontend/dist/. "$STAGE/www/"
cp deploy/compose.prod.yml deploy/backup.sh deploy/mm-admin deploy/money-manager-backup.service deploy/money-manager-backup.timer deploy/nginx/money-manager.conf "$STAGE/"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$STAGE" -czf "$STAGE.tgz" .
scp -q -o BatchMode=yes -i "$MM_SSH_KEY" "$STAGE.tgz" "$MM_HOST:/tmp/money-manager-release.tgz"
rm -rf "$STAGE" "$STAGE.tgz"

echo "3/4 Installing on the VM…"
"${SSH[@]}" 'sudo -n bash -s' <<'REMOTE'
set -euo pipefail
R=/tmp/money-manager-release
rm -rf "$R" && mkdir -p "$R" && tar -C "$R" -xzf /tmp/money-manager-release.tgz && rm /tmp/money-manager-release.tgz
install -d -o root -g root /opt/money-manager /opt/money-manager/app /opt/money-manager/app/admin
install -d -o 1000 -g 1000 -m 700 /opt/money-manager/data
install -m 644 "$R/app/server.mjs" /opt/money-manager/app/server.mjs
install -m 644 "$R/app/admin/cli.mjs" /opt/money-manager/app/admin/cli.mjs
install -m 644 "$R/compose.prod.yml" /opt/money-manager/compose.yml
install -m 755 "$R/backup.sh" /opt/money-manager/backup.sh
install -m 755 "$R/mm-admin" /usr/local/bin/mm-admin
install -m 644 "$R/money-manager-backup.service" "$R/money-manager-backup.timer" /etc/systemd/system/
# Frontend: swap in the new files.
install -d /var/www/money-manager
rsync -a --delete "$R/www/" /var/www/money-manager/ 2>/dev/null || { rm -rf /var/www/money-manager/*; cp -R "$R/www/." /var/www/money-manager/; }
# nginx: test before reloading; keep the old config if the new one fails.
cp /etc/nginx/sites-available/money-manager /etc/nginx/sites-available/money-manager.previous 2>/dev/null || true
install -m 644 "$R/money-manager.conf" /etc/nginx/sites-available/money-manager
ln -sf /etc/nginx/sites-available/money-manager /etc/nginx/sites-enabled/money-manager
if nginx -t 2>/dev/null; then systemctl reload nginx; else
  echo "nginx config test failed; restoring the previous config" >&2
  cp /etc/nginx/sites-available/money-manager.previous /etc/nginx/sites-available/money-manager; nginx -t && systemctl reload nginx; exit 1
fi
rm -f /etc/nginx/sites-available/money-manager.previous
systemctl daemon-reload
systemctl enable --now money-manager-backup.timer >/dev/null
cd /opt/money-manager && docker compose up -d --force-recreate >/dev/null 2>&1
rm -rf "$R"
REMOTE

echo "4/4 Checking…"
for i in $(seq 1 15); do
  if "${SSH[@]}" 'curl -fsS -m 3 http://127.0.0.1:8787/api/health' >/dev/null 2>&1; then
    echo "Deployed. Open https://138-2-66-148.sslip.io"
    exit 0
  fi
  sleep 2
done
echo "The backend did not report healthy. Check: ssh to the VM and run 'cd /opt/money-manager && docker compose logs'" >&2
exit 1
