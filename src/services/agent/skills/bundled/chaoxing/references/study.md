# 学习通刷课 / 章节任务

刷课必须调用 `browser_study_chapters` / `browser_study_play` / `browser_study_watch` / `browser_study_next`。解析器不注入页面，`eval window.__study_play` 一定失败。不要 click_text「下一节」代替 `browser_study_next`，不要自己点播放器。

推荐顺序（只有这些工具没数据时，才 get_page / screenshot 探路；播放页禁止 eval）：

0. 导航页先开 https://i.chaoxing.com，已登录进空间再点课，不要先走登录页。
1. 进课停在课程壳「任务」页签时，点侧栏「章节」（仍是课程节点，不是换页）。
2. `browser_study_chapters`（读 studentcourse 目录）。
3. 有未完成 → 看 `jobs` 用 `videoIndex` / `label` 指定任务点再 `browser_study_play`（须进 studentstudy）。不要裸 play 让系统挑视频。
4. play 确认在播且 URL 含 studentstudy → `browser_study_watch` → `browser_wait`。面板出现测验 / 本节任务点清完 / 卡住 / 验证码会结束 wait。进度看面板/watch，不必 `chapters` 轮询。用户说继续时先看【解析面板】：jobs 带「暂停」就 play。

## 两套「章节」别混

- **课程壳 · 章节页签**（`mycourse/stu` + 侧栏「章节」）：只列未完成节名。
- **章节播放页**（`studentstudy`）：真正视频 / 本节测验。只有这里才能 play / watch。
- 课程壳上的任务/作业页签 ≠ 播放页；章节里夹带的测验也不是独立「作业作答」页。

解析面板只覆盖课程壳「章节」目录和播放页。这两页优先 `browser_study_*`。面板为空或对不上时，用 `get_page` / `screenshot` / `eval` 看目录，同一失败两次再改图谱或对应解析器。空间、登录、作业名单等其他页，`get_page` / `eval` 仍是看页的方式。

## 不要

- 面板已有目录/任务点时，仍用 get_page 自己扒节名（对不上再探路）
- 停在「任务」页签却直接 study_play
- 已经在 `studentstudy` 再点侧栏「章节」
- 点「第N章」标题（会折叠目录，不是进播放）
- `navigate` 打开 `knowledge/cards` / `ananas`
- play 超时或「还没读到」当成资料去 next
- 把「监控视频」写成 todo
- 本节测验做完回作业列表（应 `browser_study_next`）
- `browser_eval` 里写 `iframe.contentDocument`

## 失败两次

仍空目录 / play 找不到播放器：判断是路由还是解析。路由 → `site-graph`；结构变了 → `parser` 只改 `helpers.js`（认节/任务点）或 `catalog.js`（读树）。不要整包重写。改完按上面推荐顺序重试。

## 其它

- 点「章节」只切课程壳中间的目录 iframe。进播放再点节名（1.1、带橙色数字）
- 播放页是两层 iframe：`studentstudy` → `knowledge/cards` → `ananas/video`；play/pause 已递归进帧，不要自己扒 iframe
- 同一节多个视频经常**没有**「视频1/视频2」页签，而是 cards 里叠着的 `.ans-attach-ct.videoContainer`（靠 iframe `mid` 区分）。切视频必须带 `videoIndex` / `label` / `mid`；裸 play 只播当前条。切失败不要当成已经切过去。
- 点节（只在 play 没打开时）：短名 `函数（一）`，不要带 `1.1`
- 先看返回的 `thisSection.jobs`：`done=true` 是已完成任务点，不要再 play / watch。要播哪个用 `videoIndex` / `label` 指定，不要裸 play 指望系统挑。目录 `unfinished` 只表示该节还有未完成点（比如只剩测验），不要当成视频没做完
- 本节视频都已完成、只剩测验：刷课默认跳过。不要 homework / fill。立刻 `browser_study_next`（只打开下一节，不自动播）。用户明确说做测验才 `browser_homework`
- 切章、点面板节名、播完监控都不会自动点开视频。要播哪个用 `browser_study_play({ videoIndex / label })`
- 一节多视频用 `browser_study_play({ videoIndex: N })`
- 切节、切任务点、9010 验证码、本节测验都在播放页，不是新页面
- 刷课遇到章节测验：默认 `browser_study_next` 跳过，不要回作业列表
- 【9010】：`browser_captcha` 后再 play
- 任务点 n/n 且没有未完成才 `finish(done)`
