# 网站云端经验与本地补充

客户端默认配置学习通的 Open 来源，学习通禁止删除。Agent 遇到尚未安装经验的网站时，读取 Open 的 `GET /v1/website-experience` 目录，在本地按域名匹配，仅安装命中的官方仓库。已安装的 Open 仓库通过 `GET /v1/website-experience/<host>` 检查版本，更新时保留本地补充。在浙学、智慧树等其他 Open 仓库可从网站右键菜单删除；删除后会跳过自动安装，仍可手动重新导入。桌面端启动时、恢复网络后和运行期间每六小时检查已安装的来源。

## 导入格式

在仓库根目录、`skills/<id>/` 或 `.agents/skills/<id>/` 提供 `website.json`：

```json
{ "version": 1, "id": "zjooc", "name": "在浙学", "host": "zjooc.cn", "icon": "assets/icon.ico" }
```

同目录必须有 `SKILL.md` 和 `site-graph.json`。Skill 的 name、图谱 id 与网站 id 一致，图谱 host 与网站 host 一致。图标必须在仓库内 `assets/` 下，支持 PNG、ICO、JPEG、WebP、GIF，最多 256 KiB；验证文件哈希、真实图片格式和原生解码，不接受外链、SVG 脚本或 HTML 错误页。图标单独缓存，不混入 Agent 的经验正文与模型上下文。

用户在「设置 → Agent → 网站 → 导入 GitHub 仓库」填写 `owner/repo`、仓库首页链接或 `tree/<分支>/skills/<id>` 链接。程序发现候选网站后展示名称、域名与仓库内图标，用户确认后按预览时的提交 SHA 导入完整快照；多个网站包可选择。默认分支从 GitHub 元数据读取。目录链接的带斜线分支名暂不支持，可使用仓库首页链接发现。

预览不落盘，导入前下载和验证完整快照。既有同一来源可更新；相同域名关联了另一来源时拒绝静默替换。导入不会自动关联登录域名、授权凭据或修改账号。旧的单站加密文档会迁为多站索引，保留学习通原分支；跨网站写入通过共享队列串行持久化，避免丢失另一站的修改。

## 读取

Open 以提交为单位同步官方仓库并校验 Git blob 哈希。客户端通过 `/v1/website-experience/<host>` 读取快照。手动导入其他仓库时，客户端通过匿名 HTTPS 下载并校验 Git blob 的大小、哈希和内容。两条路径都检查入口及导航图谱结构。只接受 `SKILL.md`、`site-graph.json`、`references/<名称>.md`，拒绝路径穿越、符号链接、可执行文件、截断目录和超限文件；任一文件失败都不替换原缓存。

快照最多 32 文件、每文件 512 KiB、合计 2 MiB。原生客户端优先使用已经完整加载的缓存，后台最多每六小时检查一次，使用 ETag 减少重复下载；用户可以手动检查更新。超时、限流或断网时保留完整缓存，遵守服务返回的重试时间，不循环重试。首次打开时等待 Open 返回经验。没有有效缓存且 Open 不可用时，设置显示尚未同步，并保留本地补充。

## 用 HTTP 接口调试

在「设置 → Agent → 网站 → 网站设置」填写「网站经验 HTTP 地址」。使用完整的 HTTP 或 HTTPS 地址，例如 `http://127.0.0.1:8080/experience.json`。客户端向该地址发送 GET 请求，验证整个快照后启用自定义来源。清空地址并保存即可恢复默认来源。

接口使用与 Open 相同的 JSON 结构。

| 字段 | 内容 |
| --- | --- |
| `website` | `website.json` 的内容，`id` 和 `host` 必须对应当前网站 |
| `files` | 以相对文件名为键、文件的 UTF-8 文本为值的对象，至少包含 `SKILL.md` 和 `site-graph.json` |
| `icon` | `{ "path": "assets/icon.png", "dataUrl": "…" }`。`path` 与 `website.icon` 一致，`dataUrl` 包含图片的 Base64 数据 |
| `revision` | 可选的版本字符串，开发服务器也可以使用固定值。软件比较快照内容以识别改动 |
| `tools` | 可选的站点工具定义。客户端校验名称与站点，只注册宿主支持的操作 |
| `scriptManifest` | 可选的同源脚本清单地址，例如 `./script-manifest.json` |

静态 JSON 文件和动态接口均可使用。打开经验详情时，客户端会自动检查自定义来源的更新。接口不可用时继续使用该地址的最后一份有效快照。本地补充单独保存，切换地址时保留。

