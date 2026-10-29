---
name: 智慧树
description: 智慧树（zhihuishu.com）与教学空间（polymas.com）的登录、进课、播放、课中弹题、作业考试和 AI 掌握度 Browser Agent 手册。
---

# 智慧树 Browser Agent 手册

适用站点是 `zhihuishu.com` 及其子域，以及智慧树教学空间 `polymas.com`。先用 `browser_get_state({})` 看网址与图谱节点，再用 `browser_get_page({})` 取当前快照。页面操作优先使用快照 `ref`，不要用脚本伪造点击、学习进度、完成状态或反作弊数据。

## 可用工具

- `browser_get_state({})`：读网址、标题、图谱节点和站点经验。
- `browser_get_page({})`：读含 iframe 分段的无障碍快照；元素会带 `ref`。
- `browser_find({ query, regex? })`：在最近快照中找文案。
- `browser_click({ ref?, selector?, nth?, frame? })`：用 `ref` 或确有依据的 CSS 点击。
- `browser_click_text({ text, nth?, frame? })`：按可见文字点击。
- `browser_type({ ref?, selector?, text, nth?, frame? })`：填输入框，不会自动回车。
- `browser_wait({ seconds?, until?, url?, selector?, fn?, response?, frame?, idleMs? })`：短时等待页面变化。
- `browser_watch({ title?, ref? })`：视频已实际播放后挂进度监控。
- `browser_finish({ status, summary })`：`done` 表示任务完成，`watching` 表示已交监控，`blocked` 表示必须由用户处理。

## 登录与验证码

1. 在 `passport.zhihuishu.com/login` 或 `login.zhihuishu.com` 读取快照，用 textbox 的 `ref` 填账号和密码，再点快照中的登录按钮。
2. 登录后重新 `browser_get_state({})`，必须看到网址离开登录节点才算成功。
3. 出现网易易盾 `.yidun_popup` 时，不破解、不拖动、不注入脚本：立即 `browser_finish({ status: "blocked", summary: "检测到网易易盾滑块，请手动滑动一次；完成后我再继续。" })`。
4. 用户手动完成后重新取快照，确认 `.yidun_popup` 已消失，再继续。不要关闭或重启浏览器来处理验证码。

## 从课程列表进课

课程列表可能在 `onlineweb.../onlinestuh5`、`online.../student/course` 或 `onlineh5...`。先按用户给出的课程名用 `browser_find` 定位，再用该课程标题/卡片的 `ref` 点击。点击后重新读状态，确认进入 `course-study-plan` 或 `course-study-player`；不能因为按钮消失就假定进课成功。

## 未完成小节与播放页

各版页面只使用各自已验证的结构，不把选择器跨站套用：

| 页面 | 任务条目 | 已完成证据 |
| --- | --- | --- |
| `studyvideoh5.../stuStudy` | `.clearfix.video` | 条目内 `.time_icofinish` |
| `fusioncourseh5.../stuStudy` | `.resources-item`；旧布局为 `.clearfix.video` | 资源卡内 `.isFinish`；旧布局按必学进度或 `100%` |
| `studyplush5...` | 有 `.child-time` 的 `.child-main` | 父条目内 `.finish-icon` |
| `studywisdomh5.../study/index` | `.chapter-content` 下的小节 | 小节内 `.finish-icon` |
| `wisdom-mooc.../study/index` | `.chapter-content .chapter-item` / `.chapter-content-second` | 小节内 `.finish-icon` |
| `smartcoursestudent.../learnPage`、`ai-smart-course-student-pro.../learnPage` | `[class*="card-container"]` | `.finished-icon` 且文字含“已完成” |
| `hike.zhihuishu.com/aidedteaching/sourceLearning` | `.file-item` | 条目内 `.icon-finish` |
| 旧版 polymas 教学空间 | `.source-icon` 所在任务行 | 任务行内 `i.select` |
| 新版 polymas `resource-detail` | 叶子 `.el-tree-node` | 叶子内 `label.success` |

提供的参考源码没有把 `.checked-img` 绑定到上述任何固定站点。只有当前页面快照明确显示它位于某个任务条目内且语义确为“已完成”时，才可把该条目标为完成；不得猜测归属或仅凭类名跳过任务。

播放步骤：

1. `wisdom-mooc` 若存在 `.chapter-wrapper.hidden`，点 `.collapse-box` 展开后重新取快照，不直接改 class 或 style。
2. 在对应站点的任务条目里找第一条没有完成证据的小节，用快照 `ref` 点击；重新观察当前项确已切换。
3. 用快照中的播放按钮或原生 `video` ref 点击。确认视频处于播放状态后才调用 `browser_watch({ title, ref? })`，然后以 `browser_finish({ status: "watching", ... })` 交给监控。切换标签后可能暂停；回来要重新检查实际播放状态，不能假定后台一直在计时。
4. 默认 `1x`。用户明确要求时最高 `1.5x`；若页面只允许更低速度，以平台限制为准。不得改计时、拖进度、伪造心跳或完成数据。
5. 用户明确以平台完成勾选为切换标准时，当前**叶子小节**出现真实完成标记后即可点下一条未完成小节，不必等待片尾。这是读取平台已经给出的状态，不是把本地进度或父章节图标当作完成。当前目录全部完成后刷新复核，不继续重复播放。

