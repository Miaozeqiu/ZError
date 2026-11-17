# 应用内浏览器：协议怎么收

给后续改 CEF / CDP / Agent 工具的人看。结论先行，再写为什么和怎么迁。

---

## 1. 结论

**窗口继续用现在的 CEF，协议层换成 Playwright 连这个 CEF，不要再发明一套 ZError CDP。**

- 用户看见的、已登录的，还是应用里那一块浏览区（macOS 强制 CEF，调试口默认 `127.0.0.1:9333`）。
- 点、填、读、截图，内部改走 Playwright 的 `connectOverCDP`，不再手拼 `Input.dispatchMouseEvent`。
- 应用内 Agent 仍然只看到少而稳的业务工具（题卡、刷课），不让它现场写 Playwright 乱点作业页。
- Cursor / Codex 要对着**同一页**写脚本，也连 9333，用它们已经会的 Playwright API。

「不加协议」指的是：别再叠自家的第二条路（fetch 目录、拼 URL 跳、WK 回退、注入整包解析器）。  
换 Playwright **不是**加协议，是把已经在用的 CDP **换成大家都认识的那一层**。

不要整段换成 Playwright 自己拉起来的 Chromium 窗口。登录态、内嵌、虚拟鼠标、和 Tauri 窗口绑定都会丢。

---

## 2. 现在实际是怎么封装的

三层，和 Playwright 同一思路，但是自研、而且路上叠过补丁。

```
应用内 Agent 工具（browser_* / browser_homework / browser_study_*）
        ↓
前端 TS（appBrowser、作业 act、刷课 locate）
        ↓
Tauri 命令（browser_cdp_click / fill / snapshot / eval …）
        ↓
src-tauri/src/cdp_client.rs  →  WebSocket 连 9333
        ↓
CEF remote debugging（和用户看见的是同一个浏览器）
```

底层真正用到的 CDP：

| 方法 | 用途 |
|------|------|
| `Runtime.evaluate` | 读 HTML、短定位 `{found,x,y}`、读 `video.currentTime` |
| `Input.dispatchMouseEvent` | 真鼠标（按下 / 抬起），不是 `el.click()` |
| `Input.dispatchKeyEvent` | 按键、往焦点框打字 |
| `Accessibility.getFullAXTree` | `browser_get_page` 的 role / name / ref |
| `Page.navigate` / `Page.reload` | 打开、刷新 |
| `Target.getTargets` / `attachToTarget` | 进 iframe 的 session |

前端再包一层：`eval_all_frames` 按 `questionLi` / `catalogLi` / 视频时长挑帧，短脚本只看**当前 document**，动作走 Input。

这套能干活。弱点是：客户端是自写的薄封装，模型不会写；历史路径（注入解析器、`contentWindow` 穿越、拼 `studentstudy`）曾经和主路径并存。

解析器（`catalog.js` / `parse.js`）应继续当**本地纯函数**：CDP 取回 HTML，在应用里跑。不要再灌进学习通页面。

---

## 3. Codex 怎么做（对照）

Codex **不自研 CDP**。常见三条，由松到紧：

1. **Playwright MCP**（`@playwright/mcp`）  
   工具：`browser_navigate` / `snapshot` / `click` / `type`，可选截图。  
   快照是无障碍树 + `e3` 这种 ref，和我们现在的 `browser_get_page` 同一派，**不是**像素。
2. **Playwright CLI + SKILL**  
   微软更推给「写代码的 Agent」：不把整棵 AX 树塞进上下文，让模型写短命令或小脚本再跑。
3. **直接写 `*.spec.ts` 用 shell 跑**  
   模型训练数据里最多的就是这套 API。

它不把学习通知识写进协议。站点怎么走，放 Skill / 提示；协议只提供 page / locator / snapshot。

我们要抄的是这个分工，不是抄「再开一个无头浏览器」。

---

## 4. 目标形态

```
                    ┌─ 应用内 Agent：题卡 / 刷课 / 验证码（少工具）
用户看见的 CEF 窗口 ─┤
:9333 CDP           └─ Playwright connectOverCDP
                         ├─ 应用内部动作（替换 browser_cdp_*）
                         └─ 写代码的 AI / 本地脚本（标准 page/locator）
```

内核（CEF）负责：窗口、profile、cookie、和界面叠在一起。  
协议（Playwright）负责：点、填、选 frame、截图、AX 快照。  
站点知识（图谱、`parse.js`、题卡、`LOCATE_*`）负责：学习通怎么走，以及 **题卡动作怎么落到页面**（`fill A` → 第几题哪个选项）。不负责发鼠标事件。Agent 只调 `browser_homework` / `browser_study_*`，不自己找 DOM。细节见 [in-app-protocol.md](./in-app-protocol.md) §1.1。

### 4.1 两类调用方，不要合成一类

