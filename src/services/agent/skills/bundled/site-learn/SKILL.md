---
name: 认识新站点
description: 在未知网站上探路、记下页面结构和操作步骤，并写入该站的图谱、解析器与 Skill。
---

# 认识新站点

当前网址的主机不在【可用 Skill】、`get_state.siteGraph` 对不上、或没有专用工具时使用。先完成用户任务，同时把走过的页记下来。

已记下的站点步骤在 `sites/<host>/SKILL.md`，图谱在 `sites/<host>/site-graph.json`，解析器在 `sites/<host>/parsers/<role>/`。先 `list_agent_skills` 看 site-learn 的 files。智慧树课程列表是现成样例：`sites/zhihuishu.com/`。

## 步骤

1. `browser_get_state` / `browser_get_page` / `browser_screenshot` 看现状。布局、图标按钮看不清就截图。
2. 用 `click` / `click_text` / `type` / `navigate` 做事。跳转或等元素出现用 `browser_wait`（`until=url|selector|idle`）。
3. 记下：主机、关键页 URL 正则、入口文案、iframe / 页签。
4. `browser_site_graph action=upsert_site`（`siteId`、`host`、`name`）。
5. `upsert_node` / `upsert_edge` 把走过的页写进图谱。`patterns` 写具体 URL 正则。能挂解析器的页写 `parserIds: ["<role>"]`。
6. 持久化：
   - `write_agent_skill_file(site-learn, sites/<host>/site-graph.json, 最新 site JSON)`
   - `write_agent_skill_file(site-learn, sites/<host>/SKILL.md, 该站操作步骤)`
   - 能稳定认的结构：抄 `parser` Skill 的 template，写成 `sites/<host>/parsers/<role>/{helpers,parse,locate}.js`
   - 至少留 1 份 HTML 到 `sites/<host>/fixtures/` 或 testdata

学习通不要写到这里，改 `chaoxing`。

## 该站 SKILL.md 写什么

短步骤，按任务分小节。写清：从哪一页到哪一页、要点的文案、哪些地址是 iframe 不要 `navigate`。选择器写解析器，不要写进 SKILL.md。

## 不要做

- 不要编造没见过的按钮或 URL
- 不要把 iframe 地址当顶层网页打开
- 同一失败两次再改图谱或 helpers，不要整站重写
- 不要只写步骤不写解析器（能出卡的页必须有 `parsers/<role>/`）
- 不要把学习通流程写进这个 Skill
