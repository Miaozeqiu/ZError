# 应用内协议：类 Playwright，不是 Playwright

给改浏览区驱动的人。产品总纲见 [browser-protocol.md](./browser-protocol.md)。

上一篇 [playwright-layer.md](./playwright-layer.md) 写的是**开发机脚本**（Cursor 连 9333）。**不是**应用内协议。应用内不要 Node，不要 `playwright` 这个 npm 包，不要 sidecar。

---

## 0. 问的是哪一层

应用内 Agent 和刷课/作业代码要的是：

```
browser_homework / browser_study_* / click_text
        ↓
read / locate / act          ← 这一层，类 Playwright
        ↓
Rust CDP（已有 cdp_client.rs）
        ↓
CEF :9333
```

「类 Playwright」指的是**分工和 API 形状**，不是把 Playwright 嵌进 Tauri：

| Playwright 里 | 应用内对应 |
|---|---|
| `page.content()` / 快照 | `read(id, hint)` |
| `locator` / `boundingBox` | `locate(id, query)` → `{found,x,y}` |
| `mouse.click` / `keyboard.type` | `act(id, click \| type \| press)` |
| `page.frames()` + 自己挑帧 | 已有 `eval_all_frames` + `eval_score` |

底下发的仍是 `Runtime.evaluate` 和 `Input.dispatchMouseEvent`。Playwright 连上 CEF 之后干的也是这些。差的是我们命令散、调用方直接 `invoke('browser_cdp_*')`。

正式包装的是 Rust，没有 Node runtime。

---

## 1. 目标 API（前端唯一入口）

新建一个模块，作业、刷课、通用点击都只进这里。业务代码不再 `invoke('browser_cdp_click_box')`。

文件：`src/services/browser/protocol.ts`

```ts
export type FrameHint = 'page' | 'homework' | 'catalog' | 'video' | 'any'

export type LocateQuery =
  | { by: 'text'; value: string }
  | { by: 'css'; value: string }

export type Act =
  | { op: 'click'; at: LocateQuery }
  | { op: 'click'; x: number; y: number }
  | { op: 'type'; text: string; at?: LocateQuery }  // 有 at 先点再键入
  | { op: 'press'; key: string }
  | { op: 'scroll'; amount: number }
  | { op: 'hover'; at: LocateQuery }

export function read(id: string, hint: FrameHint): Promise<{
  ok: boolean
  url?: string
  title?: string
  html?: string
  json?: unknown          // 短脚本结构化结果（题数、currentTime）
  error?: string
}>

export function locate(id: string, query: LocateQuery, hint?: FrameHint): Promise<{
  found: boolean
  x?: number
  y?: number
  text?: string
  error?: string
}>

export function act(id: string, action: Act): Promise<{
  ok: boolean
  error?: string
  filled?: boolean
  text?: string
}>
```

调用方对照：

| 现在 | 改成 |
|---|---|
| `evalBrowserView(id, READ_PAGE_DOM())` | `read(id, 'homework' \| 'catalog')`，再本地 `parse.js` |
| `evalBrowserView(id, LOCATE_HW_PICK)` + `clickHomeworkBox` | `evaluate(id, locateScript)` → `act(id, { op:'click', x, y })` |
| `invoke('browser_cdp_click_text', { text:'作业' })` | `act(id, { op:'click', at:{ by:'text', value:'作业' } })` |
| `invoke('browser_cdp_fill_box', { script, text })` | `evaluate` 拿盒子 → `act(id, { op:'click', x, y })` → `act(id, { op:'type', text })` |
| `READ_VIDEO_TICK` | `read(id, 'video')` 带短脚本，或 `read` 返回 html 后本地读 |

`hint` 传给 Rust，沿用现在的 `eval_score`（`questionLi` / `catalogLi` / 视频时长）。对不上就 `found: false`，不要退回主 frame 乱点。

Agent **看不到**这个模块。模型仍然只碰 `browser_homework`、`browser_study_*`。作业作答页继续挡通用 `click` / `eval`。

---

## 1.1 Agent 要的其实是站点解析器

产品上「解析器」是一件事：读出题目，并且按同一套实体去点，不用每次 `get_page` 找元素。详见 [site-parser.md](./site-parser.md)。

