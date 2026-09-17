# 刷课导出契约

目录、切章、切任务点、播放都不注入页面。

- 认节 / 任务点 / 播放器：只改 `helpers.js`
- 读目录：CDP 取 HTML，本地跑 `helpers.js` + `catalog.js` 的 `__zeScanOne`
- 切章 / 任务点 / 播放：`locate.js` 的 Handle（`chapter` / `step` / `play` / `video-tab` / `chapter-tab` / `next`）
- 目录还没出来：点「章节」再等，不要另发 studentcourse 请求

本目录不再导出注入键。 `frames.js` 只给旧覆盖目录兜底，不要和新 `helpers.js` 一起拼。

宿主侧接口：`studyControlApi()`（`collectSteps` / `collectAllSteps` / `locate` / `__zeScanOne`）。
调试快照：开发模式写入 `logs/agent-chat/cx-study-live.md`。
