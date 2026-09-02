---
name: 校园题库
description: 查看、搜索、上传与编辑校园题库试卷和题目。
---

# 校园题库

用户问校园题、学校课、试卷，或要上传/改校园题库时使用。详细规则见 [references/workflow.md](references/workflow.md)。

- 查题 / 浏览：`get_campus_status` → `list_campus_courses` / `list_campus_papers` / `list_campus_questions` 或 `search_campus_questions`
- 上传 / 改题：先确认登录与 verified，再 `create_campus_paper` / `save_campus_questions` / `update_campus_question` / `update_campus_paper`
- 练习：`present_quiz` 用 `campus_question_ids` 或 `paper_id`，不是本地 `question_id`
- 上传到校园不要用 `save_questions`（那是本地题库）