```
Agent：browser_homework fill  { index: 3, answer: "A" }
        ↓
站点包 helpers.js：第 3 题的 A（parse 和 locate 共用）
        ↓
locate(handle) → {x,y} 或 invoke(addChoice)    act → Rust Input
```

刷课同理：`browser_study_play` / `next`，Agent 不点播放键坐标。认节 / 任务点在 `parsers/study/helpers.js`，`locate.js` 出坐标，`cdpScripts.ts` 只做薄封装。新站走 `site-learn/sites/<host>/parsers/<role>/`。

| 名称 | 文件 | 职责 |
|---|---|---|
| 认实体 | `parsers/*/helpers.js` | 题盒 / 节 / 按钮。读和做共用 |
| 解析 | `parse.js` | HTML → 题卡。不点、不发 CDP |
| 绑定 | `locate.js` | Handle → 短脚本（坐标或页内 API） |
| 驱动 | `protocol.ts` + Rust CDP | `read` / `locate` / `act` |

Agent 看见的是适配器工具（`fill` / `play`）。模型不写 locate 脚本。`parse.js` 仍然只吃 HTML。

---

## 2. 底下怎么接（不换内核）

`protocol.ts` 第一版是薄封装，**复用现有 Tauri 命令**，不新开 `browser_cdp_v2_*`：

```
read     → browser_eval（eval_all_frames 已按分数挑帧）
locate   → text/css 走引擎 probe（CDP find）
act.click → text/css 走引擎；坐标走 browser_cdp_click_at
act.type → 有 at 走引擎 fill；无 at 走 browser_cdp_type_focused
站点 locate 脚本走 evaluate，再 act({ op:'click', x, y })
act.press / scroll / hover → 现有同名命令
```

Rust 里已经具备 Playwright 内核在做的事：

- `bind_page(id)`：tab URL ↔ CDP target
- `eval_all_frames` + `eval_score`：挑 iframe
- `cdp_click` / `cdp_click_box`：`Input` 真鼠标
- `cdp_fill_box` / `cdp_type_focused`：先点再键入

不要为了「像 Playwright」再写一套 WebSocket。`cdp_client.rs` 留下，当 Input/evaluate 的发送器。

可选后续（不是第一笔）：把十几个 `browser_cdp_*` **收成一条** `browser_protocol { id, op, hint, query, action }`，前端只 `invoke` 一次。收口之后再删旧命令。禁止新旧长期双活。

不要引入 `chromiumoxide`，除非有人真的要重写 `cdp_client`。那是内部清理，不改变协议形状，也帮不了「模型会写 Playwright」。

---

## 3. 第一笔改什么

只做收口，行为不变。可以回滚。

1. 加 `src/services/browser/protocol.ts`（上面三个函数）。
2. 先迁两条最短路径，证明调用方不再直接碰 CDP 命令名：
   - `src/services/chaoxing/homework/act.ts` → `evaluate` + `act({ op:'click', x, y })`
   - `clickBrowserText` / `appBrowser.ts` 里的 `click_text` → `act({ op:'click', at:{ by:'text' } })`
3. `read` 先包 `evalBrowserView` + `READ_PAGE_DOM`，作业 `inspect.ts` 改走 `read(id, 'homework')`。
4. **不改** Agent 工具表、不改 CEF、不装 Playwright、不加 Node sidecar。
5. 失败就 `ok: false`，不回退 `__ZE_CLICKED__` / `el.click()` / 拼 `studentstudy`。

迁一条，删该文件里的 `invoke('browser_cdp_*')`。其它文件下一笔再迁。

验收：点「作业」页签、点一道选项、填一个空，和现在一样；题卡仍本地 `parse.js`。

---

## 4. 和「开发机 Playwright」怎么分工

| | 应用内（本文） | 开发脚本（playwright-layer.md） |
|---|---|---|
| 谁用 | 正式包、应用内 Agent 背后的 TS | 本机 Cursor / 回归脚本 |
| 实现 | `protocol.ts` + Rust CDP | `scripts/cef-pw` + `connectOverCDP` |
| 要不要 Node | 不要 | 开发机本来就有 |
| 打进安装包 | 只有 Rust + 前端 | 不打进去 |

