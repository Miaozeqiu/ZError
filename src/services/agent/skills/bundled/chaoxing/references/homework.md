# 学习通作业 / 章节测验

只在题卡 `browser_homework` 上作答，禁止 `browser_eval` / `browser_click` / `browser_get_page` / `browser_type` 碰题面（会被直接挡回）。题卡和网页自动双向同步。

`action`：`list` / `open(title)` 仅课程作业列表；`inspect` 读题；`fill` 填一题（`answers` 一次一项：单选/判断填 A，多选填 AC，填空多空用分号）；`guess` 剩余题随机；`save` 暂存；`submit` 提交（用户明确要求）。刷课里测验失败后继续用 `browser_study_next`。

## 流程

- 课程作业：先进入作业页。列表 `list` / `open(title)`，作答页 `inspect` → `fill` → `save`（用户要交再 `submit`）。一题一题 `fill`。
- 章节测验（刷课里的 work 任务点，对齐 ocsjs）：监控会自动搜本地题库、未命中随机、暂存并继续。只有自动失败时才手动 `inspect` / `fill` / `guess` / `save`，再 `browser_study_next`。
- `inspect` 返回 questions：id/index/type/stem/options/filled。公式图已读成文字。
- 已完成/待批阅不要再交。不要出练习题。
- `inspect` 连续两次读不到题：先确认在作答页。页不对改图谱；结构变了只改 `inspect.js` / `parse.js`，不要 eval 碰题面。
