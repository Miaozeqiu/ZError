---
name: question-import
description: 从附带文件或导入任务识别题目并写入本地/校园题库。
compatibility: Requires ZError attachment, import-task and question-bank tools.
metadata:
  display-name: 题库导入
---

# 题库导入

用户明确要求导入、识别、收录或从文件提取题目时使用。有附件时，“导入下”就是导入附件，默认保存到本地题库。Agent 自行选择脚本或分批工具，根据上下文和题库结构确定或创建文件夹，不要求用户补充位置。详细步骤见 [references/workflow.md](references/workflow.md)。

- 读文件：`get_file_info` → 分段 `read_range`
- 脚本解析：先看样本，再 `run_file_script` 返回结果引用；核对后 `save_questions(result_id)`
- 模板复用：`list_import_templates` 查看结构说明，再 `run_file_script(template_id)`；需要看代码用 `read_import_template`
- 文件概况会附带少量适用模板；脚本与模板工具一次解锁。用户明确要求保存算法时，调用 `save_import_template(result_id)`，支持当前对话的历史成功结果；不需要重新入库。仅解析成功不能声称模板已保存。
- 本地写入：`save_questions`；校园写入：`save_campus_questions`（先 `read_agent_skill(campus-bank)`）
- 不确定文件夹时：`list_folders` / `get_folder_info`
- 分批方式一次 save ≤ 20 道；脚本方式核对预览后保存全部结果。成功的新算法会按设置提供保存选项，不阻塞导入完成。