两条都连同一块 CEF。应用内不嵌入 Playwright；写代码的 AI 若要对着真页面点，用开发脚本连 9333，不要让应用内 Agent 现场写 Playwright。

---

## 5. 明确不要做

- 不要把 `playwright` 写进根目录依赖，也不要在 `src/` 里 `import { chromium }`。
- 不要为了应用内协议打包 Node / sidecar。
- 不要再加一排 `browser_cdp_*` 命令；要加就加 `read/locate/act` 这一面。
- 不要把 `parse.js` / `catalog.js` 灌进页面；`read` 取 HTML，解析留在应用里。
- 不要让 Agent 直接调 `protocol.ts`。那是内部驱动。

---

## 6. 推送（进度 / 题卡 / 元素等待）

进度读数是**唯一保留的页内 JS**，而且是推不是拉：

1. `bind_page` 给 page session 装 `Runtime.addBinding('__zeTick')`，并注入 `ZE_TICK_HOOK`（`src-tauri/src/cef_push.rs`）。
2. 页内 video 事件 / 作业点选调用 `__zeTick` → CDP `Runtime.bindingCalled` → Rust 写 `last_tick` 缓存并 `app.emit('app-browser-tick', { id, kind, tick })`。
3. 前端 `src/services/browser/pushEvents.ts` 听该事件，按 browser id 分发给 `watch.ts` / `live.ts`。
4. `readChaoxingVideoTick` 先 `invoke('browser_push_last')`；`ageMs <= 4000` 且 mid 对得上才用缓存，否则才 `evaluate` 廉价 tick。

元素等待不再由前端 120ms 轮询 `browser_cdp_find`：

- 主路径一次 `invoke('browser_cdp_find_wait', { id, locator, timeoutMs })`。
- Rust 先 find；未命中则等 `Page.frameStoppedLoading` / `Page.frameNavigated` / `Network.loadingFinished` / `DOM.documentUpdated` / `Accessibility.nodesUpdated`（防抖 60ms）再 find，另加 250ms 稀疏兜底。
- 命令不存在（非 macOS / 旧内核）时，`act.ts` 降级 `actByPolling`。

不要用 Media 域，不要订阅全量 DOM 变更。跨源 OOPIF 这次不覆盖，钩子够不到的仍退回 evaluate。

DOM 定位（`src-tauri/src/cef/locate.rs`）的几条硬约束，踩过一次都别再踩：

- `DOM.getDocument` 会作废该 target 之前所有 nodeId。一次定位只调一次；定位与整帧读 HTML（`dom_html`）按浏览器 id 串行（`cef::dom_lock`），否则元素明明在页上却 `not_found`。
- 同进程 iframe 不是独立 target。学习通播放器在 main → `knowledge/cards` → `ananas/modules/video` 里，`Target.getTargets` 看不见；定位器从父文档 `iframe` 节点 `describeNode` 拿 `contentDocument` 再 pierce 进去。`frame` 提示按 iframe 的 id / name / mid / data-mid / src 匹配，站点侧给提示（如 `ananas/modules/video`）就不必把二十多个帧都查一遍。
- 「被挡」判断：命中节点的盒子完全落在目标盒子里（自己的文字 span / 图标）不算挡；目标是文字节点时被父元素包住也不算挡。只有伸出目标盒子的才是遮罩。
- css 多命中按文档顺序取第一个（同 `querySelector`）；文案完全相同的多个可点节点取 AX 顺序第一个，文案不同才报 `ambiguous`。
- `Input.dispatchMouseEvent` 的 `mouseReleased` 回执在点击触发同步跳转时常不来；事件已送达，超时不算失败。

---

## 7. 验收指标

播放页稳态 `Runtime.evaluate` **0 次/秒**，作业页 **0 次/秒**。`find_wait` 触发时全方法合计 ≤ **7 次/秒**。看 `/live` 或 `cx-study-live.md` 的 `cdp: evaluate x/s find y/s total z`。

---

## 8. 一句话

**应用内协议 = 前端三个函数 + 现有 Rust CDP，形状学 Playwright，运行时没有 Node。**  
开发机上的 Playwright 是另一条线，给人和写代码的 AI，不进用户包。
