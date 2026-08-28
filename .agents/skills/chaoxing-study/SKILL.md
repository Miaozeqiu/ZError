---
name: chaoxing-study
description: >-
  Plays unfinished 学习通 (Chaoxing) chapter tasks in the in-app browser:
  open a course, find 未完成 jobs, click the native video player, wait for
  the task point, then advance. Use when the user asks to 自动播放, 刷未完成,
  播章节, 看完这节, or finish Chaoxing chapter tasks.
---

# 学习通章节自动播放

给浏览器 Agent 用。只用当前窗口的 `browser_*` 工具。真正点页面上的播放并等任务点变完成，不要伪造进度、不要改倍速刷完、不要代答测验。

## 怎么进播放页

1. 未登录先按 `chaoxing-login`。
2. 课表：`https://mooc1-1.chaoxing.com/visit/interaction`，课名在 `li.course a.color1`。跨域 iframe 里用 `browser_eval` 点课名，或取出 `href` 再 `browser_navigate`。
3. `chaoxing.page`：`teacher` 教师页不要播；`student`（`/mycourse/stu`）先 `browser_click_text`「章节」，再立刻 `browser_chaoxing_chapters`（目录在跨域 iframe，读不到）。不要点「课程门户链接」。`chapters` 是目录页，`player` 才是播放页。
4. 用户没点名课程时，先列出课名问一句，或列出未完成节再开始。
5. 进到课程壳还不算完成，必须点到具体节并开始播放。

## 先读页面

`browser_get_page` 在学习通域名下会带 `chaoxing` 字段：

| 字段 | 含义 |
| --- | --- |
| `step` | 顶部步骤，如 视频 / 文档 / 章节测验 |
| `quiz` | 当前是测验/考试/作业 |
| `current` | 目录里正在看的节 |
| `next` | 下一节未完成 |
| `unfinished` | 未完成节名 |
| `jobDone` | 当前任务点是否已打勾 |
| `video` | `{ paused, ended, current, duration }`，没有播放器则为 null |
| `iframeTree` | 嵌套 iframe：`src` / `video` / `playBtn`。播放器通常在第二层 |

目录节点：`#coursetree .posCatalog_select:not(.firstLayer)`，当前节带 `.posCatalog_active`，节名 `.posCatalog_name`，未完成常见 `.orangeNew` / `.jobUnfinishCount`。父节（如 4.4）若下面还有未完成知识点（4.4.1），打开子节，不要停在父节点。

## 播一节

播放器不在顶层页面。路径已经探过：

```
studentstudy / #coursetree
  └── #iframe  →  /knowledge/cards
        └── iframe.ans-insertvideo-online  →  /ananas/modules/video
              ├── video#video_html5_api
              └── .vjs-big-play-button
```

1. `quiz` 为真：停下来让用户自己做，不要点下一节假装完成。
2. 到了播放页不要自己找 video、不要写遍历 iframe 的脚本。直接 `browser_chaoxing_play`，再 `browser_chaoxing_watch`。
3. 不要 `browser_wait` 空等整节。监控会在 Agent 面板显示进度，并定时、按进度叫你核对。
4. 被叫到时必须处理：暂停或卡住就 `browser_chaoxing_play`；播放器丢了就再 play 或 `browser_chaoxing_study`；还在播就一句话回报。不要开始播了就闭嘴。
5. 一节可能有多个视频。当前视频播完先切本章下一个视频，全部看完再下一章。系统会自动切，不要一结束就跳下一章。
6. 解析器空或失败时不要说全部完成。自己 `browser_get_page` / `browser_eval` 读目录（「已完成任务点 x/y」、节名旁数字、`.catalog_title`），读到节名再 `browser_chaoxing_study`。只有 n/n 才算做完。
7. 一直没进度就自己恢复，不要死循环，不要问用户手动点。目录在课程壳的 iframe 里，先点「章节」再读。

文档/PPT：不要停在资料节。`browser_chaoxing_next` 会先切本章下一个视频，没有了再跳下一节。测验仍停下让用户做。

## 不要做

- 不要调学习通的进度上报接口、不要 seek 到结尾、不要 16 倍速混过检测
- 不要自动答测验、考试；用户明确说写作业时改用 `chaoxing-homework`
- 不要把「打开了下一节」说成「这节已经完成」
