# 文件夹与题目整理

## 文件夹

- `list_folders` 看 Id、名称、父级和题目数量
- `get_folder_info` 可用 `folder_id` 或 `folder_name`
- `create_folder`：可指定父文件夹，默认建在最外层（`parent_id=0`）
- `rename_folder` / `move_folder`：不能动默认文件夹（Id=0），也不能把文件夹移进自己的子文件夹
- `delete_folder`：只能在用户明确要求删除时调用。`delete_questions=true` 连题目一起删，否则题目回到默认文件夹

## 题目

- `list_questions`：一次最多 40 道，多的翻页。可按重要性/掌握度/难度筛
- `search_questions`：按题干关键词找 Id
- 把某几道题挪到别的文件夹：先确认题目 Id，再 `move_questions`。不要把整个文件夹当题目移动；挪文件夹用 `move_folder`。一次不要超过 50 道
- 用户要求保存、收录、写入本地题库：`save_questions`。字段：`question`、`options`（写成 `"A. xxx\\nB. xxx"`）、`answer`、`question_type`（单选/多选/判断/填空）、importance/mastery/difficulty（0–3，或低/中/高、未掌握/一般/已掌握、简单/中等/困难）。能看出考点就写 `knowledge_point` / `node_name`，能看出章节就写 `parent_name`
- 整理题目、把题挂到某节：`link_questions_to_knowledge`
- 改重要性、掌握度、难度：`update_question_metrics`

## 指定文件夹

用户文本里如果出现「名称（folder_id=…，路径=…）」，必须使用这个 folder_id。用户只用语言指定（例如「存到错题本」）时，先 `list_folders` 或 `get_folder_info` 对应，不要自己另选。不确定就先问一句。
