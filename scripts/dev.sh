#!/usr/bin/env bash
# Run a command inside the isolated Node 24 dev container.
# Examples: ./scripts/dev.sh npm install   ./scripts/dev.sh npm test
set -euo pipefail
cd "$(dirname "$0")/.."
# The named volume is created root-owned; hand it to the "node" user once.
docker compose -f compose.dev.yml run --rm --user root --no-deps dev \
  sh -c 'chown node:node /app/node_modules /app/shared/node_modules /app/backend/node_modules /app/frontend/node_modules /data' >/dev/null
exec docker compose -f compose.dev.yml run --rm --no-deps dev "$@"
