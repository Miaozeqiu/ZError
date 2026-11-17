# 怎么改 Skill 文件

## 文件

- 主说明：根目录 `SKILL.md` 必须含标准 YAML frontmatter：`name` 与目录 ID 一致（1–64 位小写英文、数字、单连字符），`description` 为 1–1024 字字符串。
- 中文展示名写入 `metadata.display-name`；运行环境与专有工具依赖写入 `compatibility`（最多 500 字）。可选字段还有 `license`、`metadata`、`allowed-tools`。`metadata` 中的值必须是字符串。
- `allowed-tools` 只是能力声明，不会授予额外权限。不要改写现有许可和元数据。
- 细则：`references/*.md`
- 站点步骤：`sites/<主机>/SKILL.md` 是附属文档，不是独立 Skill，无须套用根目录的命名规则。不要创建解析器。图谱用 `browser_site_graph`，不要整文件写 `site-graph.json`。

`write_agent_skill_file` 的 `content` 须包含完整的编辑内容。在线网站的 `write_scope=local_experience` 时，写回完整本地笔记并传入 `base_version`；自建网站写回完整文件。

## 新建

`path` 可以是还不存在的文本文件，例如 `references/tips.md`。写进 `SKILL.md` 时用链接指过去，并提醒执行时 `read_agent_skill_file`。

允许的扩展名：`.md` `.json` `.js` `.ts` `.txt` `.yaml` 等文本。禁止 `..`。

## 内置 vs 安装

- 使用在线仓库或自定义 HTTP 接口的网站：主经验、参考文件及图谱只读，Agent 只可编辑本站「本地经验」。
- 内部网站能力（`site-graph`、`site-learn`）：设置页隐藏。Agent 仍可使用图谱工具和站点经验写入流程。
- 其他内置 Skill：只读，设置页隐藏，不能写入、新建附属文件或恢复。读取与使用不受影响；以 `list_agent_skills` 返回的 `editable` 为准。
- `reset_agent_skill_file` 只对可编辑的内置文件有效
- 从 GitHub 安装的 Skill：直接改安装目录里的文件

## 怎么做

- 详细操作经验放在对应 Skill 的 references，不要全部塞进主 `SKILL.md`
- `skill_id` 以 `list_agent_skills` 为准
- 先 `read_agent_skill_file` 读原文，再整文件写回
- 图谱用 `browser_site_graph` 一条条改
