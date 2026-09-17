# Playwright 协议层：怎么实现

给要动手写**开发脚本**的人。产品决策见 [browser-protocol.md](./browser-protocol.md)。

**应用内协议不在这篇。** 用户问的「应用里类 Playwright 怎么实现」见 [in-app-protocol.md](./in-app-protocol.md)：`read/locate/act` + Rust CDP，不打包 Node。本文只覆盖本机 `scripts/cef-pw` 连 9333，给 Cursor / 回归用。

---

## 0. 先定死的三件事

1. **Playwright 不进应用包。** 不写进根目录 `package.json` 的 `dependencies`，不随 `tauri:build` 打给用户。用户刷课不需要 Node。
2. **第一笔只做开发脚本。** 应用内点击、填空、题卡仍然走现在的 `browser_cdp_*` + `cdp_client.rs`。协议层先在 `scripts/cef-pw/` 里证明「连得上、点得到、截的是同一页」。
3. **永远 `connectOverCDP`，禁止 `chromium.launch()`。** 车是 CEF（默认 `127.0.0.1:9333`），司机是这段 Node。

过关之前不要谈 sidecar、不要迁 `clickHomeworkBox`、不要删 Rust CDP。

---

## 1. 它在栈里的位置

现在：

```
前端 invoke('browser_cdp_click_box')
        ↓
Rust cef_browser::cdp_click_box
        ↓
bind_page(id) 用 tab 记住的 URL 对上 CDP target
        ↓
eval_all_frames + Input.dispatchMouseEvent
```

协议层（阶段 A）另开一条**平行**的开发入口，连同一个 9333：

```
node scripts/cef-pw/cli.mjs screenshot
        ↓
connectCef() → pickPage() → pickFrame()
        ↓
page.screenshot() / mouse.click()
        ↓
同一块 CEF（用户正在看的那页）
```

两条路暂时共存。阶段 B 才考虑让前端也走协议层；阶段 E 才删手写 Input。

写代码的 AI（Cursor / Codex）用左边这条。应用内 Agent 继续用右边那套业务工具。不要合成一类。

---

## 2. 目录（只加这些）

独立小包，和根目录依赖切开。本机已有全局 Playwright 也可以先跑，但仓库里要有可复现的一份。

```
scripts/cef-pw/
  package.json          # 只有 playwright，不进应用包
  src/connect.mjs       # 连 9333，列出 page
  src/page.mjs          # 按 URL / title 选当前浏览区
  src/frames.mjs        # 移植 eval_score，挑作业/目录/视频帧
  src/driver.mjs        # read / locate / act
  src/cli.mjs           # 给人敲的入口
  README.md             # 三条命令怎么跑
```

根目录 `package.json` 只加脚本别名，**不加** `playwright` 依赖：

```json
"cef:pw": "node scripts/cef-pw/src/cli.mjs"
```

安装：

```bash
cd scripts/cef-pw && npm install
```

`scripts/cef-pw/package.json` 示例：

```json
{
  "name": "zerror-cef-pw",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.55.0"
  }
}
```

版本以「能 `connectOverCDP` 上 CEF Chrome 131」为准，不必追最新。CEF UA 在 `cef_runtime.rs`。高级 Playwright API 不可用就降级，不要换 CEF。

不要新建 `src/services/browser/playwright.ts` 让 Vite 去 import Playwright。前端跑在 WebView 里，没有 Node，也没有 `chromium`。

---

## 3. 目标 API（给脚本调，不给模型）

业务代码以后若迁过来，也只看这三个函数。CLI 是它们的薄壳。

```js
// driver.mjs

export async function read(page, hint) {
  // hint: 'page' | 'homework' | 'catalog' | 'video' | 'any'
  // 返回 { url, title, html, frameUrl }
}

export async function locate(page, query) {
  // query: { text } | { css } | { script }
  // 返回 { found, frameUrl, x, y, text }
  // found === false 时不要假装点过
}

export async function act(page, action) {
  // action:
  //   { type: 'click', x, y }
  //   { type: 'click', text } | { type: 'click', css }
  //   { type: 'type', text }
  //   { type: 'press', key }
  //   { type: 'screenshot', path }
  // 返回 { ok, error?, via: 'playwright' }
}
```

