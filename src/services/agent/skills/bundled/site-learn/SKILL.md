---
name: site-learn
description: 当前网址没有现成步骤时：看快照摸路，走通后把经验写进 sites/<主网站域名>/SKILL.md，并用网站地图记下这一页。
compatibility: Requires ZError browser tools, read_agent_skill_file and write_agent_skill_file.
metadata:
  display-name: 认识新站点
---

# 认识新站点

当前网址没有对应站点步骤、图谱对不上，或任务中换方法后验证成功时用。先看快照把事做成，再把做成的步骤写成经验。不要写解析器、see.json、schema.json、locators.json。

## 先读哪份

本站步骤按主网站归档到 `site-learn` 的 `sites/<主网站域名>/SKILL.md`。例如 zjooc.cn 对应 `sites/zjooc.cn/SKILL.md`。关联登录域名属于同一网站，统一使用主网站的账号配置、操作经验和导航图谱，不另建网站；以工具返回的归档路径和收尾检查提示为准。未确认的跨域跳转不能自行认定为同一网站。

网站图标：从当前网页的 `link[rel~="icon"]`、`apple-touch-icon` 或真实品牌 logo 读取图片地址，用 `new URL(href, document.baseURI).href` 转为完整地址，再调用 `set_website_icon(icon_url=完整地址)` 保存。宿主会下载验证并缓存到本站配置，登录域名共用主网站图标。不要猜路径，也不要把图片或 Base64 写进操作经验。

写法见 [references/workflow.md](references/workflow.md)。

## 默认顺序

1. `get_state` 看网址、图谱节点、已有经验和快照。
2. 用快照里的 ref 或 `click_text` 点。点中并确认页面变了，再写下这一步。
3. 本轮先用 `read_agent_skill_file(skill_id=site-learn)` 读取 `sites/<主网站域名>/SKILL.md`。`exists=false` 表示本站尚无经验，可以首次创建，不是读取失败；只读本篇总说明不算读取本站文件。然后用 `write_agent_skill_file(skill_id=site-learn)` 保存完整正文，不要写入 `chaoxing`；已有原文需保留并合并。每条写：哪一页、点哪个字、在哪个框、坑在哪。登录服务作为本站登录步骤记录，以工具结果的 `id/path` 为准。
4. 图谱用 `browser_site_graph` 一条条改（`upsert_site` / `upsert_node` / `upsert_edge`），会自动保存。
5. 视频播起来之后 `browser_watch`。

## 任务收尾

多步网页任务在 `browser_finish(done)` 中提供 `learning.decision` 和具体 `reason`：

- `updated`：本轮读过原文，合并已验证的新经验并实际写入成功。
- `covered`：读过本站文件，新经验已被某一节覆盖，说明位置，不重复写。
- `no_new`：只是复用已知步骤，没有新的可复用发现。
- `deferred`：写入被拒绝、禁止或失败，说明未保存；不要为保存经验重复申请权限或重做网页任务。

失败后的恢复步骤、结构化读取的修正值得检查；只看到工具返回成功还不能证明方法有效。具体写法和核对要求见 [references/workflow.md](references/workflow.md)。

学习通常规流程先读 `chaoxing`；本站新增的结构差异可记录到主网站的站点文件，避免改动通用流程。
