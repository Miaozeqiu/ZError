# 怎么改 Skill 文件

## 文件

- 主说明：`SKILL.md`（可含 YAML frontmatter：`name`、`description`）
- 细则：`references/*.md`
- 学习通实现：`site-graph.json`、`parsers/study/*`、`parsers/homework/*`（先改对应分组，不要整包重写）

`write_agent_skill_file` 的 `content` 必须是**完整文件**，不能只传片段。

## 新建

`path` 可以是还不存在的文本文件，例如 `references/tips.md`。写进 `SKILL.md` 时用链接指过去，并提醒执行时 `read_agent_skill_file`。

允许的扩展名：`.md` `.json` `.js` `.ts` `.txt` `.yaml` 等文本。禁止 `..`。

## 内置 vs 安装

- 内置（学习通、校园题库等）：写入会存到覆盖目录，设置页显示「已修改」
- `reset_agent_skill_file` 只对内置有效
- 从 GitHub 安装的 Skill：直接改安装目录里的文件

## 不要做

- 不要把解析器或图谱的实现说明写进 `chaoxing` 的 `SKILL.md`
- 不要编造 `skill_id`；先 `list_agent_skills`
- 不要在没读原文的情况下整文件覆盖