对应关系：

| 现在 Rust / 前端 | 协议层 |
|---|---|
| `bind_page(id)` | `pickPage(browser, { urlContains })` |
| `eval_all_frames` + `eval_score` | `pickFrame(page, hint)` |
| `Runtime.evaluate` 取 HTML | `read` → `frame.content()` |
| 短脚本 `{found,x,y}` | `locate` → `frame.evaluate` 或 `locator.boundingBox()` |
| `Input.dispatchMouseEvent` × 3 | `act({ type:'click', x, y })` → `page.mouse.click` |
| `Input.dispatchKeyEvent` | `page.keyboard.type` / `press` |
| `browser_cdp_snapshot` | 阶段 C 再接 AX；A 不做 |

解析器（`parse.js` / `catalog.js`）**不进**这个包。`read` 只交 HTML，调用方自己 `new Function` 或丢给已有测试。

---

## 4. 选页：不要 `pages()[0]`

CEF 里会有多个 target：浏览区、空白页、扩展页、有时还有应用自己的页。现有 Rust 是这样选的（`cef_browser.rs` 的 `bind_page`）：

1. 拿这个 tab 记住的 URL（`remembered_url(id)`）。
2. 在 `Target.getTargets` 里找 `type === "page"` 且 URL 包含那段（去掉 hash）。
3. 找不到再退到任意一个 `page`。
4. `attachToTarget` 之后才 evaluate。

阶段 A 没有 tab `id`。脚本侧用同一思路，换成显式条件：

```js
export async function pickPage(browser, opts = {}) {
  const pages = browser.contexts().flatMap((c) => c.pages())
  const want = String(opts.urlContains || '').split('#')[0]
  const titleWant = String(opts.titleContains || '')

  const listed = pages.map((p) => ({ url: p.url(), title: /* 可先空 */ }))
  if (!pages.length) {
    throw new Error('9333 上没有 page。先开 tauri:dev，并打开一个浏览区。')
  }

  let page = null
  if (want) {
    page = pages.find((p) => p.url().includes(want))
  }
  if (!page && titleWant) {
    // title() 要 await；没有 want 时才扫
  }
  if (!page) {
    page = pages.find((p) => /chaoxing|mooc1|mooc2|passport2/.test(p.url()))
  }
  if (!page) {
    throw new Error(
      `对不上浏览区。当前 pages:\n${pages.map((p) => p.url()).join('\n')}\n` +
        '请传 --url-contains，不要默默用第一页。'
    )
  }
  return page
}
```

规则：

- **默认不准静默拿 `pages()[0]`。** 对不上就列出 URL 然后失败。
- CLI 提供 `--url-contains`。开发时对着学习通可以默认匹配 `chaoxing|mooc1|passport2`。
- 阶段 B 若前端要调协议层：Rust 把当前 tab 的 CDP `targetId` 或 URL 暴露出来，脚本按这个对齐。不要在 Playwright 里发明第二套 tab id。

连上：

```js
import { chromium } from 'playwright'

const port = Number(process.env.ZERROR_CDP_PORT || 9333)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
```

连不上的报错写清楚：「应用没开 / CEF 没起来 / 端口不是 9333」，不要报 Playwright 内部栈。

探测可以先 `GET http://127.0.0.1:9333/json/version`（现有 `cdp_client.rs` 就是这么找 `webSocketDebuggerUrl` 的）。Playwright 自己也会做这件事。

---

## 5. 选帧：把 `eval_score` 搬过来

学习通的目录、作业、播放器都不在顶层。现有分数在 `cef_browser.rs` 的 `eval_score`，协议层用同一套权重，不要另发明：

