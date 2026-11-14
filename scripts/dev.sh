#!/usr/bin/env bash
# Run a command inside the isolated Node 24 dev container.
# Examples: ./scripts/dev.sh npm install   ./scripts/dev.sh npm test
set -euo pipefail
cd "$(dirname "$0")/.."
# The named volume is created root-owned; hand it to the "node" user once.
docker compose -f compose.dev.yml run --rm init >/dev/null 2>&1
exec docker compose -f compose.dev.yml run --rm --no-deps dev "$@"
