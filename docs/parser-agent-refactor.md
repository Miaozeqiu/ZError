# 站点经验（原解析器改造清单已作废）

解析器（see.json / schema / locators / 干跑 / invoke / 卡片）已撤掉。

现在只留三样：

- 网站图谱：这一页是谁。
- 视频进度监控：`browser_watch`。
- 经验：`site-learn/sites/<主机>/SKILL.md` 写人能读的步骤；宿主把成功且页面有变化的点击记成【做过】，失败记成【教训】。

网站规则和任务决策位于各自仓库的编译运行包。客户端使用固定 document 命令和真实 iframe/loader 身份执行，不内置课程选择器或平台解析器；快照保留通用浏览器检查用途。

原则见 `.cursor/rules/parser-agent.mdc`。刷课坑见 `.cursor/rules/chaoxing-study-player.mdc`。
