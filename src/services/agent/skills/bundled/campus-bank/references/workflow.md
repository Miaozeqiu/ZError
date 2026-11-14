# 校园题库工作流

校园题 Id 是 `campus_question_id`，不是本地题库 `question_id`。

## 查题 / 浏览

1. `get_campus_status`（登录 / 绑定 / verified）
2. `list_campus_courses` → `list_campus_papers` → `list_campus_questions`，或 `search_campus_questions(keyword)`
3. 有试卷就必须 `list_campus_questions`，不能只看 paper 数量就说没题
4. list/search 会弹出浏览卡片，只供看题，不是作答。成功后不要再列出选项，也不要 `present_quiz`，除非用户明确说要练习、做题或订正

课程下未放进试卷的题，用 `list_campus_uncategorized_questions` 分页查看。查重用 `check_campus_question_duplicate`，提供完整题干和原顺序选项；仅题干一致时，说明选项还未核对。

## 练习

- `present_quiz` 只传 `campus_question_ids` 或 `paper_id` 和 `title`
- `campus_question_id` 不能传给 `get_practice_history`、`move_questions`、`save_questions`

## 新建课程

- 先确认用户指定的课程名称。缺少名称时先询问。
- 调用 `create_campus_course(name)`，使用账号已绑定的学校。接口返回 `pending` 时告知用户已提交审核。
- 工具缺失、未登录、未认证或接口失败时，说明原因。用户明确要求使用网站时才操作浏览器。

## 管理课程和试卷

- 改名用 `rename_campus_course`，先确认课程 ID 和新名称。待审核时告知用户申请已提交。
- 归档和取消归档用 `set_campus_paper_archived`。查已归档试卷时用 `list_campus_papers(include_archived=true)`。需要投票时先征求用户同意，发起投票后如实告知当前尚未生效。
- 排序用 `reorder_campus_paper_questions`，先读完整份试卷的分页，按新顺序提供全部顶层题 ID。排序范围限该试卷的顶层题。

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
