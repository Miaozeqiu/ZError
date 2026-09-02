---
name: 题库导入
description: 从附带文件或导入任务识别题目并写入本地/校园题库。
---

# 题库导入

用户明确要求导入、识别、收录或从文件提取题目时使用。详细步骤见 [references/workflow.md](references/workflow.md)。

- 读文件：`get_file_info` → 分段 `read_range`
- 本地写入：`save_questions`；校园写入：`save_campus_questions`（先 `read_agent_skill(campus-bank)`）
- 不确定文件夹时：`list_folders` / `get_folder_info`
- 一次 save ≤ 20 道；每段立刻写入，不要等全文读完
