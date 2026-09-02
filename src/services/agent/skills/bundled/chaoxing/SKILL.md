---
name: 学习通
description: >-
  登录学习通，自动刷章节/视频，完成作业与章节测验。
---

# 学习通

按当前任务选用下面小节；详细步骤在 `references/`，用 `read_agent_skill_file(chaoxing, path)` 按需读取。

| 任务 | 文件 |
|------|------|
| 登录、打开课表 | [references/login.md](references/login.md) |
| 刷课、播视频、章节任务点 | [references/study.md](references/study.md) |
| 课程作业、章节测验 | [references/homework.md](references/homework.md) |

## 选用规则

- 未登录或要在空间/课表操作 → 先读 `references/login.md`
- 播视频、刷未完成、等任务点 → 读 `references/study.md`
- 作业列表/答题页/章节测验任务点 → 读 `references/homework.md`

专用工具：`browser_study_chapters` / `play` / `watch` / `next` / `homework` / `captcha`。登录用 `browser_type selector=#phone` / `#pwd`，不要把 CSS 放进 ref，不要 get_page。

刷课铁律：`我学的课` → 课名 →「章节」→ `browser_study_chapters` → 立刻 `browser_study_play` → `finish(watching)`。禁止 get_page / eval / watch / 再点章节。同一失败连续两次再改图谱或对应解析器分组，写回后重试。
