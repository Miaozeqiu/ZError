---
name: chaoxing-study
description: >-
  Plays unfinished 学习通 (Chaoxing) chapter tasks in the in-app browser:
  open a course, find 未完成 jobs, click the native video player, wait for
  the task point, then advance. Use when the user asks to 自动播放, 刷未完成,
  播章节, 看完这节, or finish Chaoxing chapter tasks.
---

# 学习通章节自动播放

给浏览器 Agent 用。流程对齐 **ocsjs `study()` + `JobRunner`**：按章节 `attachments` 任务点顺序走，不要伪造进度。

## 怎么进播放页

1. 未登录先按 `chaoxing-login`。
2. 课表进课 → 点「章节」→ `get_state` 看未完成 → 点干净节名进 `studentstudy`。
3. 进到课程壳还不算完成，必须点到具体节并开始播放。

## 任务点循环（对齐 ocs）

同一节里可能有多个任务点（`attachments`：`insertvideo` / `work` / `insertdoc`…）。ocs 是在 **当前 iframe** 里播完一个再找下一个，**不会**每次都点回第一个视频。

1. **视频**：`看快照 ref` → 交给监控；播完系统会叫醒你，用 `videoIndex` / `label` 再 play。不要指望自动点开下一段。
2. **要切到本节第 N 个视频**：`看快照 ref` 带 `videoIndex: N`（从 1 起）或 `label` / `mid`，不要反复裸调 play。同一节里经常没有「视频1/视频2」页签，而是 `knowledge/cards` 里叠着的 `.ans-attach-ct.videoContainer`；切失败就读 `logs/agent-chat/cx-study-live.md` 的 Locate，不要当成已经切过去。
3. **章节测验（work / `.TiMu`）**：监控自动跑 ocs 式流程：本地题库 `/query` 搜题 → fill → 未命中 `guess` → 暂存 → 继续下一任务点。失败再 `看快照 ref`。
4. **文档/PPT**：系统会跳过或快速过；不要停在资料节。
5. 本节任务点做完 → `看快照 ref` 只打开下一节，再自己 `play` 指定视频。

## 播一节

1. 播放页直接 `看快照 ref`，不要自己扒 iframe。
2. 播起来后 `browser_wait` 等面板事件。卡住/验证码/测验/本节清完会立刻返回；不要 `chapters` 查进度。
3. 暂停/播放器丢了：再 `看快照 ref`（会留在当前任务点）；不要点「视频」标签指望跳到第一个。
4. 只有任务点 n/n 且没有未完成节才算做完。

## 不要做

- 不要调进度上报接口、seek 结尾、超高倍速混过检测
- 不要把「打开了下一节」说成「这节已经完成」
- 不要在切到视频 2/3 后又点回第一个未完成视频
