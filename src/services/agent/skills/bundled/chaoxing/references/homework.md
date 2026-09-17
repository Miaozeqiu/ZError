# 学习通作业 / 章节测验

解析面板只在作答页/章节测验题卡有效：`inspect` 读题，`fill` 等于点面板选项。填写优先走题卡，不要把网页选项当填写正路。作答页可以用 `get_page` / `eval` 只读看页；面板为空时先看页再决定要不要改解析器。作业列表、课程壳、空间等其他页，`get_page` / `eval` 仍是看页的方式。

`action`：`list` / `open(title)` 仅课程作业列表；`inspect` 读题；`fill` 填一题（`answers` 一次一项：单选/判断填 A，多选填 AC，填空多空用分号）；`guess` 剩余题随机；`save` 暂存（章节测验走页内 `noSubmit`/`saveWork`）；`submit` 提交（`btnBlueSubmit`，确认框会点确定）。刷课里测验失败后继续用 `browser_study_next`。

## 流程

- 课程作业：先进课程壳，点侧栏「作业」页签（pageHeader=8）。「任务」「章节」「作业」都是同一课程节点的侧栏，不是独立顶层页。已经在「任务」就改点「作业」。刚进课先等 1–2 秒再点；找不到就再 click_text「作业」，或直接 `browser_homework list`。名单在页内 iframe，待交/已完成是本页筛选，不要 `navigate` 打开 `mooc2/work/list`。
- 从名单打开后才是独立「作业作答」页。章节播放里夹带的测验仍在 studentstudy 内，不要当成课程作业作答页。
- `get_page` 或快照里已经出现「未交」作业名：立刻 `browser_homework open`，title 用第一份未交名。禁止再 `list`。列表解析弱时继续用 `get_page` / `eval` 看名单。
- 只有完全不知道有哪些作业时才 `list`。`open` 会直接点标题进作答页。
- 一份里还有任务点就再 `open` 未交任务点名。作答页 `inspect` → `fill` → `save`（用户要交再 `submit`）。一题一题 `fill`。
- 刷课里的章节测验默认跳过：用 `browser_study_next`，不要当课程作业。只有用户明确说做测验 / 写作业时才 `inspect` / `fill` / `guess` / `save`。
- `inspect` 返回 questions：id/index/type/stem/options/filled。有视觉模型时公式图会读成文字；当前是文本模型则跳过图像/公式题，只答文字题。
- 已完成/待批阅不要再交。不要出练习题。
- `list` 空、`open` 报还在列表：先 `get_page` / `eval` 看名单 iframe；确认结构变了再改 `parsers/homework/helpers.js`（名单在 `parse.js`）。
- `inspect` 连续两次读不到题，或 `fill` 点不上：先确认在作答页。页不对改图谱；结构变了只改 `helpers.js`。填写仍走题卡。
