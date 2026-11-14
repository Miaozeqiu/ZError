---
name: campus-bank
description: 查看、搜索、上传与编辑校园题库试卷和题目。
compatibility: Requires ZError campus question-bank tools and a signed-in campus account.
metadata:
  display-name: 校园题库
---

# 校园题库

用户问校园题、学校课、试卷，或要上传/改校园题库时使用。详细规则见 [references/workflow.md](references/workflow.md)。

- 查题 / 浏览：`get_campus_status` → `list_campus_courses` / `list_campus_papers` / `list_campus_questions` 或 `search_campus_questions`
- 新建课程：缺少课名先询问。使用 `create_campus_course`，缺少工具或调用失败时说明原因，不改用浏览器。
- 未分类题目用 `list_campus_uncategorized_questions`，查重用 `check_campus_question_duplicate`。
- 管理课程和试卷用 `rename_campus_course`、`set_campus_paper_archived`、`reorder_campus_paper_questions`。按工具返回的审核或投票状态报告结果。
- 写入前遵守「行为与权限」的上传与修改开关和用户本轮授权。学习通作业只使用批阅页明确公布的正确答案；提交回执和总分不能证明每道题的正确答案。
- 上传 / 改题：先确认登录与 verified，再 `create_campus_paper` / `save_campus_questions` / `update_campus_question` / `update_campus_paper`
- 练习：`present_quiz` 用 `campus_question_ids` 或 `paper_id`，不是本地 `question_id`
- 上传到校园不要用 `save_questions`（那是本地题库）
