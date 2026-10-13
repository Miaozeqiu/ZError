#!/usr/bin/env bash
# 开发机 cargo 入口：补上 pip cmake/ninja 和 CEF_PATH，默认 --no-default-features（与 tauri:dev 一致）。
set -euo pipefail
export PATH="$HOME/Library/Python/3.9/bin:$HOME/Library/Python/3.12/bin:$PATH"
export CEF_PATH="${CEF_PATH:-$HOME/.local/share/cef}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"
has_feat=0
for arg in "$@"; do
  case "$arg" in
    --features|--no-default-features|--all-features) has_feat=1 ;;
  esac
done
if [[ "$has_feat" -eq 0 ]]; then
  exec cargo "$@" --no-default-features
fi
exec cargo "$@"
