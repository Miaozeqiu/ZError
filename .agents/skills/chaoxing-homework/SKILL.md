---
name: chaoxing-homework
description: >-
  Answers 学习通 (Chaoxing) course homework and chapter quizzes in the in-app
  browser through the homework card abstraction.
  Use when the user asks to 写作业, 做作业, 答题, or 应用高等数学作业,
  or when brushing chapters hits a 测验/作业 task point that auto-run failed.
---

# 学习通作业 / 章节测验作答

只在 `browser_chaoxing_homework` 题卡上工作。不要 eval、不要 click 选项。

## 课程作业

1. 点「作业」→ `list` → `open` → `inspect`。
2. 一题一题 `fill`（answers 只放一项）。
3. `save`；用户要交再 `submit`。

## 章节测验（对齐 ocsjs JobRunner.chapter）

刷课监控会自动：

1. 打开测验任务点  
2. 本地题库搜题（与 OCS `/query` 同源）  
3. 填入命中答案  
4. 未命中随机（`guess`）  
5. 暂时保存  
6. 继续下一任务点  

只有自动失败时才手动：`inspect` → `fill` / `guess` → `save` → `browser_chaoxing_next`。

## 不要做

- 不要 `browser_eval` / `click` / `get_page` 碰题面
- 不要问用户截图或「要不要开始」
- 不要出练习题
