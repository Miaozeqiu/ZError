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
2. 课表进课 → 点「章节」→ `browser_chaoxing_chapters` 看未完成 → 点干净节名进 `studentstudy`。
3. 进到课程壳还不算完成，必须点到具体节并开始播放。

## 任务点循环（对齐 ocs）

同一节里可能有多个任务点（`attachments`：`insertvideo` / `work` / `insertdoc`…）：

1. **视频**：`browser_chaoxing_play` → 交给监控；播完系统自动切下一任务点。
2. **章节测验（work / `.TiMu`）**：监控自动跑 ocs 式流程：本地题库 `/query` 搜题 → fill → 未命中 `guess` → 暂存 → 继续下一任务点。一般不用你动手；失败再 `browser_chaoxing_homework`。
3. **文档/PPT**：系统会跳过或快速过；不要停在资料节。
4. 本节任务点做完 → 下一节。

## 播一节

1. 播放页直接 `browser_chaoxing_play`，不要自己扒 iframe。
2. 不要 `browser_wait` 空等。卡住/验证码才叫你；测验尽量自动处理。
3. 暂停/播放器丢了：`browser_chaoxing_play` 或回目录点节名再 play。
4. 只有任务点 n/n 且没有未完成节才算做完。

## 不要做

- 不要调进度上报接口、seek 结尾、超高倍速混过检测
- 不要把「打开了下一节」说成「这节已经完成」
