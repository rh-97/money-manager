# backend

The API server: Node.js + TypeScript + Fastify, with SQLite.

- Handles login (login-key hashes), sessions, and storing and syncing **encrypted** records with version numbers.
- Fetches the daily public USD to BDT rate.
- **Never sees readable financial data.**
- `admin/` holds the admin command-line tool (create user, recover user, set up recovery, backup).
- Never imports code from `frontend/`. Common code comes from `shared/`.

See [docs/spec-v1.md](../docs/spec-v1.md), sections 2.1, 3, 10 and 15.
