#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "macOS is required to build the Apple Silicon installer." >&2
  exit 1
fi
target=aarch64-apple-darwin
export CEF_PATH="${CEF_PATH:-$HOME/.local/share/cef}"
export PATH="$HOME/Library/Python/3.9/bin:$HOME/Library/Python/3.12/bin:$PATH"
test -f "$CEF_PATH/151.3.24/cef_macos_aarch64/.zerror-codecs"
test -x "$CEF_PATH/151.3.24/cef_macos_aarch64/Chromium Embedded Framework.framework/Chromium Embedded Framework"

version="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
config="$(mktemp -d)"
trap 'rm -rf "$config"' EXIT
printf '%s\n' '{"bundle":{"createUpdaterArtifacts":false}}' > "$config/tauri.conf.json"

node scripts/tauri-cli.mjs build --ci --target "$target" --bundles app --config "$config/tauri.conf.json" -- --locked
bundle="$root/src-tauri/target/$target/release/bundle"
app="$bundle/macos/ZError.app"
test -d "$app"
CEF_FRAMEWORKS="$CEF_PATH/151.3.24/cef_macos_aarch64" ZERROR_ADHOC_SIGN=1 bash scripts/bundle-cef-macos.sh "$app"

out="$root/output/release-v$version"
mkdir -p "$out"
cp "$bundle/dmg/ZError_${version}_aarch64.dmg" "$out/"
tar -C "$bundle/macos" -czf "$out/ZError_${version}_aarch64.app.tar.gz" ZError.app
hdiutil verify "$out/ZError_${version}_aarch64.dmg"
if [[ "${ZERROR_SKIP_UPDATER_SIGN:-}" != 1 ]]; then
  npm exec -- tauri signer sign --private-key-path src-tauri/keys/zerror.key --password= "$out/ZError_${version}_aarch64.app.tar.gz" >/dev/null
fi
printf 'macOS artifacts staged at %s\n' "$out"