## 课中弹题

### wisdom-mooc / studywisdomh5

重点处理 `.ai-class-exercise-dialog`：

1. 重新取快照，题目选项可能是 `.ques-list .item .option` 或 `.class-question-select`。在用户授权范围内作答；默认只选择确定答案。用户已明确允许自行处理不计分随堂练习时，不必对每道题重复询问；该授权不扩展到作业、考试或交卷。
2. 点 `.dialog-footer button.btn` 提交作答，重新观察回执。实际页面可能自动关闭弹窗；仅看到弹窗消失时，应记录“弹窗已消失”，不能虚构“服务器已提交成功”回执。
3. 如果弹窗仍在且已作答，再点 `.ai-class-exercise-dialog .header-icon`。出现“未作答的弹题不能关闭”说明作答流程尚未完成，不能反复点关闭。弹窗已消失时不要再点原关闭位置，避免误点页面。
4. 再次 `browser_get_page({})`，确认弹窗确实消失；然后用可见播放按钮/视频 ref 恢复播放，确认正在播放后重新 `browser_watch`。
5. 弹窗仍在时重新观察并再尝试正确的关闭 ref；仍失败则 `browser_finish(blocked)` 请求人工处理。禁止删节点、隐藏 DOM 冒充关闭，也不能跳过服务器提交检查。

### studyvideoh5

弹题为 `#playTopic-dialog`。逐页读取题目，选项位于 `#playTopic-dialog ul .topic-item`；只选确定答案。完成后使用弹窗内 `.close-btn` 或真实按钮 ref 关闭，并确认弹窗消失、视频恢复后再 `browser_watch`。

### studyplush5

弹题为 `.ai-test-question-wrapper`，选项在其 `.options .option`，提交按钮为 `.submit-btn .submits`，关闭为 `.close-box`。看到 `.done` 只表示弹题已作答，仍需点关闭并验证恢复播放。

## 学习习惯与掌握度叠层

- `.el-overlay` 内出现“保持良好的学习习惯”时，先读取提示并遵守当天学习时长限制。只有用户明确要求继续且平台允许时，才点该弹窗真实的关闭按钮；否则 `browser_finish(blocked)`。不得用 `display:none` 或删除节点绕过。
- 出现 `.masterylevel-body` 时，用快照中的关闭按钮（参考结构为 `.header-box .close-box`）关闭，再重新观察确认叠层消失。关闭失败就请求人工处理。

## 作业、考试与 AI 掌握度

1. 从课程学习计划进入“作业/考试”可到 `course-homework-list`；从列表点具体未完成项进入 `course-homework-do`。
2. `wisdom-mooc.../study/analysis` 的掌握度页点“去提升”也可能直接进入 `/exam` 作答页。点击后以新网址和图谱节点为准，不把作答页当播放页。
3. 每题先读完整题干、题型和选项。答案不确定、缺图或缺上下文时停止并询问，不编造答案。
4. 暂存、提交作业或交卷都是有外部效果的操作，只能在当前用户明确授权的范围内执行；提交前重新核对题数和未答项。
5. 本手册描述自动化能力，不构成对任何真实作业、考试或答案提交的授权。
6. 某些共享课页面在切到下一题时才保存当前答案，最后一题有单独保存入口；以当前页面回执为准，不要假定点选即已保存。选项顺序可能变化，应按题干和选项内容核对。
7. 旧的 `dohomework` 页面即使仍显示选择控件，也可能已经交卷，点击题号才提示无法继续答题。先检查可见提交状态，已交卷或批阅页只读，不能仅凭 URL 判断可写。提交后从课程首页重新进入列表复核，旧标签的状态可能过期。

## course-qa：课程问答

`qah5.zhihuishu.com/qa.html` 是课程问答页面，操作步骤也可读 `sites/zhihuishu.com/references/qa.md`。先核对课程和帖子，发布后在“我的提问”或“我的回答”复查。页面上显示的发布数量不等于平台认定的有效数量或成绩，具体规则和刷新时间以该课程页面为准。遇到安全验证交用户处理；恢复后先核实上一条是否已经发布，避免重复提交。

## 完成判定

视频以站点真实完成标记和 `browser_watch` 回执为准；作业/考试以页面保存或提交回执为准。无法确认服务器已接受时，报告当前状态与缺口，不得把本地点击或 DOM 变化写成“已完成”。

`wisdom-mooc` 的“课程播放”面板和 `browser_get_state/get_page` 返回的 `study` 只读取目录叶子项、完成图标、当前媒体和随堂弹窗。折叠或尚未加载的目录不能据此宣布整门课完成，应展开各章复核；播放器 `ended` 仅表示当前媒体结束。整门课播放任务结束后，刷新或重新进入课程，确认未完成项为零，再报告页面重新读取到的保存状态。AI 学伴的祝贺消息可能属于上一小节，不能代替当前目录标记。

同一 `/study/index` 网址会切换多个视频。每次换小节、弹题处理后恢复播放，都重新读取当前媒体并挂监控，不能沿用上一节的标题或“已结束”状态。暂时暂停、接近结尾以及客户端进度插值都不代表完成。
