---
name: chaoxing
description: >-
  学习通（Chaoxing）统一 Skill：登录、自动刷章节/视频、完成作业与章节测验。
  Use when the user asks to 登录学习通, 刷课, 播章节, 写作业, 答题, or finish Chaoxing tasks.
---

# 学习通

统一 Skill，按当前任务选用下面小节；详细步骤在 `references/`。

- **登录**：未登录或要在空间/课表操作时用 → `references/login.md`
- **刷课 / 章节任务**：播视频、刷未完成、等任务点 → `references/study.md`
- **作业 / 章节测验**：课程作业页或章节里的测验任务点 → `references/homework.md`

执行前 `read_agent_skill(chaoxing)`；附属文件用 `read_agent_skill_file`。

没有站点专用工具。看网站地图和快照，用 ref 点，播起来后 `browser_watch`。整门课交给 `browser_course_plan`。登录用 `browser_navigate`、`get_state`、`type`、`click_text`。
