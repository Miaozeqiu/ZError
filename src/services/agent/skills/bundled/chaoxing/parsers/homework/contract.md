# 作业导出契约

导出键名不要改。题号一律从 1 起。`page()` 按引用自动注入 helpers。入参由 `homeworkScript(key, ...args)` 传入。

运行时拼题卡走 `snaps` + `stash` + `live`，不要把 `inspect` 当主路径。`inspect` 是一次读页的压缩快照，给调试或轻量查看。

## 动作

| 键 | 入参 | 成功时 |
|---|---|---|
| `clickTab` | 无 | `{ ok, via }` |
| `inspect` | 无 | `{ ok, page, title, url, works, pending, pendingCount, questions, questionCount, filledCount, hint }`。`page`：`list` / `do` / `view` |
| `fill` | `(answers)` 数组或 JSON 字符串 | `{ ok, filled, missed, filledCount }` |
| `submit` | 无 | `{ ok, via }` |
| `picked` | `(index)` 题号从 1 起 | `{ picked, found }` |
| `pickInFrames` | `(index, letter)` 题号从 1 起 | 在 iframe 里点选项 |
| `capture` | `(index)` 题号从 1 起 | `{ ok, ready?, pending?, index }`（`index` 也是从 1 起） |

`answers` 项：`{ id?, index?, type?, answer / letters / text }`，`index` 从 1 起。题面只走 `browser_homework` 题卡。

## 读页（运行时拼题卡）

| 键 | 入参 | 成功时 |
|---|---|---|
| `snaps` | 无 | `{ url, title, text, extras, asked }` |
| `live` | 无 | `{ url, title, asked, extras, extraQs, counts, rows, text }` |
| `liveHook` | 无 | `{ ok, already, dirty, hooked, frames? }` |
| `dirty` | 无 | `{ n, hooked }` |
| `fillState` | 无 | 当前各题已选字母 |

## 内部传图

eval 回传体积有限时，把图元切块拉出。`startImg` 的 `index` 是图槽（从 0 起），不是题号。

| 键 | 入参 | 成功时 |
|---|---|---|
| `stash` | 无 | `{ questions, images }`，图元写到 `window.__ZE_HW_IMGELS__` |
| `startImg` | `(index)` 图槽从 0 起 | `{ wait, n }` |
| `imgMeta` | 无 | `{ wait, key, n }` |
| `imgChunk` | 无 | `{ wait, c, d }` |

## 调试

| 键 | 入参 | 成功时 |
|---|---|---|
| `debugBox` | `(index)` 题号从 1 起 | 第 N 题原始结构 |
