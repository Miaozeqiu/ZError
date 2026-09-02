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
2. 课表进课 → 点「章节」→ `browser_study_chapters` 看未完成 → 点干净节名进 `studentstudy`。
3. 进到课程壳还不算完成，必须点到具体节并开始播放。

## 任务点循环（对齐 ocs）

同一节里可能有多个任务点（`attachments`：`insertvideo` / `work` / `insertdoc`…）。ocs 是在 **当前 iframe** 里播完一个再找下一个，**不会**每次都点回第一个视频。

1. **视频**：`browser_study_play` → 交给监控；播完系统 `browser_study_next` 切**下一个**任务点（不是第一个）。
2. **要切到本节第 N 个视频**：`browser_study_play` 带 `videoIndex: N`（从 1 起），不要反复裸调 play。
3. **章节测验（work / `.TiMu`）**：监控自动跑 ocs 式流程：本地题库 `/query` 搜题 → fill → 未命中 `guess` → 暂存 → 继续下一任务点。失败再 `browser_homework`。
4. **文档/PPT**：系统会跳过或快速过；不要停在资料节。
5. 本节任务点做完 → 下一节。

## 播一节

1. 播放页直接 `browser_study_play`，不要自己扒 iframe。
2. 不要 `browser_wait` 空等。卡住/验证码才叫你；测验尽量自动处理。
3. 暂停/播放器丢了：再 `browser_study_play`（会留在当前任务点）；不要点「视频」标签指望跳到第一个。
4. 只有任务点 n/n 且没有未完成节才算做完。

## 不要做

- 不要调进度上报接口、seek 结尾、超高倍速混过检测
- 不要把「打开了下一节」说成「这节已经完成」
- 不要在切到视频 2/3 后又点回第一个未完成视频
