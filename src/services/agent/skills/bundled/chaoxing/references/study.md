# 学习通刷课 / 章节任务

固定四步，不要探路。

1. 课程壳点「章节」。
2. `browser_study_chapters`。空/`waiting` 再调一次。禁止 get_page / eval / get_state。
3. 有未完成 → **立刻** `browser_study_play`（它会自己打开第一节）。不要 `open`、不要 click 节名、不要再点「章节」。
4. play 确认在播 → `browser_finish(watching)`。不要 `watch`、不要 todo、不要 get_page。

## 禁止

- get_page / eval / wait 找目录或播放器
- 已经在 `studentstudy` 再点「章节」
- play 超时或「还没读到」当成资料去 next
- 把「监控视频」写成 todo

## 失败两次

仍空目录 / play 找不到播放器：判断是路由还是解析。路由 → `site-graph`；结构变了 → `parser` 只改对应分组。不要 get_page 探路，不要整包重写。改完按上面四步重试。

## 其它

- 点节（只在 play 没打开时）：短名 `函数（一）`，不要带 `1.1`
- 一节多视频用 `browser_study_play({ videoIndex: N })`
- 章节测验失败再用 `browser_homework`，然后 next
- 【9010】：`browser_captcha` 后再 play
- 任务点 n/n 且没有未完成才 `finish(done)`
