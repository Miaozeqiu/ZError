---
name: 智慧树
description: 课程列表出卡，按课名打开。不新增 browser_* 工具。
---

# 智慧树

1. 进学生课程列表。
2. 信解析器卡片的 `works`。要打开哪门课，用卡片里的 title，不要 get_page 扒 DOM。
3. 结构变了只改 `parsers/list/helpers.js`。

## 不要

- 不要把学习通流程写到这里
- 不要 navigate 打开 iframe src
