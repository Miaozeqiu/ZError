# 应用内浏览区：Chromium（CEF）

macOS 上每个浏览标签的子页已从 WKWebView 换成 CEF，嵌在同一主窗口里。Vue 壳（地址栏、Agent、题库）仍是 WebKit。Windows 仍走 WebView2。

## 开发

首次会下载约 150–180MB 的 `Chromium Embedded Framework`。编译 `cef-dll-sys` 需要 `cmake` 和 `ninja`（`pip install cmake ninja`）。

```bash
# 如 GitHub 拉不下来，先按 proxy-github-deps skill 开本地代理
export CEF_PATH="$HOME/.local/share/cef"
bash scripts/setup-cef-macos.sh
npm run tauri:dev
```

`setup-cef-macos.sh` 会把框架链到 `src-tauri/target/Frameworks/`，并生成：

- `ZError Helper.app`
- `ZError Helper (GPU).app`
- `ZError Helper (Plugin).app`
- `ZError Helper (Renderer).app`

Helper 进程走同一份 `zerror` 二进制（`main` 里 `--type=` 时进 `CefExecuteProcess`）。

## 登录态

WK 的 `app-browsers/profile` 和 Chromium 的 `app-browsers/chromium-profile-mock` **不是同一套 cookie**。换内核后需要重新登录学习通。旧 cookie 不会迁移。

开发态 CEF 用 `--use-mock-keychain`，避免 macOS 弹出「使用存储在钥匙串中的机密信息」后把整个 Tauri 进程杀掉。若 CEF 仍闪退，启动前加 `ZERROR_USE_WK=1`，浏览区走回 WKWebView。

## 打包

`npm run tauri:build` 在 macOS 上会再跑 `scripts/bundle-cef-macos.sh`，把框架和 helpers 打进 `ZError.app/Contents/Frameworks`。更新器要能下更大的安装包。

## Apple Silicon 上的 H.264

Spotify 预编译 CEF 没有 H.264/AAC。只在 **macOS arm64** 从源码重编：

```bash
# 工作目录默认 /Volumes/1t/cef-build（约 60–100GB，数小时）
# 需要能访问 Chromium / GitHub（可用 proxy-github-deps）
bash scripts/build-cef-macos-arm64.sh
```

编完会覆盖 `~/.local/share/cef/151.3.24/cef_macos_aarch64/Release` 里的框架，并写 `.zerror-codecs`。之后 `tauri:dev` 不再起 1430 转码。Windows 仍走 WebView2，不编这份 CEF。

## Agent

`browser_eval` 走 CDP `Runtime.evaluate`（含 iframe `Target.attach`），不再改 `document.title` 回传。点击 / 填写 / 快照优先 `Input` + `Accessibility`，页内 JS 只作降级。
