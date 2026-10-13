---
name: 网站图谱
description: 改正网站节点、边、网址规则。用 browser_site_graph 一条条改，会自动保存。执行时先读这个 Skill，操作表在 files 的 references/edit.md。
---

# 网站图谱

用户要改路由图，或任务里网址对不上节点、缺边、新站点没图时用。操作表见 [references/edit.md](references/edit.md)。

学习通：`browser_site_graph`（站点 id 用 chaoxing）。新站点先 `read_agent_skill(site-learn)`，图谱在 `sites/<主机>/site-graph.json`。

## 什么时候改

- 用户明确要改图谱
- 固定步骤连续失败两次，更像走错页、页签没挂上
- `get_state` 的当前节点和真实页面不一致

先走站点 Skill 的固定步骤。

## 顺序

1. `get_state` 看当前页匹配了哪个节点
2. `browser_site_graph` 的 get 或 list 看整张图
3. 路由对不上、缺页、缺边，再用 upsert_node / upsert_edge
4. 改对了立刻用原来的刷课或作业工具再试。每次改完宿主已保存。

图谱只写页面结构（节点、边、页内框、页签）。怎么走写站点 Skill。账号不要写进备注。
