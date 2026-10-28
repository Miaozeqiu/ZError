---
name: knowledge-graph
description: 查看、绘制、补改、聚焦或打开学习页的科目知识图谱。
compatibility: Requires ZError knowledge-graph tools.
metadata:
  display-name: 知识图谱
---

# 知识图谱

用户要画图、补章/节、改名、删节点、重画、打开或聚焦图谱时使用。细则见 [references/workflow.md](references/workflow.md)。

- 改图前先 `get_knowledge_graph`
- 已有图：补/加/改/删用 `patch_knowledge_graph`；只有用户说重画、推倒重来才 `set_knowledge_graph(replace=true)`
- 空图从零分批画：先章再节，到节为止
- 讲解或点名某一章/节时 `focus_knowledge_graph`；用户说打开图谱时 `open_knowledge_graph`
