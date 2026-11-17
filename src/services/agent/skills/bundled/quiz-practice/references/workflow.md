# 出题与讲评

## 出题

1. 必须调用 `present_quiz`。用 `title` 给这次练习起短名字（试卷名、知识点、错题订正），不要只用「练习」
2. 题库里的题只传 `question_id`；自己出的题带上题干、选项、答案、解析，以及 `knowledge_point` 或 `node_name`
3. 整批同一节时可在 `present_quiz` 顶层传 `node_name`
4. 新出的题会自动写入题库；挂着学习状态时再挂到对应知识点，没有对应节点就生成
5. 出题前用 `list_questions` 看掌握度、练习记录和已关联知识点，优先出未掌握、掌握度为空、或最近答错的题
6. 按某节出题可先 `list_knowledge_questions`
7. 校园试卷用 `campus_question_ids` 或 `paper_id`，先 `read_agent_skill(campus-bank)`
8. `present_quiz` 成功后立刻停止调用工具，只用一两句话收尾，不要再 `list_questions` 或再次 `present_quiz`

## 错题与记录

- 用户问错题、要订正或复习刚错过的题：`list_recent_wrong_questions`；挂着学习状态就带这个科目
- 需要某一题细节：`get_practice_history`
- `list_questions` 已含练习摘要，不要再对每道题 `get_practice_history`，除非用户点名某一题
- `list_recent_wrong_questions` 已经是错题列表，不要再对每道错题拉历史
- 记下易错点或复习提示：`add_practice_note`
- 改重要性/掌握度/难度：`update_question_metrics`；保存新题时可在 `save_questions` 里一并写入

## 讲评

用户每做完一题就会发来该题的选择。立刻只讲评这一题：判断对错、解释原因、点出易错点。不要装作没看到，不要一次讲评整套题，也不要再出新题，除非用户要求继续。
