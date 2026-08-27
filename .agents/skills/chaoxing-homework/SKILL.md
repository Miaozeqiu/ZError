---
name: chaoxing-homework
description: >-
  Answers 学习通 (Chaoxing) course homework in the in-app browser
  through the homework card abstraction.
  Use when the user asks to 写作业, 做作业, 答题, or 应用高等数学作业.
---

# 学习通作业作答

给浏览器 Agent 用。只在 `browser_chaoxing_homework` 这张题卡上工作。不要 eval、不要 click 选项、不要让用户截图。

## 题卡

工具返回：

- `page`：`list` / `do` / `view` / `course`
- `questions`：`id` / `index` / `type` / `stem` / `options` / `filled`
- `next`：下一步该调的 action
- `hint`：一句话说明

公式图由抽象层读成文字。按 `stem` / `options` 作答。

## 流程

1. 未登录先按 `chaoxing-login`。不在该课就点课名再点「作业」。不要打开 iframe src。
2. `list` 看待做 → `open`（`title`=作业名）→ `inspect` 读题卡。
3. 一题一题作答：答出一道立刻 `fill` 这一道（`answers` 数组只放一项），确认返回里 `filled` 变了再做下一道。不要把整卷答案攒到最后一次 `fill`：
   - 单选 / 判断：`answer` 填 `A`（判断也可用 `正确` / `错误`）
   - 多选：`AC`
   - 填空：多空用分号 `；` 分隔
4. `save` 暂存。用户要提交再用 `submit`。已完成 / 待批阅不要再交。
5. 已选中的选项不要再点，`fill` 会跳过。

## 不要做

- 不要 `browser_eval` / `browser_click` / `browser_get_page` 碰作业页——会被直接挡回。题卡和网页自动双向同步，fill 就是作答
- 题干/选项还没读出的题（hint 会点名）先跳过，答完其他题再 `inspect` 补读。绝不允许猜答案
- 不要问用户截图或确认「要不要开始」
- 不要出练习题
- 不要把刷课里的章节测验和课程作业搞混
