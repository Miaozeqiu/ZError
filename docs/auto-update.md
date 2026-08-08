# ZError 自动更新发布说明（Windows / macOS）

本文说明如何用 **Tauri Updater** 做应用内更新，以及 API / CDN 需要适配的内容。  
目标：用户**不必每次拖 DMG**；Windows / Mac 分端下载对应安装包。

---

## 1. 远程地址（测试版 / 正式版统一）

| 资源 | URL（客户端优先用 /live） | 旧路径（易被 EdgeOne HIT） |
|------|---------------------------|----------------------------|
| 模型列表 | `https://webapi.zaizhexue.top/live/models.json` | `/models.json` |
| 回退下载 | `https://webapi.zaizhexue.top/live/latest_version.json` | `/latest_version.json` |
| Tauri Updater | `https://webapi.zaizhexue.top/live/update.json` | `/update.json` |

测试版与正式版**都使用**上述地址。数据流：ze-admin → ze-admin-backend（Postgres `app_config`）→ csid_backend → EdgeOne → 客户端。

客户端：`src-tauri/tauri.conf.json` → `plugins.updater.endpoints` →  
`https://webapi.zaizhexue.top/live/update.json`

配置拆成两份：

- `latest_version.json`：回退下载 `downloadUrl` / `downloadUrlMac` / `downloadUrlWin`
- `update.json`：Tauri Updater 的 `platforms` + `signature`

发版后若根路径仍滞后：在 EdgeOne 对旧 URL 清缓存，并对这些 JSON 设 **no-cache / 禁止强制缓存**。

---

## 2. 更新方式概览

| 方式 | 条件 | 行为 |
|------|------|------|
| **Tauri Updater（优先）** | JSON 含合法 `platforms.*.signature` | 应用内下载并**原地替换**整包（含 Rust 内核） |
| **回退下载** | 无 `platforms` 或校验失败 | 按系统下载 DMG/EXE 到「下载」文件夹 |

- 更新的是**整个 `.app` / 安装包**，不是只热更新前端。
- 用户数据（题库、设置）一般在 Application Support，**不会被覆盖**。
- Mac **首次**仍建议用 DMG 装到「应用程序」；之后有签名包即可走 Updater。

---

## 3. 平台产物对照

| 平台 | 架构 key | 首次安装（可选） | 应用内更新（`platforms`） |
|------|----------|------------------|---------------------------|
| macOS Apple Silicon | `darwin-aarch64` | `ZError_x.y.z.dmg` | `*.app.tar.gz` + `*.sig` |
| macOS Intel | `darwin-x86_64` | 同上或单独包 | `*.app.tar.gz` + `*.sig` |
| Windows x64 | `windows-x86_64` | `ZError_Setup_x.y.z.exe` | 同一个 `.exe` + `.exe.sig` |

安装包文件本身可仍托管在任意 CDN（例如 `app.zerror.cc/apps/...`），只要写进 JSON 的 `url` / `downloadUrl*` 即可。

---

## 4. 签名构建（发版机）

私钥（**勿提交 Git**）：

```text
src-tauri/keys/zerror.key
src-tauri/keys/zerror.key.pub
```

```bash
export TAURI_SIGNING_PRIVATE_KEY="$PWD/src-tauri/keys/zerror.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri:build:signed
```

Windows PowerShell：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$PWD\src-tauri\keys\zerror.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri:build
```

产物目录：`src-tauri/target/release/bundle/`  
**私钥丢失后旧客户端无法再接受新签名更新，请离线备份。**

---

## 5. API：`latest_version.json` 完整示例

路径：`https://webapi.zaizhexue.top/latest_version.json`  
模板：`tmp/latest_version.json.example`

```json
{
  "version": "2.2.7",
  "notes": "更新说明…",
  "changelog": "更新说明…",
  "pub_date": "2026-08-08T12:00:00Z",
  "downloadUrl": "https://app.zerror.cc/apps/ZError_Setup_2.2.7.exe",
  "downloadUrlMac": "https://app.zerror.cc/apps/ZError_2.2.7.dmg",
  "downloadUrlWin": "https://app.zerror.cc/apps/ZError_Setup_2.2.7.exe",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://app.zerror.cc/apps/ZError_2.2.7_aarch64.app.tar.gz",
      "signature": "<ZError.app.tar.gz.sig 文件全文>"
    },
    "darwin-x86_64": {
      "url": "https://app.zerror.cc/apps/ZError_2.2.7_x64.app.tar.gz",
      "signature": "<对应 .sig 全文>"
    },
    "windows-x86_64": {
      "url": "https://app.zerror.cc/apps/ZError_Setup_2.2.7.exe",
      "signature": "<对应 .exe.sig 全文>"
    }
  }
}
```

### 字段说明

| 字段 | 用途 |
|------|------|
| `version` | SemVer |
| `notes` / `changelog` | 更新说明（二选一或都写） |
| `downloadUrl` / `downloadUrlMac` / `downloadUrlWin` | 回退手动下载 |
| `platforms.*.url` | Updater 下载直链 |
| `platforms.*.signature` | **必须是 `.sig` 全文**，不能是 URL |

当前线上若只有旧字段（无 `platforms`），客户端会走回退下载；补齐签名后才启用应用内原地更新。

---

## 6. 接口要求

- HTTPS
- `Content-Type: application/json`
- 安装包 URL 可直链下载
- 允许跨域 GET
- **发版顺序：** 先上传包与 `.sig` → 再改 `latest_version.json` 的 `version`

---

## 7. 发版 Checklist

1. Mac：签名构建 → 上传 `.app.tar.gz`、`.sig`，可选 `.dmg`
2. Windows：签名构建 → 上传 `.exe`、`.exe.sig`
3. 把各 `.sig` **全文**写入 `latest_version.json` → `platforms`
4. 填写 `downloadUrlMac` / `downloadUrlWin`
5. 更新 `version` / `notes` / `changelog`
6. 部署到 `https://webapi.zaizhexue.top/latest_version.json`
7. 旧客户端验证：标题栏提示 → 安装/下载 → 重启后版本正确

---

## 8. 客户端行为

1. 启动读 `https://webapi.zaizhexue.top/latest_version.json`
2. 有合法 `platforms` → Tauri 原地更新 → 提示重启
3. 否则用 `downloadUrl*` 按 Win/Mac 下载安装包
4. 「一周后提醒」只抑制弹窗

相关代码：`src/services/versionCheck.ts`、`src/services/modelConfig.ts`、`src/composables/useAppUpdate.ts`

---

## 9. 常见问题

**Q: 测试版和正式版配置不同吗？**  
A: 不不同，都指向 `webapi.zaizhexue.top`。

**Q: 只更新前端还是连 Rust？**  
A: 整包替换，Rust 内核一起更新。

**Q: signature 能写文件路径吗？**  
A: 不能，必须是 `.sig` 文本内容。
