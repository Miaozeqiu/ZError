# 校园题库工作流

校园题 Id 是 `campus_question_id`，不是本地题库 `question_id`。

## 查题 / 浏览

1. `get_campus_status`（登录 / 绑定 / verified）
2. `list_campus_courses` → `list_campus_papers` → `list_campus_questions`，或 `search_campus_questions(keyword)`
3. 有试卷就必须 `list_campus_questions`，不能只看 paper 数量就说没题
4. list/search 会弹出浏览卡片，只供看题，不是作答。成功后不要再列出选项，也不要 `present_quiz`，除非用户明确说要练习、做题或订正

## 练习

- `present_quiz` 只传 `campus_question_ids` 或 `paper_id` 和 `title`
- `campus_question_id` 不能传给 `get_practice_history`、`move_questions`、`save_questions`

## 上传 / 改题

1. `get_campus_status` 确认已登录、已绑定、`verified=true`
2. 新建试卷：`create_campus_paper`（须课程 + 试卷名 `name`，平台用 `tag`）；改平台/试卷名：`update_campus_paper`（先 `list_campus_tags` 可看标签）
3. 上传：`save_campus_questions`（必须指定课程和试卷；可手写 `questions` 或本地 `question_ids`；一次最多 20 道；试卷不存在且要新建时 `create_paper=true`）
4. 改题：`update_campus_question`（必须用 `campus_question_id`；改内容时尽量带上当前 `paper_id`；一次最多 10 道）
5. 上传或改完会弹出浏览卡片，不要再列出选项，也不要 `present_quiz`，除非用户要练习

## 注意

- 用户说把试卷改成某平台或改试卷名时，调用 `update_campus_paper`，不要新建一份再复制
- 用户说上传到校园、放到校园试卷、改校园题时，不要用 `save_questions`
- 没登录、没绑定学校或 `verified=false` 时据实说明，不要编造校园题目
