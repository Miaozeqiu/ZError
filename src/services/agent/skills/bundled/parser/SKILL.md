---
name: 解析器
description: 阅读并改写站点解析包（helpers / parse / locate），保存后立即生效。
---

# 解析器

用户要改页面识别，或刷课/作业同一失败点连续两次时使用。写法见 [references/format.md](references/format.md)。新站点先抄 [references/template/](references/template/)。

学习通解析器按职责拆文件。先读要改的那一组和它的 `contract.md`，不要整包重写。

## 何时改

固定步骤先重试一次。仍失败再动手，只改一组：

| 失败 | 改谁 |
|------|------|
| 空目录、节名对不上 | `helpers.js`（认节）+ `catalog.js`（本地读树） |
| 播不起来、找不到视频/任务点 | `helpers.js`（认播放器/任务点）；点选在 `locate.js` |
| 进度不走 | CDP 读 `video.currentTime` |
| 读不到题、填不上 | `helpers.js`（认盒/选项）；题面在 `parse.js`，点选在 `locate.js` |

改完立刻用原来的 `browser_study_*` / `browser_homework` 重试。路由错了去 `site-graph`。面板空或要验证选择器时，可以用 `browser_eval` / `get_page` 探路一次；不要用 eval 长期替代解析器。有卡时工具会拒绝 get_page。

## 刷课 `parsers/study/`

| 文件 | 改什么 |
|------|--------|
| `helpers.js` | 节 / 任务点 / 播放器（读和做共用，只改这里） |
| `catalog.js` | 目录树、节名（本地跑，不注入） |
| `locate.js` | Handle → 切章 / 任务点 / 播放 |
| `contract.md` | 不再导出注入键 |
| `index.js` | `// files:` 清单 |

## 作业 `parsers/homework/`

| 文件 | 改什么 |
|------|--------|
| `helpers.js` | 题盒、选项、按钮（读和做共用，只改这里） |
| `parse.js` | 题面、名单（本地跑，不注入） |
| `locate.js` | Handle → 点选 / 填空 / 暂存 / 提交 |
| `capture.js` | 题盒截图 |
| `contract.md` | 导出键与 Handle |
| `index.js` | `// files:` 清单 |

读：`read_agent_skill_file(chaoxing, parsers/study/helpers.js)`  
写：`write_agent_skill_file(chaoxing, path, content)`，`content` 是**该文件**全文。保存后热加载。

新站写到 `site-learn` 的 `sites/<host>/parsers/<role>/`。

## 步骤

1. 看失败点属于哪一组，只读那一个 `.js`；需要返回值时读同目录 `contract.md`
2. 分组文件写函数声明。`index.js` 只写 `// files:`，不要再写 `function (page)` / `page(fn)`
3. 新加一组：新建文件，把它写进对应 `index.js` 顶部 `// files:`
4. 写回后用现有浏览器工具试。探路可以用 eval，不要用 eval 重写一整套长期流程

## 不要做

- 不要把解析器正文贴进对话或写进 `SKILL.md`
- 不要用 `eval` / `new Function` 在页面里再编译一层
- 不要整包重写。同一失败两次只改 helpers 或 locate
- 作业题面只走 `browser_homework` 题卡
