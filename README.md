# Money Manager

A private, self-hosted, **end-to-end encrypted** money tracker for me and my family. It records expenses, income, transfers, currency exchange (BDT and USD) and loans, and shows balances and charts. It's used in the web browser on a phone or PC.

**Specification:** [docs/spec-v1.md](docs/spec-v1.md), the approved version 1 baseline.

## Repository layout

| Folder | What it holds |
|---|---|
| [`docs/`](docs/) | Common documents: spec, design notes, decisions |
| [`shared/`](shared/) | Common code used by both sides: encryption module, record definitions, API schemas |
| [`frontend/`](frontend/) | The web app (React + Vite, static files). All app logic, encryption and calculations run here. |
| [`backend/`](backend/) | The API server (Fastify + SQLite). Login, sessions, and storing and syncing **encrypted** records. Includes the admin command-line tool. |
| [`deploy/`](deploy/) | Deployment files for the VM: nginx site, Docker files, backup scripts |

**Rules:**
- `frontend/` and `backend/` never import each other's code. They talk only through the HTTP API.
- Anything both need lives in `shared/`.

## Status

| Milestone | State |
|---|---|
| Spec | ✅ Approved (15 Nov 2026) |
| M0 UI design | Next |
| M1–M5 | Not started |
