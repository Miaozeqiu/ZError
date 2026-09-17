#!/usr/bin/env bash
# 把 CEF 框架和 4 个 Helper.app 拷进已打好的 ZError.app，并重打 dmg。
# Helper 硬链到主程序；只保留 en/zh locale，减小安装包。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CEF_HOME="${CEF_PATH:-$HOME/.local/share/cef}"
FRAMEWORKS="${CEF_FRAMEWORKS:-$ROOT/src-tauri/target/Frameworks}"
APP="${1:-}"

if [[ -z "$APP" ]]; then
  APP="$ROOT/src-tauri/target/release/bundle/macos/ZError.app"
fi
if [[ ! -d "$APP" ]]; then
  echo "[cef] 没有找到 $APP，跳过打包 CEF" >&2
  exit 0
fi

DEST="$APP/Contents/Frameworks"
mkdir -p "$DEST"
FW_NAME="Chromium Embedded Framework.framework"

# setup-cef 在 Frameworks/ 下放的是 symlink；rsync -a 会原样拷链接，安装包里就是空的。
resolve_fw() {
  local candidate
  for candidate in "$FRAMEWORKS/$FW_NAME" "$CEF_HOME/151.3.24/cef_macos_aarch64/$FW_NAME" "$CEF_HOME/$FW_NAME"; do
    if [[ -e "$candidate" ]]; then
      python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$candidate"
      return 0
    fi
  done
  return 1
}

SRC_FW="$(resolve_fw || true)"
if [[ -z "$SRC_FW" || ! -d "$SRC_FW" ]]; then
  echo "[cef] 缺少 $FW_NAME，先跑 scripts/setup-cef-macos.sh" >&2
  exit 1
fi

echo "[cef] 拷贝 $SRC_FW → $DEST/"
rsync -a --delete "$SRC_FW" "$DEST/"

# 只留英文 + 简繁中文 locale（约 220 个 .lproj 里砍掉绝大部分）
RES="$DEST/$FW_NAME/Resources"
if [[ -d "$RES" ]]; then
  removed=0
  for dir in "$RES"/*.lproj; do
    [[ -d "$dir" ]] || continue
    base="$(basename "$dir" .lproj)"
    case "$base" in
      en|en_*|zh_CN|zh_CN_*|zh_TW|zh_TW_*|zh_Hans|zh_Hans_*|zh_Hant|zh_Hant_*) ;;
      *) rm -rf "$dir"; removed=$((removed + 1)) ;;
    esac
  done
  echo "[cef] stripped $removed locale bundles"
fi

EXE="$APP/Contents/MacOS/zerror"
if [[ ! -x "$EXE" ]]; then
  EXE="$APP/Contents/MacOS/ZError"
fi

helper_id() {
  case "$1" in
    "ZError Helper (GPU)") echo "com.zerror.app.helper.gpu" ;;
    "ZError Helper (Plugin)") echo "com.zerror.app.helper.plugin" ;;
    "ZError Helper (Renderer)") echo "com.zerror.app.helper.renderer" ;;
    *) echo "com.zerror.app.helper" ;;
  esac
}

copy_helper() {
  local name="$1"
  local dest="$DEST/${name}.app"
  local id
  local target="$dest/Contents/MacOS/${name}"
  id="$(helper_id "$name")"
  mkdir -p "$dest/Contents/MacOS"
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
  <key>LSBackgroundOnly</key>
  <true/>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF
  rm -f "$target"
  # 硬链：装盘只算一份；dmg 需用能保留硬链的方式制作
  ln "$EXE" "$target"
  chmod +x "$target"
}

copy_helper "ZError Helper"
copy_helper "ZError Helper (GPU)"
copy_helper "ZError Helper (Plugin)"
copy_helper "ZError Helper (Renderer)"

APP_SIZE="$(du -sh "$APP" | awk '{print $1}')"
FW_SIZE="$(du -sh "$DEST/$FW_NAME" | awk '{print $1}')"
echo "[cef] wrote $DEST  framework=${FW_SIZE}  app=${APP_SIZE}"

# tauri 先打 dmg 再跑本脚本，必须重打，否则 dmg 里没有 CEF。
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
if [[ -z "$VERSION" ]]; then
  VERSION="$(python3 -c 'import json; print(json.load(open("'"$ROOT"'/src-tauri/tauri.conf.json"))["version"])')"
fi
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
mkdir -p "$DMG_DIR"
DMG="$DMG_DIR/ZError_${VERSION}_aarch64.dmg"

# -srcfolder 会拆开硬链；先落到 APFS sparse image 再转 UDZO，保留硬链。
STAGE="$(mktemp -d)"
SPARSE="$STAGE/ZError.sparseimage"
hdiutil create -size 1g -type SPARSE -fs APFS -volname ZError "$SPARSE" >/dev/null
MNT="$(hdiutil attach "$SPARSE" -nobrowse | awk '/\/Volumes\//{print $NF; exit}')"
ditto "$APP" "$MNT/ZError.app"
hdiutil detach "$MNT" >/dev/null
rm -f "$DMG"
hdiutil convert "$SPARSE" -format UDZO -imagekey zlib-level=9 -o "$DMG" >/dev/null
rm -rf "$STAGE"
echo "[cef] remade $DMG ($(ls -lh "$DMG" | awk '{print $5}'))"

# 更新器用的 .app.tar.gz（tar 默认保留硬链）
MACOS_DIR="$ROOT/src-tauri/target/release/bundle/macos"
shopt -s nullglob
for tar in "$MACOS_DIR"/*.app.tar.gz; do
  out="$MACOS_DIR/$(basename "$tar")"
  echo "[cef] remade updater $out"
  tar -C "$APP/.." -czf "$out.tmp" "$(basename "$APP")"
  mv "$out.tmp" "$out"
done
shopt -u nullglob

if [[ -f "$HOME/.local/share/cef/151.3.24/cef_macos_aarch64/.zerror-codecs" ]]; then
  echo "[cef] bundle includes H.264/AAC CEF"
fi
echo "[cef] Chromium framework embedded; Chaoxing may need re-login."
