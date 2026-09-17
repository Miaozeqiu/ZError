#!/usr/bin/env bash
# 只在 macOS Apple Silicon 上，从源码编 CEF 151.3.24，打开 H.264/AAC。
# Spotify 预编译包是 ffmpeg_branding=Chromium，没有专有编码。
# 产物装进 $CEF_PATH/151.3.24/cef_macos_aarch64，保留 archive.json，cargo 不会重下开源包。
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "[cef-codecs] 只支持 macOS arm64" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${CEF_BUILD_DIR:-/Volumes/1t/cef-build}"
CEF_HOME="${CEF_PATH:-$HOME/.local/share/cef}"
DEST="$CEF_HOME/151.3.24/cef_macos_aarch64"
BRANCH="${CEF_BRANCH:-7922}"
CEF_CHECKOUT="${CEF_CHECKOUT:-2384915}"
MEM_GB="$(sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)}')"
NCPU="$(sysctl -n hw.ncpu)"
JOBS="${CEF_NINJA_JOBS:-}"
if [[ -z "$JOBS" ]]; then
  # 按核数铺满会换页，反而更慢。16GB/10 核实测 -j7 最快（-j5 慢 35%，-j10 换页）。
  JOBS=$(( MEM_GB / 2 ))
  [[ "$JOBS" -gt $(( NCPU - 3 )) ]] && JOBS=$(( NCPU - 3 ))
  [[ "$JOBS" -lt 2 ]] && JOBS=2
fi

export GN_DEFINES="${GN_DEFINES:-is_official_build=true proprietary_codecs=true ffmpeg_branding=Chrome symbol_level=0 blink_symbol_level=0 chrome_pgo_phase=0 use_thin_lto=false is_component_build=false}"
export CEF_USE_GN=1
export CEF_ARCHIVE_FORMAT=tar.bz2
export CEF_NINJA_JOBS="$JOBS"
export PATH="$BUILD/depot_tools:$PATH"

mkdir -p "$BUILD" "$DEST"

echo "[cef-codecs] 工作目录 $BUILD"
echo "[cef-codecs] GN_DEFINES=$GN_DEFINES"
echo "[cef-codecs] ninja -j$JOBS  （约需 60–100GB、数小时）"

if [[ ! -d "$BUILD/depot_tools/.git" ]]; then
  echo "[cef-codecs] 克隆 depot_tools"
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$BUILD/depot_tools"
fi

AUTOMATE="$BUILD/automate-git.py"
if [[ ! -f "$AUTOMATE" ]]; then
  echo "[cef-codecs] 下载 automate-git.py"
  curl -fsSL -o "$AUTOMATE" \
    https://raw.githubusercontent.com/chromiumembedded/cef/master/tools/automate/automate-git.py
fi

# automate-git 写死 autoninja 且从不传 -j，NINJAFLAGS/NINJA_JOBS 都不读。
if ! grep -q CEF_NINJA_JOBS "$AUTOMATE"; then
  echo "[cef-codecs] 给 automate-git.py 打并发上限补丁"
  python3 - "$AUTOMATE" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
old = "  command = 'autoninja '\n"
new = ("  command = 'autoninja '\n"
       "  if os.environ.get('CEF_NINJA_JOBS'):\n"
       "    command += '-j %s ' % os.environ['CEF_NINJA_JOBS']\n")
if old not in src:
    sys.exit('automate-git.py 结构变了，找不到 autoninja 调用')
open(path, 'w').write(src.replace(old, new, 1))
PY
fi

ARGS=(
  --download-dir="$BUILD/chromium_git"
  --depot-tools-dir="$BUILD/depot_tools"
  --branch="$BRANCH"
  --checkout="$CEF_CHECKOUT"
  --arm64-build
  --no-debug-build
  --minimal-distrib-only
  --no-distrib-docs
  --no-distrib-symbols
  --no-chromium-history
  --build-log-file
)
if [[ "${CEF_FORCE_CLEAN:-}" == "1" ]]; then
  ARGS+=(--force-clean)
elif [[ -d "$BUILD/chromium_git/chromium/src/out/Release_GN_arm64" ]]; then
  ARGS+=(--no-update --force-build)
  echo "[cef-codecs] 已有 checkout，续编（--no-update --force-build）"
fi

echo "[cef-codecs] automate-git.py ${ARGS[*]}"
python3 "$AUTOMATE" "${ARGS[@]}"

DIST="$(find "$BUILD/chromium_git/chromium/src/cef/binary_distrib" -maxdepth 1 -type d -name '*macosarm64*' | head -n 1 || true)"
if [[ -z "$DIST" ]]; then
  DIST="$(find "$BUILD/chromium_git" -type d -name 'Chromium Embedded Framework.framework' 2>/dev/null | head -n 1 || true)"
  if [[ -n "$DIST" ]]; then
    DIST="$(dirname "$DIST")"
  fi
fi
if [[ -z "$DIST" || ! -d "$DIST/Chromium Embedded Framework.framework" && ! -d "$DIST/Release/Chromium Embedded Framework.framework" ]]; then
  echo "[cef-codecs] 找不到编好的 Chromium Embedded Framework.framework" >&2
  exit 1
fi

SRC_FW="$DIST/Release/Chromium Embedded Framework.framework"
if [[ ! -d "$SRC_FW" ]]; then
  SRC_FW="$DIST/Chromium Embedded Framework.framework"
fi

# cef crate 把 framework 摊在 cef_macos_aarch64/ 顶层，不是 Release/ 子目录。
echo "[cef-codecs] 安装 $SRC_FW → $DEST/"
rsync -a --delete "$SRC_FW" "$DEST/"
printf 'proprietary_codecs=true\nffmpeg_branding=Chrome\nbranch=%s\ncheckout=%s\n' "$BRANCH" "$CEF_CHECKOUT" > "$DEST/.zerror-codecs"
bash "$ROOT/scripts/setup-cef-macos.sh"

echo "[cef-codecs] 已安装带 H.264 的 CEF（macOS arm64）"
echo "[cef-codecs] 重启 npm run tauri:dev 后学习通可走内核解码，不再转 WebM"
