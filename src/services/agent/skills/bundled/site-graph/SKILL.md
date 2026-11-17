---
name: site-graph
description: 查看网站导航，编辑自建网站的节点、边和网址规则。用 browser_site_graph 逐条修改并自动保存。
compatibility: Requires ZError browser_site_graph and browser inspection tools.
metadata:
  display-name: 网站图谱
---

# 网站图谱

用户要改路由图，或任务里网址对不上节点、缺边、新站点没图时用。操作表见 [references/edit.md](references/edit.md)。

学习通和其他在线仓库的导航图谱只读，核实过的导航变化可记录到本站「本地经验」。自建网站的图谱在 `sites/<主机>/site-graph.json`。

## 什么时候改

- 用户明确要改图谱
- 固定步骤连续失败两次，更像走错页、页签没挂上
- `get_state` 的当前节点和真实页面不一致

先走站点 Skill 的固定步骤。

## 顺序

1. `get_state` 看当前页匹配了哪个节点
2. `browser_site_graph` 的 get 或 list 看整张图
3. `editable=true` 时可用 upsert_node / upsert_edge 修正路由、页面或边
4. 改对了立刻用原来的刷课或作业工具再试。每次改完宿主已保存。

图谱只写页面结构（节点、边、页内框、页签）。怎么走写站点 Skill。账号不要写进备注。
