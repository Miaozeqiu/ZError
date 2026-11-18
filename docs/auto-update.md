# ZError 自动更新发布说明

桌面端通过 Open 检查更新。Open 从 [ZError 主仓库的最新正式 Release](https://github.com/Miaozeqiu/ZError/releases/latest) 读取版本号、发布说明和附件，缓存约 5 分钟。安装包由客户端直接从 GitHub 下载。

| 接口 | 用途 |
| --- | --- |
| `https://open.zerrorai.com/v1/app-updates/native/<target>/<arch>` | Tauri Updater 清单。当前系统与架构没有签名更新包时返回 HTTP 204 |
| `https://open.zerrorai.com/v1/app-updates/latest` | 版本号、发布说明和各平台安装包地址 |

客户端优先使用 Tauri Updater。下载后由 Tauri 使用内置公钥验证签名并安装整包。仅有对应的普通安装包时，客户端提供下载安装包，供用户手动安装。

## 发布附件

| 平台 | 手动安装 | 应用内更新 |
| --- | --- | --- |
| Windows x64 | `ZError_2.2.9_x64-setup.exe` | 同一文件与 `ZError_2.2.9_x64-setup.exe.sig` |
| macOS Apple Silicon | `ZError_2.2.9_aarch64.dmg` | `ZError_2.2.9_aarch64.app.tar.gz` 及其 `.sig` |
| macOS Intel | `ZError_2.2.9_x64.dmg` | `ZError_2.2.9_x64.app.tar.gz` 及其 `.sig` |
| Linux x64 | `ZError_2.2.9_amd64.deb` 或 `ZError_2.2.9_amd64.AppImage` | Open 当前只提供 Windows 和 macOS 更新清单 |

文件名应标明架构，macOS 通用包用 `universal`。旧格式的 `ZError_Setup_2.2.5.exe` 仍按 Windows x64 安装包处理。修改更新包文件名时，签名文件也改成与更新包同名再加 `.sig`。如果重新打包，需对最终文件重新签名。

## 发版

1. 将发布提交合入 `master`，推送与 `src-tauri/tauri.conf.json` 版本一致的标签，例如 `v2.2.9`。GitHub Actions 构建 Windows x64 和 Linux x64 安装包并创建 Release 草稿。
2. 在 Apple Silicon Mac 本机运行 `bash scripts/build-release-macos.sh`，使用本机带 H.264/AAC 的 CEF 构建 DMG 和更新包。脚本对最终 Apple Silicon 更新包使用本机 Tauri 私钥签名。
3. 下载草稿中的 Windows NSIS 和 Linux AppImage，用现有 Tauri 私钥为每个文件生成 `.sig`。例如 `npm exec -- tauri signer sign --private-key-path src-tauri/keys/zerror.key --password= ZError_2.2.9_x64-setup.exe`。将这两个签名及 macOS 目录下的 DMG、更新包和其签名上传到草稿。
4. 运行 `gh workflow run release-windows.yml --ref master -f tag=v2.2.9`。工作流检查三个平台的附件和三份更新签名，再发布正式 Release。
5. 检查 Open 返回的版本、Windows 和 macOS 更新链接，并用较旧且已接入 Open 的客户端核对安装和重启。Linux AppImage 的安全存储依赖系统提供 Secret Service 和 `secret-tool`。Debian 安装包会声明 `libsecret-tools` 依赖。

保管好现有私钥。替换密钥会使旧客户端无法验证新签名。旧客户端使用随安装包内置的更新地址，接入 Open 的版本需要先安装一次。