| | 应用内浏览器 Agent | 写代码的 AI（Cursor / Codex） |
|--|--|--|
| 目的 | 替用户刷课、答题 | 改产品、写回归、查 bug |
| 该看到的 | `browser_homework`、`browser_study_*`、登录点选 | Playwright API 或 MCP |
| 不该做的 | 现场写脚本点作业选项 | 另起一个没登录的 Chromium |
| 连谁 | 内部封装好的工具 | `http://127.0.0.1:9333` 上的**同一** CEF |

作业作答页继续禁止 Agent 用 `get_page` / `eval` / `click` 碰题面。题卡和网页双向同步。这个产品规则不因换库而取消。

### 4.2 内部目标 API（给前端 / Rust 调，不直接给模型）

**应用内协议怎么做**见 [in-app-protocol.md](./in-app-protocol.md)：三个 TS 函数 + 现有 Rust CDP，不嵌 Playwright、不打包 Node。

收成三件事就够，业务代码不要再 `invoke` 一堆 `browser_cdp_*`：

```ts
read(frameHint)      // HTML 或 AX 快照；frame 由 hint 或评分选出
locate(query)        // 文案 / CSS / 短脚本 → { frame, x, y } 或 locator
act(click | type | press | screenshot)
```

实现上对应 Playwright：

- `chromium.connectOverCDP('http://127.0.0.1:9333')`
- `browser.contexts()[0].pages()` 里找到当前浏览区那一页
- `page.frames()` 代替手写 `eval_all_frames`（仍可用评分挑作业/目录/视频帧）
- `mouse.click(x, y)` / `locator.click()` / `keyboard.type()`
- `page.screenshot()` 需要看公式图时再开，默认仍用结构化题卡

虚拟鼠标可以留：在 `mouse.click` 前后画一层，不参与命中计算。

---

## 5. 为什么不「整段换 Playwright 窗口」

Playwright 默认 `chromium.launch()` 会：

- 另起进程，用户在应用里看不到；
- 没有我们的 CEF profile（`app-browsers/chromium-profile-*`），学习通要重新登录；
- 管不到 Tauri 里的 bounds / 置顶 / 抽象层；
- 和现在「用户盯着它点」的产品不一致。

`connectOverCDP` 才是：Playwright 当司机，CEF 当车。

Rust 侧若只想少维护自写 WebSocket，可以用 `chromiumoxide` 替 `cdp_client.rs`。这能让 Rust 更干净，**帮不了「AI 写脚本」**——模型会的是 Playwright，不是 crate。优先 Playwright 连 CEF；Rust crate 是可选的内部实现细节。

---

## 6. 分阶段怎么做

每阶段单独可合并、可回滚。不要一次拆内核。

阶段 A 的文件、API、选页/选帧和第一笔 PR 清单见 [playwright-layer.md](./playwright-layer.md)。

### 阶段 A — 证明连得上（1 次实验）

应用 `tauri:dev` 起来后，在仓库外或 `scripts/` 里跑：

```ts
import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = browser.contexts()[0].pages()[0]
console.log(await page.title(), page.url())
await page.screenshot({ path: 'cef-cdp.png' })
```

过关：截到的就是用户正在看的学习通，不是空白 Chromium。

注意：CEF 与 Playwright 自带的 Chromium 版本差一截时，`connectOverCDP` 可能部分 API 不可用。以「能连上、能点、能截图」为准，不要假设所有 Playwright 新 API 都在。

### 阶段 B — 内部动作迁一层

先迁一条最稳的路径，例如 `browser_cdp_click_box` / `click_text`：

1. 短定位脚本仍可 evaluate（或改 `frame.locator`）。
2. 坐标点击改 `mouse.click`，不再手拼三个 `dispatchMouseEvent`。
3. 前端 `invoke('browser_cdp_*')` 逐步改成调同一个 TS（或 Rust 调 Playwright 不行，Playwright 是 Node；应用内更顺的是 **Tauri sidecar / 本进程 Node 不行**）。

实现位置要先拍板（见 §7）。拍板前不要铺开重写。

### 阶段 C — 读页

- `browser_get_page`：继续 AX 树（Playwright 的 accessibility snapshot 或现有 `Accessibility.getFullAXTree`）。
- 作业题面：继续 CDP HTML + 本地 `parse.js`。不要为了「AI 好看」把作业页重新交给 `get_page`。
- 公式：解析结果留给填空；面板只展示图（已做）。需要模型看图时用题盒截图或 `page.screenshot`，不要把 LaTeX 灌回面板。

### 阶段 D — 给写代码的 AI

文档和 Skill 写明：

```text
开发时应用已开 → chromium.connectOverCDP('http://127.0.0.1:9333')
禁止 chromium.launch() 去登录学习通
禁止 navigate 打开 studentcourse / knowledge/cards / visit/courses
```

需要的话再加一条 Cursor/Codex 的 Playwright MCP，**参数指向已有 CEF**（`--cdp-endpoint` 一类），不要让 MCP 再 launch 一个 Chrome。

### 阶段 E — 删死代码

主路径稳定后删：

