---
name: 编辑 Skill
description: 列出、阅读、改写或恢复 Agent Skill 文件。
---

# 编辑 Skill

用户要改某个 Skill 的说明、步骤或附属文件时使用。细则见 [references/edit.md](references/edit.md)。

## 工具

| 工具 | 用途 |
|------|------|
| `list_agent_skills` | 看全部 Skill 和文件 |
| `read_agent_skill_file` | 读原文（含 `SKILL.md`） |
| `write_agent_skill_file` | 整文件写回或新建 |
| `reset_agent_skill_file` | 内置 Skill 恢复默认 |

`read_agent_skill` 是给**执行**用的，返回的不是文件原文。编辑必须 `read_agent_skill_file`。

## 步骤

1. `list_agent_skills` 确认 `skill_id` 和 `path`
2. `read_agent_skill_file` 读出全文
3. 只改用户要改的部分，`write_agent_skill_file` 写回完整正文
4. 用户要还原内置内容：`reset_agent_skill_file`

## 专项

- 网站图谱 → 先 `read_agent_skill(site-graph)`。学习通写 `chaoxing` 的 `site-graph.json`；新站点先 `site-learn`，写 `sites/<host>/`
- 解析器 → 先 `read_agent_skill(parser)`，实现写在 `chaoxing` 的 `parsers/study/`、`parsers/homework/`；同一失败点连续两次只改对应分组
- 用户问失败原因或要优化流程：对着失败步骤的 error 和当时参数改对应文件（登录在 `chaoxing` 的 `references/login.md`）。不要否认，不要说不用优化。
