---
name: 网站图谱
description: 查看、改正并持久化浏览器网站图谱（节点、边、URL 正则、解析器挂载）。
---

# 网站图谱

用户要改路由图，或任务里 URL 对不上节点、缺边、新站点没图时使用。细则见 [references/edit.md](references/edit.md)。

当前实现在学习通 Skill：`read_agent_skill_file(chaoxing, site-graph.json)`。

## 何时改

- 用户明确要改图谱
- 固定步骤连续失败两次，且更像「走错页 / 页签没挂上」，不是选择器坏了
- `browser_get_state` 的当前节点和真实页面不一致

先走站点 Skill 的固定步骤。不要一失败就重画整张图。

## 先看再改

1. `browser_get_state` 看当前页匹配了哪个节点
2. `browser_site_graph action=get`（或 `list`）看整张图
3. 路由对不上、缺页、缺边，再用 `upsert_node` / `upsert_edge` / `remove_*`
4. 改对了立刻用原来的刷课/作业工具重试；要留下就写回 `site-graph.json`

## 内存 vs 文件

- `browser_site_graph` 只改**当前进程内存**，`reset` 会丢，回到 Skill 文件
- 用户要留下改动：把最新 `site` 写成 `site-graph.json`，用 `write_agent_skill_file(chaoxing, site-graph.json, content)`
- 写回后运行时会热加载；`reset` 也从该文件读

## 不要做

- 不要把图谱说明写进 `chaoxing` 的 `SKILL.md`
- 不要编造不存在的 `parserIds`（只有 `login` / `study` / `homework` / `captcha`）
- 不要把 iframe 地址（`knowledge/cards`、`ananas`、`studentcourse`）做成单独节点；写进宿主页的 `patterns`，也不要 `browser_navigate` 打开它们