- 手写 `cdp_client` 里与 Playwright 重复的 Input 封装（若已完全迁走）
- `SAME_ORIGIN_FRAMES` / `ENGINE_ACT_SCRIPT` / 页内 `__ZE_CLICKED__` 回退
- 前端 `isCefEngine()` 分支（产品已 CEF-only）
- 刷课 `index.js` 的空注入包；解析器只保留本地 `?raw`

Rust 里 `ZERROR_USE_WK` 应急可以留，前端不要再写第二套 WK 路径。

---

## 7. Playwright 跑在哪（必须先定）

应用是 Tauri + 前端 WebView，Playwright 是 Node。三种放法：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| A. 开发脚本 / CI only | 只在 `scripts/`、Agent 写测试时连 9333 | 立刻能用，不动发布包 | 运行时动作仍走自写 CDP |
| B. Sidecar | 随应用带一个 Node 小服务，前端 HTTP/stdio 调它 | 运行时也是 Playwright | 多一个进程、打包变重 |
| C. 继续 Rust 发 CDP，只把「脚本生态」留给 A | 内部保持 `cdp_client`，对外文档写 connectOverCDP | 发布包不变 | AI 改产品内部动作仍然要读我们的封装 |

应用内协议走方案 C 的变形：API 收成 `read/locate/act`（[in-app-protocol.md](./in-app-protocol.md)），发送器仍是 Rust CDP。  
方案 A 只给开发机脚本。方案 B（sidecar / 打包 Node）不做，除非以后单独拍板。用户刷课不需要 Node runtime。

应用内 Agent 的工具表也不要扩成 Playwright MCP 那 20 多个。Codex 用 MCP 是因为它没有「学习通题卡」；我们有，就该更瘦。

---

## 8. Agent 工具面（换库之后仍然成立）

保留：

- 浏览：`browser_get_state`、登录用的 `click_text` / `type`（非作业页）
- 刷课：`browser_study_chapters` / `play` / `watch` / `next`
- 作业：`browser_homework`（list / open / inspect / fill / guess / save / submit）
- 验证码：`browser_captcha`
- 结束：`browser_finish`（+ 必要的 todo）

作业作答页继续挡：`get_page` / `eval` / `click` / `type`。

能删或降权：

- 刷课时的 `get_page` / `eval`（Skill 已禁止，应用层应收口）
- 用 hint 中文当控制器（「立刻 play，禁止 get_page」）→ 改成明确状态机返回下一步枚举

站点知识继续放：`site-graph.json`、`parsers/homework/parse.js`、`parsers/study/catalog.js`。  
这些不是协议，换 Playwright 也不要重写进 page.evaluate 长脚本。

---

## 9. 明确不要做

- 不要 `chromium.launch()` 当应用浏览区。
- 不要为了进目录再 `fetch(studentcourse)`；iframe 在就读 DOM，不在就点「章节」再等。
- 不要拼 `studentstudy?chapterId=` 顶层跳，目录在就点节。
- 不要改 iframe `src`、不要顶层打开 `visit/courses`。
- 不要把作业题面交给 Agent 的 `browser_eval`。
- 不要再加 `browser_cdp_v2_*` 和旧命令长期双活。迁一条删一条。
- 不要让应用内 Agent「自己写一段 Playwright 再 eval」。那是写代码的 AI 的事，且必须连 9333 上的**当前**页。

---

## 10. 风险

- **CDP 版本**：CEF Chrome 131 量级（见 `cef_runtime.rs` 的 UA），Playwright 新版本按更新的 Chromium 测。连上后先做 click / screenshot / frames，再谈高级 API。
- **多 page**：一个 CEF 里可能有多个 target。必须按当前选中的浏览区 `id` 对齐 page，不能 `pages()[0]` 蒙。
- **iframe**：学习通目录 / 作业 / 播放器不在顶层。Playwright `page.frames()` 能列，仍要用「题卡 / 目录 / 视频」规则挑，不能默认主 frame。
- **安全**：9333 只绑 localhost。文档可以写给开发者，不要做成公网调试口，也不要在正式包默认开给任意脚本。
- **虚拟鼠标**：只是可视化，命中以 Playwright/CDP 坐标为准。

---

## 11. 验收

阶段 A 过：对本机已打开的学习通截图，和窗口里看到的是同一页。

阶段 B 过：点「章节」或点一道作业选项，走 Playwright 鼠标，不再走手写 `dispatchMouseEvent`；失败就报失败，不回退 `__ZE_CLICKED__`。

阶段 D 过：Cursor 里一段 10 行 `connectOverCDP` 能点到应用里的「作业」页签，且没有另起浏览器。

全程：不假 `ok: true`；不打开 `visit/courses`；不改 iframe `src`。

---

## 12. 一句话

**车是 CEF，司机换成 Playwright，站点地图还是我们的图谱和解析器。**  
应用内 Agent 继续坐题卡和刷课工具；写代码的 AI 请连 `127.0.0.1:9333`，不要再为它造一套协议。
