# 学习通刷课

看快照点，播起来后 `browser_watch`。指定的那条没点中不能改播当前条。不要写 see.json。

## 顺序

1. 导航页先开 https://i.chaoxing.com。登录页只在被踢到 passport2 时再填。
2. 课程壳停在「任务」时，点侧栏「章节」。这仍是课程节点。
3. 目录里点带橙色数字的节名（如 `1.1`），不要点「第N章」标题。
4. 播放页是多层 iframe：`studentstudy` → `knowledge/cards` → 视频框（按 mid 区分）→ 测验还可能再套一层。快照按框分段。
5. 点指定那一条视频框里的播放，确认在播后再 `browser_watch`。裸点只作用于当前看得见的那条。
6. `browser_wait`。面板出现测验、本节做完、卡住或验证码会结束等待。

## 坑

- 框地址（`knowledge/cards` / `ananas`）用点，不要 `navigate` 当顶层网页打开。
- 两个视频框内部结构一样，按快照里的框路径和 mid 区分，不要点回第一条。
- 隐藏的 0 尺寸框不要点。
- 本节测验做完后点下一节，不必回作业列表。
- 看 iframe 用快照里的 frame，eval 里不要写 `iframe.contentDocument`。
