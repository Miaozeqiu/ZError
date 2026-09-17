# 作业导出契约

题号一律从 1 起。读题是 CDP 取 HTML + 本地跑 `helpers.js` + `parse.js`，不要把解析器注入页面。认盒/选项只在 `helpers.js`。点选走 `locate.js` 的 Handle（`option` / `blank` / `control`）。

仍会注入的只有视觉截图：

| 键 | 入参 | 成功时 |
|---|---|---|
| `capture` | `(index)` 题号从 1 起 | `{ ok, ready?, pending?, index }` |

点选 / 填空 / 暂存 / 提交：短定位脚本 + 页内 `noSubmit` / `btnBlueSubmit`，不在本目录导出。解析器导出 `canSave` / `canSubmit`。
