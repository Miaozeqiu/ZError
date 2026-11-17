# 站点经验（原解析器改造清单已作废）

解析器（see.json / schema / locators / 干跑 / invoke / 卡片）已撤掉。

现在只留三样：

- 网站图谱：这一页是谁。
- 视频进度监控：`browser_watch`。
- 经验：`site-learn/sites/<主机>/SKILL.md` 写人能读的步骤；宿主把成功且页面有变化的点击记成【做过】，失败记成【教训】。

Agent 看快照点。学习通的目录和任务点在 `src/services/chaoxing/host/catalog.ts`，选择器在 `host/selectors.ts`。快照按 iframe 分段，同进程多层框要 pierce。

原则见 `.cursor/rules/parser-agent.mdc`。刷课坑见 `.cursor/rules/chaoxing-study-player.mdc`。
