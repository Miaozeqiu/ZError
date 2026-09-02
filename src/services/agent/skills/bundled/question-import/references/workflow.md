# 题库导入工作流

用户附带文件不等于要导入。只有明确要求导入、识别题目、保存、收录或写入题库时才走本流程。

## 步骤

1. `get_file_info` 一次看清类型和规模（可传 `path`，不传则用对话附带文件）
2. 分段 `read_range(start, end)`；不要一次读完全文。文件较大时按 `nextHint` 继续，直到末尾
3. 每看完一段就写入，不要等全文读完
   - 本地：`save_questions`（`folder_id` / `folder_name` + `questions[]`）
   - 校园：`save_campus_questions`（先 `read_agent_skill(campus-bank)` 并确认状态）
4. 一次 save 不要超过 20 道。只提取文件里真实存在的题目，不要编造
5. 用户指定文件夹：消息里有 `folder_id=` 就用它；只有语言描述时先 `list_folders` / `get_folder_info`，不确定就先问
6. 全部读完并保存后，用一两句话总结结果。不要把题目 JSON 直接输出到对话里

## 题目字段

`question`（题干）、`options`（`"A. xxx\nB. xxx"`）、`answer`、`question_type`（单选/多选/判断/填空）、importance/mastery/difficulty（0–3 或低/中/高）。能看出考点就写 `knowledge_point` / `node_name`，能看出章节就写 `parent_name`；没有对应节点时也写简短考点名，系统会自动关联。

## 后台导入任务

用户从导入入口选文件时同样遵循：`get_file_info` → 分段 `read_range` → 每段立刻 `save_questions` → 完成后简短总结。
