# Money Manager

A private, self-hosted, **end-to-end encrypted** money tracker for me and my family. It records expenses, income, transfers, currency exchange (BDT and USD) and loans, and shows balances and charts. It's used in the web browser on a phone or PC.

- **Live:** https://138-2-66-148.sslip.io
- **Specification:** [docs/spec-v1.md](docs/spec-v1.md), the approved version 1 baseline, with a change log
- **Design:** [docs/design/](docs/design/), the approved mockup and design notes

## Repository layout

| Folder | What it holds |
|---|---|
| [`docs/`](docs/) | Common documents: spec, design, decisions |
| [`shared/`](shared/) | Code used by both sides: the encryption module (`crypto.ts`) and API schemas (`api.ts`) |
| [`frontend/`](frontend/) | The web app (React + Vite). Encryption, all money calculations (`src/money/`) and the UI run here. |
| [`backend/`](backend/) | The API (Fastify + Node's built-in SQLite). Login, sessions, encrypted record sync, dollar rates. Includes the admin tool (`src/admin/`). |
| [`deploy/`](deploy/) | VM deployment: nginx site, production compose file, backups, `deploy.sh` |

The frontend and backend never import each other's code; they only talk through the HTTP API.

## Development (everything runs in Docker)

Nothing is installed on the Mac itself: Node, `node_modules` and the dev database live in Docker containers and volumes.

```bash
./scripts/dev.sh npm install          # install dependencies
./scripts/dev.sh npm test             # all tests (encryption, API, money logic)
./scripts/dev.sh npm run typecheck    # TypeScript checks
docker compose -f compose.dev.yml up backend frontend   # run the app → http://localhost:5173
```

Create a dev login:

```bash
docker compose -f compose.dev.yml exec backend npm run admin -- create-user yourname --admin
```

## Deploying

```bash
./deploy/deploy.sh
```

It runs the tests, builds, uploads and installs. Data on the VM is never touched. Details are in [deploy/README.md](deploy/README.md).

## Status

| Milestone | State |
|---|---|
| Spec and UI design (M0) | ✅ Approved |
| M1 Login and encryption | ✅ Done |
| M2 Accounts and entries | ✅ Done |
| M3 Loans | ✅ Done |
| M4 Home and Stats | ✅ Done |
| M5 Go live | ✅ Deployed. Waiting for: first login, admin recovery phrase, Google Drive backups |
