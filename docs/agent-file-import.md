# Agent 文件导入

软件负责文件读取、隔离执行、验证和保存；Agent 根据文档格式选择解析方法。不会为某个题库或网课平台内置专用解析器。

## 两条入口

- 分段：`get_file_info` → `read_range` → `save_questions(questions[])`。每次保存最多 20 道，允许原文没有答案的题目使用空字符串。
- 脚本：先读取样本，再 `run_file_script(code)`；Agent 编写同步 JavaScript 函数体，宿主提供 `document.lines/text/rows` 等数据，返回题目数组。回执只有 `result_id`、题数和两道样本，随后 `save_questions(result_id)` 保存全部结果。

脚本仅处理已提取的文件数据。跨平台使用随软件分发的 QuickJS WASM，不要求安装 Python、Node 或办公软件，也没有网络、进程、文件或凭据 API。脚本在独立 Worker 中执行，可立即取消；运行上限 1 秒、32 MB，包含初始化的硬超时为 5 秒；输入最多 20000 个文本单元、200 万字符，输出最多 5000 道题，超限明确失败。

## 分页与保存回执

`read_range` 使用从 0 开始的闭区间，返回 `hasMore`、`nextStart`、`nextOffset`。超长段落按字符游标继续；EOF 返回空内容而非重复最后一段。预读数量是下限时 `truncated:true`，继续读取会加载后续数据。文本缓存有容量、闲置期限和文件修改检测。

保存前整批验证。无效题目不会被过滤后假报成功，不存在的指定文件夹不会回退到默认文件夹。`saved` 表示本次成功数，`total_saved` 表示该解析结果累计成功数，`remaining` 和 `complete` 明确剩余情况。知识点关联失败单独报告，不把已经入库的题目当成保存失败重试。

脚本结果引用只属于当前对话。每条题目成功入库后立即记录 Id，同一引用重试从未保存处继续，并发保存被拒绝。检查点只保留在当前进程，最长一小时；应用退出或崩溃后必须先核对数据库再重新导入，不能声称跨重启具有恰好一次语义。

## 验证

实机验证还使用本地受控模型跑完整 Agent 调用链，自动恢复模型选择，不请求付费模型。桌面回归阶段会执行该检查。

自动化测试已加入 `scripts/release/features.json` 的数据导入导出项，覆盖完整读取、逐批保存、脚本执行隔离、超时、输出限额、错误结果、取消、续传和重复提交。

运行中的本机安装包还可执行真实 DOCX 与数据库验证，默认生成可公开的测试文档，结束后删除创建的文件夹、题目和对话：

```sh
node scripts/test-agent-file-import.mjs /absolute/path/to/zerror-cli
```

使用自己的 DOCX 验证（第三个参数为已独立核对的题数）：

```sh
node scripts/test-agent-file-import.mjs /absolute/path/to/zerror-cli /absolute/path/to/questions.docx 225
```

参考了 [Pi 的文件读取](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts)、[Pi 的执行工具](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts)和 [Codex 的执行工具](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/unified_exec.rs)：采用明确分页、受限执行、结果引用和实际回执这些通用机制；本软件的数据脚本能力按文件导入场景实现，没有复制它们的完整终端权限模型。

## 自动决策与算法模板

“导入下”会结合当前对话的附件元数据执行，不需要重新提供文件。Agent 自行选择分批识题或编写 JavaScript，不固定优先某一种方式。普通导入默认本地题库；保存位置先看上下文及关联目录，未知时查看现有父子目录，按主题或文件名选择合适父目录并创建文件夹。除非用户明确要求，不上传校园题库。

新脚本实际完成全部题目的入库后，软件依据设置展示非阻塞的保存卡片：

- 不保存：仅跳过这次，不改变后续偏好。
- 保存：保存本次算法，下一份新算法仍询问。
- 下次不用问我：保存本次算法，并开启今后的自动保存。

设置 → Agent 的行为与权限中分为“保存导入算法模板”和“导入算法”两项。前者提供“每次询问 / 自动保存 / 不保存”，后者打开模板管理页，支持切换预览与编辑，修改名称、适用排版和 JavaScript 代码，以及删除模板。预览不会执行算法；保存代码前检查语法，离开或切换模板时保护未保存的修改。解析脚本和保存偏好保存在本机的加密应用设置中；不会把原文输入复制到模板。模板保存失败不改变已经成功入库的题目。

Agent 选择脚本路线时可调用 `list_import_templates(extension, keyword, offset, limit)` 查询名称、类型和结构说明。复用通过 `run_file_script(template_id)` 在相同的受限执行环境中运行，不把脚本全文再次发给模型；需要检查代码时用 `read_import_template(template_id, offset, limit)` 分段读取。当前文件仍须核对解析数量和样本，模板不会跳过题目验证或保存回执。

`get_file_info` 会附带最多 5 个同类型模板候选，名称与排版说明有长度上限，不携带源码。发现候选后，或 Agent 解锁任一脚本/模板工具时，相关工具一并提供，减少额外的工具解锁回合。

当用户明确要求单独保存算法时，使用 `save_import_template(result_id, name?, description?)`。宿主从当前会话的解析检查点或历史成功执行记录读取真实源码，只接受已经成功解析出题目的算法，不接受新传代码。无需再次入库，只有 `saved:true` 才表示模板已经持久化。普通导入仍遵循原有保存询问，不由 Agent 代替用户选择。聊天保存成功后，设置计数与列表立即更新；同一模板被其他入口修改时，只读预览同步刷新，未保存的编辑草稿保留。
