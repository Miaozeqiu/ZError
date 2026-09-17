# 知识图谱工作流

学习页的科目和知识图谱独立于题库文件夹。

## 先看

- `list_subjects` 看有哪些科目
- `get_subject` 打开某一科
- `get_knowledge_graph` 改图、聚焦或讲解前先调用
- 用户说想学某科：先 `list_subjects`，有同名就 `attach_study_subject`，没有就 `create_subject` 再挂上
- 用户说撤下、不学了：`detach_study_subject`
- 几门课合成一门：`merge_subjects`；某几章拆成新科目：先 `get_knowledge_graph` 再 `split_subject`

## 已有图谱

按用户这句话做事：说补、加、改名、删某一章/节就 `patch_knowledge_graph`。没说重画不要清空。不要为凑节点数继续加。

## 重画

只有用户说重画、推倒重来、全部重做才 `set_knowledge_graph`，必须 `replace=true`。

## 空图从零画

1. 先加 8–12 个章名
2. 再给每章加 2–4 个节名
3. 每批 `patch` 3–8 个不同节点
4. 到节为止，不要拆定理、模型、公式、论文名
5. 禁止：学科基础、核心概念、方法与应用、基础知识、综合应用、概述、其他
6. 不要先问用户确认。工具返回 error 就修正再调用

## 界面

- 点名某一章/节：`focus_knowledge_graph`，`node_name` 用图谱里的中文名。分批画图时不要对每个新节点 focus
- 打开/展开思维导图：`open_knowledge_graph`
- 新建科目：`create_subject`；重命名 `rename_subject`；删除须用户说清楚

## 进度

图谱进度是 7 段遗忘曲线，不是题目掌握度 0–3。不要用 `patch_knowledge_graph` 改 mastery，不要自己口头打分。系统会在讲完、练完后自动评估；用户明确问进度，或说以前学过/忘了时再 `evaluate_study_progress`。`hint` 只写这次真正讲到、练到或用户点名的节名（叶子），不要写章名，不要写「基础/入门」。画图谱、只列出目录、只 focus、动笔讲解之前、只闲聊时不要调用。
