# 软件外 Agent 接口

开发模式（`npm run tauri:dev`）会在本机起桥。应用须停在 **Tauri 窗口** 的浏览页，不要用普通 Chrome 打开 `localhost:1420`。

- HTTP：`http://127.0.0.1:1429/rpc`
- CLI：`node scripts/browser-bridge.mjs <action>`
- 只绑 `127.0.0.1`，不进正式包

底层是应用里同一块 CEF（调试口默认 `127.0.0.1:9333`）。要自己写 Playwright，连 9333，见 [playwright-layer.md](./playwright-layer.md)。本桥把解析器和类 Playwright 操作收成一条 JSON 接口。

---

## 同步 RPC

```bash
curl -sS -X POST http://127.0.0.1:1429/rpc \
  -H 'Content-Type: application/json' \
  -d '{"action":"help","args":{}}'
```

请求：`{ "action": "chapter", "args": { "browserId": "" }, "timeoutMs": 20000 }`  
响应：`{ "ok": true, "id": "...", "action": "chapter", ... }`

`GET /help` 不经过应用，立刻返回动作表。  
`GET /live` 是当前标签的粗略心跳。  
旧的异步 `POST /cmd` + `GET /result` 仍可用。

---

## CLI

```bash
node scripts/browser-bridge.mjs help
node scripts/browser-bridge.mjs list
node scripts/browser-bridge.mjs state
node scripts/browser-bridge.mjs goto https://mooc1.chaoxing.com
node scripts/browser-bridge.mjs snapshot
node scripts/browser-bridge.mjs click --text "我学的课"
node scripts/browser-bridge.mjs type --selector "input[name=uname]" --text "学号"
node scripts/browser-bridge.mjs chapter
node scripts/browser-bridge.mjs chapter_open --title "函数（一）"
node scripts/browser-bridge.mjs play --videoIndex 2
node scripts/browser-bridge.mjs pause
node scripts/browser-bridge.mjs next
node scripts/browser-bridge.mjs homework inspect
```

指定标签：`--id <browserId>`。默认用当前选中的，其次最近的学习通页。

---

## 动作

### 元信息

| 动作 | 参数 | 说明 |
|---|---|---|
| `help` | | 列出动作 |
| `list` | | 应用内标签 |
| `state` | | 当前页 + 章节解析器全文 |

### 浏览器（类 Playwright）

| 动作 | 参数 | 说明 |
|---|---|---|
| `goto` / `navigate` | `url` | 打开网址 |
| `reload` | | 刷新 |
| `back` / `forward` | | 前进后退 |
| `click` | `selector` 或 `text` | 点元素 |
| `click_text` | `text` | 按可见文本点 |
| `type` / `fill` | `selector`, `text` | 填写 |
| `hover` | `selector` 或 `text` | 悬停 |
| `press` | `key` | 按键 |
| `scroll` | `amount` | 滚动 |
| `wait` | `ms` / `selector` / `text` / `url` | 等到出现或超时 |
| `screenshot` | | 截图 data URL |
| `snapshot` / `page` | | 无障碍快照 |
| `eval` | `script` | 在页面跑 JS |

### 学习通解析器

| 动作 | 参数 | 说明 |
|---|---|---|
| `chapter` | | 强制读目录，返回章节树和本节任务点 |
| `chapter_open` | `title` / `index` / `chapterId` | 打开一节 |
| `play` | `videoIndex` / `label` / `title` | 播任务点 |
| `pause` | | 暂停 |
| `next` | | 下一未完成视频或下一节 |
| `probe` / `watch` | | 当前视频进度 |
| `inspect` | | 读作业/测验题卡 |
| `homework` | `action=inspect\|list\|open\|fill\|guess\|save\|submit` | 题卡 |
| `captcha` | `code` | 填 4 位验证码 |

### 应用内 Agent

| 动作 | 参数 | 说明 |
|---|---|---|
| `send` / `prompt` | `text` | 给应用内浏览器 Agent 发一句 |
| `chat` | | 读最近一条 |
| `stop` | | 停下应用内 Agent |

---

## 给外部 Agent 的最小用法

1. `npm run tauri:dev`，切到浏览页，打开学习通。
2. `POST /rpc` `list` 确认有标签。
3. `chapter` 拿目录和任务点，不要自己去 scrape `#coursetree`。
4. 要操作页面用 `goto` / `click` / `type` / `snapshot`，不要另起 Chromium。
5. 要自己写 Playwright：`chromium.connectOverCDP('http://127.0.0.1:9333')`，选和当前浏览区同一 URL 的 page。
