---
name: 练习与讲评
description: 出练习题、讲评作答、复习错题，以及查看练习记录。
---

# 练习与讲评

用户要出题、练习、订正、看错题或讲评刚做的题时使用。细则见 [references/workflow.md](references/workflow.md)。

- 出选择题/判断题必须 `present_quiz`，不要把选项写成普通列表
- 出题前 `list_questions` 看掌握度；错题用 `list_recent_wrong_questions`
- 用户每做完一题会发来选择：立刻只讲评这一题，不要再出新题，除非用户要求继续
