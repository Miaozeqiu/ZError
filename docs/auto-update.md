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

文件名应标明架构，macOS 通用包用 `universal`。旧格式的 `ZError_Setup_2.2.5.exe` 仍按 Windows x64 安装包处理。修改更新包文件名时，签名文件也改成与更新包同名再加 `.sig`。如果重新打包，需对最终文件重新签名。

## 发版

1. 用现有 Tauri 更新私钥签名。macOS 使用 `npm run tauri:build:signed`。Windows 使用 `npm run tauri:build:win`。
2. 在主仓库新建 Release 草稿，使用形如 `v2.2.9` 的标签，且与桌面端构建版本一致。写好更新说明后上传对应的安装包、更新包和签名，再发布为正式 Release。
3. 检查 Open 返回的版本和各架构下载链接，再用较旧且已接入 Open 更新接口的客户端验证更新，确认重启后的版本。

保管好现有私钥。替换密钥会使旧客户端无法验证新签名。旧客户端使用随安装包内置的更新地址，接入 Open 的版本需要先安装一次。
