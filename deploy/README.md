# deploy

How Money Manager runs on the VM (Oracle Cloud, Ubuntu 24.04, ARM64). See also spec section 15.4.

## What runs where

| Part | Where on the VM |
|---|---|
| Frontend (static files) | `/var/www/money-manager`, served by nginx |
| nginx site | `/etc/nginx/sites-available/money-manager` (from [`nginx/money-manager.conf`](nginx/money-manager.conf)) |
| Backend | Docker Compose project in `/opt/money-manager` ([`compose.prod.yml`](compose.prod.yml)): the official `node:24` image runs the bundled `app/server.mjs`, listening only on `127.0.0.1:8787` |
| Database | `/opt/money-manager/data/money-manager.db` (encrypted records only) |
| Backups | `/opt/money-manager/data/backups/*.db.gz`, nightly at 3:30 AM Dhaka time, kept 30 days (`money-manager-backup.timer`) |
| Admin tool | `sudo mm-admin <command>` (wrapper around `app/admin/cli.mjs`) |

## Deploy a new version (from the Mac)

```bash
./deploy/deploy.sh
```

This runs the tests, builds, uploads, installs, tests the nginx config before reloading (and rolls it back if the test fails), restarts the backend, and checks health. Data is never touched.

## Admin tasks (on the VM)

```bash
sudo mm-admin setup-recovery                    # set the admin recovery phrase (once)
sudo mm-admin create-user ayesha --display-name "Ayesha Rahman"
sudo mm-admin recover-user ayesha               # temporary password for a user who chose admin recovery
sudo mm-admin list-users
sudo mm-admin disable ayesha                    # or: enable
sudo mm-admin backup                            # extra backup now
```

## Useful checks

```bash
cd /opt/money-manager && sudo docker compose ps         # backend health
sudo docker compose -f /opt/money-manager/compose.yml logs --tail 50
systemctl list-timers money-manager-backup.timer       # next backup
sudo certbot renew --dry-run                            # certificate renewal still works
```

## Still to do with the owner present

- **Google Drive backups:** rclone needs a one-time Google sign-in. Then `backup.sh` will also upload an encrypted copy (rclone crypt).
