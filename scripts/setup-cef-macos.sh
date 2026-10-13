#!/usr/bin/env bash
# 下载 CEF 框架、链到 cargo target/Frameworks，并生成 ZError Helper.app（含 GPU/Plugin/Renderer）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/Library/Python/3.9/bin:$HOME/Library/Python/3.12/bin:$PATH"
if ! command -v cmake >/dev/null 2>&1 || ! command -v ninja >/dev/null 2>&1; then
  echo "[cef] 缺少 cmake/ninja，用 pip 装到用户目录"
  python3 -m pip install --user cmake ninja >/dev/null
fi
CEF_HOME="${CEF_PATH:-$HOME/.local/share/cef}"
export CEF_PATH="$CEF_HOME"
FRAMEWORKS="${CEF_FRAMEWORKS:-$ROOT/src-tauri/target/Frameworks}"
FW_NAME="Chromium Embedded Framework.framework"

mkdir -p "$CEF_HOME" "$FRAMEWORKS"

find_fw() {
  local root="$1"
  if [[ -d "$root/$FW_NAME" ]]; then
    echo "$root/$FW_NAME"
    return 0
  fi
  local hit
  hit="$(find "$root" -maxdepth 4 -type d -name "$FW_NAME" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$hit" ]]; then
    echo "$hit"
    return 0
  fi
  return 1
}

SRC_FW=""
if ! SRC_FW="$(find_fw "$CEF_HOME")"; then
  echo "[cef] 首次会下载约 150–180MB 的 Chromium Embedded Framework → $CEF_HOME"
  if command -v export-cef-dir >/dev/null 2>&1; then
    export-cef-dir --force "$CEF_HOME" || true
  fi
  SRC_FW="$(find_fw "$CEF_HOME" || true)"
fi

if [[ -z "$SRC_FW" ]]; then
  echo "[cef] 未找到 $FW_NAME。先 cargo check -p zerror（cef-dll-sys 会拉包），或设置 CEF_PATH。" >&2
  exit 1
fi

ln -sfn "$SRC_FW" "$FRAMEWORKS/$FW_NAME"

helper_id() {
  case "$1" in
    "ZError Helper (GPU)") echo "com.zerror.app.helper.gpu" ;;
    "ZError Helper (Plugin)") echo "com.zerror.app.helper.plugin" ;;
    "ZError Helper (Renderer)") echo "com.zerror.app.helper.renderer" ;;
    *) echo "com.zerror.app.helper" ;;
  esac
}

write_helper_plist() {
  local dest="$1"
  local name="$2"
  local id
  id="$(helper_id "$name")"
  cat > "$dest/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${name}</string>
  <key>CFBundleIdentifier</key>
  <string>${id}</string>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF
}

make_helper() {
  local name="$1"
  local exe="${2:-}"
  local dest="$FRAMEWORKS/${name}.app"
  mkdir -p "$dest/Contents/MacOS"
  write_helper_plist "$dest" "$name"
  if [[ -n "$exe" && -f "$exe" ]]; then
    rm -f "$dest/Contents/MacOS/${name}"
    ln "$exe" "$dest/Contents/MacOS/${name}" 2>/dev/null \
      || ln -sfn "$exe" "$dest/Contents/MacOS/${name}"
  else
    : > "$dest/Contents/MacOS/${name}.placeholder"
  fi
}

DEBUG_EXE="$ROOT/src-tauri/target/debug/zerror"
# 允许悬空符号链接：cargo 编出 zerror 后 helper 立刻可用
make_helper "ZError Helper" "$DEBUG_EXE"
make_helper "ZError Helper (GPU)" "$DEBUG_EXE"
make_helper "ZError Helper (Plugin)" "$DEBUG_EXE"
make_helper "ZError Helper (Renderer)" "$DEBUG_EXE"

echo "[cef] 框架: $FRAMEWORKS/$FW_NAME"
echo "[cef] helpers: ZError Helper.app / (GPU) / (Plugin) / (Renderer)"
echo "[cef] CEF_PATH=$CEF_PATH"
if [[ -f "$CEF_HOME/151.3.24/cef_macos_aarch64/.zerror-codecs" ]]; then
  echo "[cef] 当前框架带 H.264/AAC（macOS arm64 自编译）"
fi
