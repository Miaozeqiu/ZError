# 刷课导出契约

导出键名不要改。`page()` 按引用自动注入 helpers。入参由 `studyScript(key, ...args)` 传入。失败带 `ok: false` / `error`。`page` 常见值：`login` / `player` / `chapters` / `captcha` / `other`。

## 动作

| 键 | 入参 | 成功时 |
|---|---|---|
| `inspect` | 无 | `{ page, chapterId, step, quiz, jobDone, steps, videoCount, videoIndex, moreVideos, current, next, unfinished, iframes, chapterListUrl, video }`；非学习通返回 `null` |
| `openChapter` | `(title, id?)` | `{ ok, title, via }` |
| `clickTab` | 无 | 点章节/任务点条 |
| `play` | 无 | `{ page, clickedPlay, clickedCover, hasVideo, paused, ended, current, duration, ready, src, step, frameCount }` |
| `clickVideoTab` | 无 | `{ ok, already?, step, videoCount, jobDone? }`；测验 `{ ok: false, quiz: true }`；本节视频完 `{ ok: false, done: true }` |
| `clickStep` | `(want)` 字符串/数字或 `{ label, mid, jobid, videoIndex, index }`，`index` / `videoIndex` 从 1 起 | `{ ok, already?, step, video, quiz, doc, videoIndex }` |
| `nextStep` | 无 | 下一未完成视频 `{ ok, step, more, chapterDone }`；碰到测验 `{ ok: false, quiz: true, opened }`；本节完 `{ ok: false, chapterDone: true }` |
| `captchaCheck` | 无 | `{ captcha, message? }` |
| `captchaImage` | 无 | `{ captcha, image?, pending?, src? }` |
| `captchaRefresh` | 无 | `{ ok }` |
| `captchaFill` | `(code)` | `{ ok, code }` |

## 目录（先装再读）

同一份 `window.__ZE_CHAPTERS__`。读缓存用 `tick`，不要再加 `read`。

| 键 | 入参 | 成功时 |
|---|---|---|
| `install` | 无 | 挂上目录监听 |
| `hook` | 无 | 扫一遍并写入缓存：`{ url, page, current, progress, unfinished, unfinishedCount, chapters, ts }` |
| `tick` | 无 | 读缓存，没有则 `null` |
| `refresh` | 无 | 立刻重扫；未安装时 `{ needInstall: true }` |

## 播放监控

| 键 | 入参 | 成功时 |
|---|---|---|
| `videoHook` | 无 | 绑监听并返回当前视频快照，或 `{ hooked: true, hasVideo: false }` |
| `videoTick` | 无 | 视频快照或 `null` |
| `jobTick` | 无 | `{ jobs, video, ts }` |