| 信号 | 权重 | 典型 hint |
|---|---|---|
| `questionLi` | ×10 | homework |
| `catalogLi` | ×8 | catalog |
| `hasVideo && duration > 1` | +15 | video |
| `found` + 有 `x,y` | +8 / +20 | locate |
| `jobs` / `unfinished` | ×3 | catalog |
| `works` | ×5 | homework 列表 |

`frames.mjs` 对 `page.frames()` 每帧跑**同一段短脚本**（只读当前 `document`，禁止 `contentWindow`）：

```js
function probe() {
  return {
    questionLi: document.querySelectorAll('.questionLi, li.questionLi').length,
    workLi: document.querySelectorAll('.workLi').length,
    catalogLi: document.querySelectorAll('.catalog_s,.chapter_item,.ncells').length,
    hasVideo: Boolean(document.querySelector('video')),
    duration: document.querySelector('video')?.duration || 0,
    jobs: [],
    unfinished: [],
    url: location.href,
  }
}
```

`pickFrame(page, 'homework')` = 只在 `questionLi` 最高的帧里干活；`'catalog'` 看 `catalogLi`；`'video'` 看视频；`'page'` 强制主 frame；`'any'` 取总分最高。

对不上就 `{ found: false }`，不要退回主 frame 乱点。

阶段 A 的 `screenshot` 可以先截**整页**（证明是同一窗口）。`read` / 作业 HTML 必须带 hint，否则会读到外壳页。

---

## 6. locate / act 怎么写

和现在 `cdp_click` / `cdp_click_box` 同一分工：

1. **定位**在目标 frame 里跑短脚本，或用 `frame.getByText` / `frame.locator` 拿 `boundingBox()`。
2. **点击**用 `page.mouse.click(x, y)`。坐标是相对视口的，和现在 CDP 的 `x,y` 一致。
3. 找不到就 `{ ok: false, error: '没有找到…' }`。禁止 `el.click()` 当成功，禁止 `__ZE_CLICKED__`，禁止点完再 `goto` 拼 `studentstudy`。

`locate({ script })` 兼容现有作业定位脚本：脚本返回 `{found,x,y}`。这是迁 `browser_cdp_click_box` 时的对接面，阶段 A 可以先不做 script，只做 text / css / screenshot。

虚拟鼠标：阶段 A 不管。应用内那层画点可以继续挂在 Rust 点击上。

---

## 7. CLI（阶段 A 的验收入口）

```bash
# 应用必须已经 tauri:dev，浏览区开着学习通
npm run cef:pw -- list
npm run cef:pw -- title --url-contains mooc1
npm run cef:pw -- screenshot --out /tmp/cef-cdp.png --url-contains mooc1
```

`list` 打印每个 context 的每个 page 的 URL。  
`title` 打印选中页的 `title` + `url`。  
`screenshot` 写文件。

过关标准（抄 [browser-protocol.md](./browser-protocol.md) §11）：

- 截出来的就是窗口里正在看的学习通，不是空白 Chromium，也不是应用壳页。
- `list` 能看见真实课程 URL。
- 连不上时退出码非 0，中文说明原因。

下一小步（仍算 A，可同一 PR 或紧随）：

```bash
npm run cef:pw -- click-text 作业 --url-contains chaoxing
```

用户能看见应用里的虚拟鼠标或页签切到作业。失败就失败，不要回退到 `scripts/browser-bridge.mjs` 那条前端桥。

`browser-bridge.mjs` 继续留给「走应用 Agent 桥」的调试。协议层**不要**再包一层 HTTP 去调它。两条入口：要么 CDP/Playwright 直连 CEF，要么走应用工具。不要桥上叠桥。

---

## 8. 第一笔 PR 只做这些

可以合并、可以回滚。清单：

