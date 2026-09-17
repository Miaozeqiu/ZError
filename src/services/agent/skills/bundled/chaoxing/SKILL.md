---
name: 学习通
description: >-
  登录学习通，自动刷章节/视频，完成作业与章节测验。
---

# 学习通

系统会按当前页注入【当前步骤】。默认先照着做，不要一上来读完所有 references。

| 任务 | 文件 |
|------|------|
| 登录、打开课表 | [references/login.md](references/login.md) |
| 刷课、播视频、章节任务点 | [references/study.md](references/study.md) |
| 课程作业 | [references/homework.md](references/homework.md) |

只有【当前步骤】对不上、或要改流程时，才 `read_agent_skill_file(chaoxing, path)`。

刷课必须调用：`browser_study_chapters`、`browser_study_play`、`browser_study_watch`、`browser_study_next`。章节测验默认跳过（`next`）。课程作业才用 `browser_homework`。播放页禁止 `browser_eval`。登录和进课用 `navigate` / `type` / `click` / `click_text`。
