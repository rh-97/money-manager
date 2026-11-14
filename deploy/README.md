# deploy

Deployment files for the VM (Oracle Cloud, Ubuntu 24.04, ARM64):

- nginx site config (serves the frontend, forwards `/api` to the backend, HTTPS)
- Docker files for the backend (ARM64 images)
- nightly encrypted backup script (rclone crypt to Google Drive)

See [docs/spec-v1.md](../docs/spec-v1.md), sections 14 and 15.4.
