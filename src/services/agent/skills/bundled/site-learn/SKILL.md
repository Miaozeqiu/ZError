---
name: site-learn
description: 查找和保存网站的导航经验与直达网址。站点流程归入 sites/<主网站域名>/SKILL.md。
compatibility: Requires ZError browser tools, read_agent_skill_file and write_agent_skill_file.
metadata:
  display-name: 网站经验
---

# 网站经验

查找和保存网站经验时用，包括复用已知页面的直达网址、给新网站摸路，以及验证后更新旧流程。不要写解析器、see.json、schema.json、locators.json。

## 先读哪份

本站步骤按主网站归档到 `site-learn` 的 `sites/<主网站域名>/SKILL.md`。例如 zjooc.cn 对应 `sites/zjooc.cn/SKILL.md`。同一网站的多个域名共用账号配置、操作经验和导航图谱。按工具返回的路径归档。未确认的跨域跳转不能自行认定为同一网站。

自建网站图标：从当前网页的 `link[rel~="icon"]`、`apple-touch-icon` 或真实品牌 logo 读取图片地址，用 `new URL(href, document.baseURI).href` 转为完整地址，再调用 `set_website_icon(icon_url=完整地址)` 保存。同一网站的各个域名共用图标。在线网站使用仓库提供的图标。

写法见 [references/workflow.md](references/workflow.md)。

## 快捷入口

- 已知网站且用户点名页面或资源时，在该站本地经验中查「快捷入口」。站点、所属范围和目标唯一匹配后才直达。进入后核对页面内容和当前身份；链接失效或落点不符时，从该站已验证的菜单、目录或列表重新定位。
- 核对后按「所属范围｜目标类型｜目标名称｜网址」记录可复用的站内顶层 HTTPS 地址。同一目标更新原条目。保留定位所需的稳定业务 ID，跳过会话令牌、一次性签名、登录回调、iframe 和会触发操作的地址。
- 实际网址只写本站的本地经验。按站点文件返回的编辑范围保存；共享经验、参考文件和图谱只记录通用流程。

## 默认顺序

1. `get_state` 看网址、图谱节点、已有经验和快照。
2. 用快照里的 ref 或 `click_text` 点。核对页面是否按预期变化。
3. 发现已验证、可复用的新步骤或用户要求记住入口时，用 `read_agent_skill_file(skill_id=site-learn)` 读取 `sites/<主网站域名>/SKILL.md`，按返回的 `write_scope` 保存。使用在线仓库或自定义 HTTP 接口时，只允许编辑 `local_experience`，把完整的本地笔记传给 `content`，并在 `base_version` 中传入 `repository_version`。使用应用内经验的自建网站可更新完整文件，`exists=false` 时可首次创建。登录经验归入主网站，以工具结果的 `id/path` 为准。
4. `editable=true` 的图谱用 `browser_site_graph` 逐条修改，修改自动保存。仓库或自定义 HTTP 接口中的参考文件和图谱只读，导航补充可写入「本地经验」。
5. 视频播起来之后 `browser_watch`。

## 任务收尾

按已知流程完成时，直接反馈结果。只有发现可复用的变化或用户要求保存时才核对本站文件，写入成功后报告已保存。

失败后的恢复步骤、结构化读取的修正值得检查；只看到工具返回成功还不能证明方法有效。具体写法和核对要求见 [references/workflow.md](references/workflow.md)。

学习通常规流程先读 `chaoxing`；本站新增的结构差异可记录到主网站的站点文件，避免改动通用流程。
