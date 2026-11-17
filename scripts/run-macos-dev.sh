#!/usr/bin/env bash
# Cargo runner: sign every rebuilt main executable with the same identity before launch.
set -euo pipefail
runner_root="$(cd "$(dirname "$0")" && pwd)"
"${ZERROR_NODE_BINARY:-node}" "$runner_root/sign-macos-dev.mjs" "$1"
exec "$@"
