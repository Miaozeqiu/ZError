---
name: chaoxing
description: >-
  学习通（Chaoxing）统一 Skill：登录、自动刷章节/视频、完成作业与章节测验。
  Use when the user asks to 登录学习通, 刷课, 播章节, 写作业, 答题, or finish Chaoxing tasks.
---

# 学习通

统一 Skill，按当前任务选用下面小节：

- **登录**：未登录或要在空间/课表操作时用 → `references/login.md`
- **刷课 / 章节任务**：播视频、刷未完成、等任务点 → `references/study.md`
- **作业 / 章节测验**：课程作业页或章节里的测验任务点 → `references/homework.md`

执行前 `read_agent_skill(chaoxing)`；附属文件用 `read_agent_skill_file`。

专用工具：`browser_study_chapters` / `play` / `watch` / `next` / `homework` / `captcha`。登录还用通用 `browser_navigate`、`get_state`、`type`、`click_text`、`todo`、`finish`。

## 登录

- 登录页 `https://passport2.chaoxing.com`；`browser_type selector=#phone` / `#pwd`，`browser_click selector=#loginBtn`
- 优先用【已记账号】；滑块/图形验证停手 `browser_finish(blocked)`
- 课表 iframe `#frame_content` 或顶层 `https://mooc1-1.chaoxing.com/visit/interaction`
- 不要打开 `studentcourse` / `knowledge/cards` / `ananas` 等 iframe 地址

## 刷课 / 章节任务

- 先进课程 `mycourse/stu`，点「章节」，等「已完成任务点 x/y」
- `browser_study_chapters` 看未完成节名 → `browser_click_text` 点节名 → `browser_study_play`
- 一节多视频按任务点顺序播，不要每次都点第一个视频
- 章节测验：监控自动搜题库；失败再 `browser_homework`
- 【9010】验证码：`browser_captcha` 后继续 play
- 监控中 `browser_finish(watching)`；整课完成 `browser_finish(done)`

## 作业 / 章节测验

- 只在题卡 `browser_homework` 上作答，禁止 eval/click 直接碰题面
- 列表 `list` / `open(title)` → `inspect` → `fill` → `save`（用户要求再 `submit`）
- 章节测验（刷课任务点）：监控自动处理；失败再手动 inspect/fill/save + `browser_study_next`