### 网站脚本

以下为现有 v1 实现。新的动态编译包、宿主命令与迁移限制见 [网站运行包 API 2](./website-runtime-v2.md)。旧版固定工具仍待迁移，不能将远程经验加载视为业务已完全外置。

经验接口通过 `scriptManifest` 声明脚本清单。选用来源后，Agent 调用相关工具时自动加载脚本。学习通使用 [ZError-chaoxing 的开发服务](https://github.com/Miaozeqiu/ZError-chaoxing)，默认接口为 `http://127.0.0.1:8817/experience.json`。从网站仓库运行 `npm ci` 和 `npm run dev` 即可监听 TypeScript 变化。

官方仓库通过 `site-tools/tools.json` 发布工具定义，并从同一 Git 提交的 `site-tools/*.js` 发布脚本。客户端按站点加载工具，切换经验来源或删除仓库时更新可用工具。脚本接收有限的观察数据，在隔离运行时返回站点决策。浏览器原语、凭据读取、页面授权校验和提交确认由客户端执行。

脚本清单包含 `apiVersion: 1`、`siteId`、`revision` 和 `bundles`。每个脚本条目包含 `url` 和 `sha256`。客户端在工具调用前用 ETag 检查新版本，并校验与已配置源同源的 JS 产物。新版本验证失败时，可使用当前进程中上次成功执行的版本。

学习通脚本提供 `browser_list_courses`、`browser_open_course`、`browser_list_homework` 和 `browser_open_homework`。脚本在独立的 QuickJS 运行时处理名称和临时索引。ZError 从真实课表及分页的作业列表采集数据，唯一匹配后打开页面，并返回核对过的落地页快照。

课程作业进入「开始作答／继续作答」后的页面后，查看题目和当前作答用 `browser_review_homework`，填写用 `browser_answer_homework`，每批最多八题。两者都接受 `question_range: {"start":1,"end":5}`，按网页显示题号限定范围，续批的 `nextOffset` 相对于该范围。宿主只从本地题库查精确且未待修正的非 AI 答案，验证脚本映射后填写并读回。缺题、冲突、图片、字体混淆及不支持的控件交给 Agent。Agent 核实后可用 `answers` 补填范围内的指定题，已有冲突答案会保留。保存和提交走原有授权流程。

ZError 的宿主回调 `onHomeworkProgress(update)` 自动接收作答和复核进度。`update` 包含 `assignmentId`、`total`、`phase`（`read` 或 `result`）和本次更新的 `questions`，每题带网页实填值 `actual` 和处理状态 `status`。在应用内浏览器打开课程作答页时，宿主也会只读采集题目和当前作答，并在浏览器有输入变化时同步。Agent 的「题目」面板在首次收到题目时打开，同一作业的后续更新按题合并。网站脚本的输入输出协议无需变化。

## 本地补充

软件把云端正文与本地补充组合成一份经验，预览和 Agent 读取的都是组合后的内容。每个网站只有一份简短的 Markdown 补充笔记，通过「本地经验」编辑。旧的本地参考笔记按原文件名归入同一份笔记。导航图谱在云端图谱上加入本地节点、节点字段和连接。同步刷新云端缓存，本地补充留在当前设备。

两类数据仍保存在系统密钥保护的 `website_repositories` 加密文档中。升级会将旧的本地改动与其保存的基准比较，提取新增或改写的正文、节点和连接。旧的本地覆盖文件首次迁移后保留原文件，迁移标记防止清除补充后再次导入。

Agent 写入时传入读取结果中的 `repository_version`，用于避免并发覆盖。`site-learn/sites/chaoxing.com/...` 仍指向同一个学习通经验文件。下载与本地写入可以并行，保存云端缓存时会保留当时最新的本地补充。

在学习通学生端打开目标小节后，`browser_review_chapter` 读取当前章节、页签和任务点。`browser_complete_chapter` 使用 `chapters` 脚本按网页顺序选择下一项，宿主核对章节及控件后执行。视频由原页面播放器和监控处理，主 Agent 会直接等待视频事件。遇到测验或文档，Agent 从当前网页继续操作并复核。脚本只收到任务类型和进度，不读取题目正文，目录待完成数为 0 或显示「已完成」时可核对本章完成。整门课的章节任务用 `browser_open_pending_chapter` 直接定位待完成小节。

学习通章节任务优先用 `browser_start_chapter_tasks`。传入课名后，工具会在一次调用中打开学生课程、选出待完成小节并启动页面播放器。已在目标小节时可传 `current_only=true`。
