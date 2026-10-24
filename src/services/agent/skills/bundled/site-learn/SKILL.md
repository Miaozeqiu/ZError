---
name: 认识新站点
description: 当前网址没有现成步骤时：看快照摸路，走通后把经验写进 sites/<主机>/SKILL.md，并用网站地图记下这一页。
---

# 认识新站点

当前网址没有对应站点步骤、图谱对不上，或任务中换方法后验证成功时用。先看快照把事做成，再把做成的步骤写成经验。不要写解析器、see.json、schema.json、locators.json。

## 先读哪份

返回的 `files` 里，本站步骤是 `sites/<当前网址主机>/SKILL.md`。例如主机是 zjooc.cn 就读 `sites/zjooc.cn/SKILL.md`。只读当前主机那一份。

写法见 [references/workflow.md](references/workflow.md)。

## 默认顺序

1. `get_state` 看网址、图谱节点、已有经验和快照。
2. 用快照里的 ref 或 `click_text` 点。点中并确认页面变了，再写下这一步。
3. 用 `write_agent_skill_file` 写进 `sites/<主机>/SKILL.md`。每条写：哪一页、点哪个字、在哪个框、坑在哪。
4. 图谱用 `browser_site_graph` 一条条改（`upsert_site` / `upsert_node` / `upsert_edge`），会自动保存。
5. 视频播起来之后 `browser_watch`。

## 任务收尾

多步网页任务在 `browser_finish(done)` 中提供 `learning.decision` 和具体 `reason`：

- `updated`：本轮读过原文，合并已验证的新经验并实际写入成功。
- `covered`：读过本站文件，新经验已被某一节覆盖，说明位置，不重复写。
- `no_new`：只是复用已知步骤，没有新的可复用发现。
- `deferred`：写入被拒绝、禁止或失败，说明未保存；不要为保存经验重复申请权限或重做网页任务。

失败后的恢复步骤、结构化读取的修正值得检查；只看到工具返回成功还不能证明方法有效。具体写法和核对要求见 [references/workflow.md](references/workflow.md)。

学习通常规流程先读 `chaoxing`；本站新增的结构差异可记录到当前主机的站点文件，避免改动通用流程。
