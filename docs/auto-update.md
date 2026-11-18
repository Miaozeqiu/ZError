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

1. 同步修改 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 的版本号，合入 `master`。
2. GitHub 托管的 runner 构建 Windows x64、macOS Apple Silicon 和 Linux x64。macOS 作业在 Intel runner 上交叉编译 arm64，并核对私有 GitHub Packages 中自编 CEF 的 OCI 摘要和归档 SHA-256。
3. `desktop-release` 环境中的 `TAURI_SIGNING_PRIVATE_KEY` 用于签署最终更新包。工作流用应用内置公钥核对三份签名，再为该提交创建版本标签和正式 Release。
4. 检查 Open 返回的 Windows 和 macOS 更新链接，并用较旧且已接入 Open 的客户端核对安装和重启。Linux AppImage 的安全存储依赖系统提供 Secret Service 和 `secret-tool`。Debian 安装包会声明 `libsecret-tools` 依赖。

`gh workflow run release-desktop.yml --ref master` 可以手动验证当前版本的三平台构建和更新签名。为当前提交重试正式发布时，使用 `gh workflow run release-desktop.yml --ref master -f publish=true`。

保管好现有私钥。替换密钥会使旧客户端无法验证新签名。旧客户端使用随安装包内置的更新地址，接入 Open 的版本需要先安装一次。