- [ ] `scripts/cef-pw/` 独立 `package.json` + `npm install`
- [ ] `connect.mjs`：`connectOverCDP`，失败信息可读
- [ ] `page.mjs`：`listPages` + `pickPage`（禁止默默 `[0]`）
- [ ] `cli.mjs`：`list` / `title` / `screenshot`
- [ ] `scripts/cef-pw/README.md`：先开应用再跑、禁止 `launch`
- [ ] 根目录加 `"cef:pw"` 脚本
- [ ] **不改** `src/`、`src-tauri/`、Agent 工具表
- [ ] **不加** Playwright 到应用依赖

本机验证（开发者做，不写进 CI 也行）：

1. `npm run tauri:dev`
2. 浏览区打开已登录的学习通
3. `npm run cef:pw -- screenshot --out /tmp/cef-cdp.png`
4. 打开 png，对一下窗口

版本风险：连上后 click / screenshot / `page.frames()` 能用即可。某个 Playwright 新 API 报错就换旧写法，不要升级 CEF 去迁就库。

---

## 9. 阶段 B 才做的事（现在不要做）

应用内动作要走 Playwright，必须先解决「Playwright 在 Node，前端在 WebView」：

| 方案 | 何时做 |
|---|---|
| 继续 Rust CDP（现状） | 现在 |
| `scripts/cef-pw` 给人和写代码的 AI | 阶段 A（本文件） |
| 本机 sidecar：前端 HTTP 调 `127.0.0.1:某个口`，sidecar 内部是同一套 `driver.mjs` | 阶段 B，且 A 已稳定、收益清楚 |
| 把 Playwright 打进正式包 | 不做 |

若做 sidecar，HTTP 面仍然只有 `read` / `locate` / `act`，加上 `tabUrl` 或 `targetId`。不要做成 Playwright MCP 那 20 个工具给应用内 Agent。

前端迁的第一刀应是 `clickHomeworkBox` / `click_text` 这种「已有坐标或文案」的路径：locate 仍可用短脚本，click 改 `mouse.click`。迁一条，对应的 `invoke('browser_cdp_*')` 删一条。禁止 `browser_cdp_v2_*` 双活。

---

## 10. 给写代码的 AI 怎么用

阶段 A 完成后，在 Cursor / Codex 的项目说明里写：

```text
应用已开（tauri:dev）时：
  node scripts/cef-pw/src/cli.mjs screenshot --out /tmp/cef.png
  或在脚本里 chromium.connectOverCDP('http://127.0.0.1:9333')
禁止 chromium.launch()
禁止打开 visit/courses、禁止拼 studentstudy?chapterId=、禁止改 iframe src
选页必须带 URL 条件或走 pickPage()
```

需要 MCP 时：`@playwright/mcp` 的 CDP endpoint 指到 `http://127.0.0.1:9333`，不要让 MCP 自己 launch Chrome。

作业作答页的产品规则不变：应用内 Agent 仍然不能用通用 `click` / `eval` 碰题面。写代码的 AI 连 9333 是开发调试，不是给学生 Agent 开后门。

---

## 11. 明确不要做

- 不要在 `src/services/browser/` 里 import `playwright`。
- 不要为了协议层再写一套 `fetch(studentcourse)` / 拼章节 URL。
- 不要让 CLI 失败时自动改走 `browser-bridge.mjs` 或注入 `__ZE_CLICKED__`。
- 不要把 `parse.js` 拷进 `scripts/cef-pw` 再 evaluate 进页面。
- 不要在正式包默认把 9333 暴露到非 localhost。
- 不要一次把 `cdp_client.rs` 删掉。A 过了再说 B，B 的一条路径稳了再删对应 Input。

---

## 12. 一句话

**先在 `scripts/cef-pw` 用 Playwright 连上现有 CEF，做出 list / title / screenshot；应用运行时仍用现在的 CDP。**  
协议层就是 `connect` + `pickPage` + `pickFrame` + `read/locate/act`，不是再造一套 Tauri 命令。
