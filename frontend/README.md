# frontend

The web app: React + TypeScript, built with Vite into static files.

- Runs entirely in the browser: login key derivation, decryption, calculations (balances, loans, charts) and the UI.
- Talks to the backend **only** through the HTTP API (`/api`).
- Never imports code from `backend/`. Common code comes from `shared/`.

See [docs/spec-v1.md](../docs/spec-v1.md), sections 3, 10, 11 and 15.
