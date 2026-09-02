---
name: 解析器
description: 阅读并改写 Skill 里的页面解析器（注入脚本），保存后立即生效。
---

# 解析器

用户要改页面识别，或刷课/作业同一失败点连续两次时使用。写法见 [references/format.md](references/format.md)。新站点先抄 [references/template/](references/template/)。

学习通解析器按职责拆文件。先读要改的那一组和它的 `contract.md`，不要整包重写。

## 何时改

固定步骤先重试一次。仍失败再动手，只改一组：

| 失败 | 改谁 |
|------|------|
| 空目录、节名对不上 | `chapter.js` / `catalog.js` |
| 播不起来、找不到视频/任务点 | `play.js` / `video.js` |
| 进度不走 | `watch.js` |
| 读不到题、填不上 | `inspect.js` / `parse.js` / `answer.js` |

改完立刻用原来的 `browser_study_*` / `browser_homework` 重试。不要用 `browser_eval` 另写一套，不要改导出键。路由错了去 `site-graph`，不要改解析器。

## 刷课 `parsers/study/`

| 文件 | 改什么 |
|------|--------|
| `chapter.js` | 目录、打开章节 |
| `play.js` | 播放、切任务点 |
| `watch.js` | 进度监控 |
| `captcha.js` | 验证码 |
| `frames.js` | iframe、点击 |
| `catalog.js` | 目录树、节名 |
| `video.js` | 播放器、任务点图标 |
| `contract.md` | 导出键：动作 / 目录 / 监控 |
| `index.js` | 导出键；新增脚本时改这里，并更新顶部 `// files:` |

## 作业 `parsers/homework/`

| 文件 | 改什么 |
|------|--------|
| `inspect.js` | 读题、点标签 |
| `live.js` | 实时监听 |
| `capture.js` | 截图 |
| `answer.js` | 填答案、提交 |
| `frames.js` | iframe、点击、取图 |
| `parse.js` | 题盒、选项、题面 |
| `contract.md` | 导出键：动作 / 读页 / 内部传图 |
| `index.js` | 导出键与 `// files:` |

读：`read_agent_skill_file(chaoxing, parsers/study/play.js)`  
写：`write_agent_skill_file(chaoxing, path, content)`，`content` 是**该文件**全文。保存后热加载。

## 步骤

1. 看失败点属于哪一组，只读那一个 `.js`；需要返回值时读同目录 `contract.md`
2. 分组文件写函数声明；`index.js` 用 `page(fn)` 导出（helpers 按引用自动注入）
3. 新加一组：新建 `parsers/study/xxx.js`，把它写进 `index.js` 顶部 `// files:` 和 `return`
4. 写回后用现有浏览器工具试（`browser_study_*` / `browser_homework`），不要用 `browser_eval` 重写一整套

## 不要做

- 不要把解析器正文贴进对话或写进 `SKILL.md`
- 不要用 `eval` / `new Function` 在页面里再编译一层
- 不要改导出键名，否则刷课/作业工具会对不上
- 作业题面只走 `browser_homework` 题卡
