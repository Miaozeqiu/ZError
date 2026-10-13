---
name: 认识新站点
description: 当前网址没有现成步骤时：看快照摸路，走通后把经验写进 sites/<主机>/SKILL.md，并用网站地图记下这一页。
---

# 认识新站点

当前网址没有对应站点步骤、或图谱对不上时用。先看快照把事做成，再把做成的步骤写成经验。不要写解析器、see.json、schema.json、locators.json。

## 先读哪份

返回的 `files` 里，本站步骤是 `sites/<当前网址主机>/SKILL.md`。例如主机是 zjooc.cn 就读 `sites/zjooc.cn/SKILL.md`。只读当前主机那一份。

写法见 [references/workflow.md](references/workflow.md)。

## 默认顺序

1. `get_state` 看网址、图谱节点、已有经验和快照。
2. 用快照里的 ref 或 `click_text` 点。点中并确认页面变了，再写下这一步。
3. 用 `write_agent_skill_file` 写进 `sites/<主机>/SKILL.md`。每条写：哪一页、点哪个字、在哪个框、坑在哪。
4. 图谱用 `browser_site_graph` 一条条改（`upsert_site` / `upsert_node` / `upsert_edge`），会自动保存。
5. 视频播起来之后 `browser_watch`。

学习通走 `chaoxing`，不要写到这里。
