# Runtime and module boundaries

The application composition root is `src/main.ts`. It installs the workspace command buffer and starts `services/agent/runtime.ts` before mounting Vue. Background watch processing belongs to this runtime. Visiting or leaving a workspace only controls its UI subscriptions. Disposal is idempotent and an obsolete disposer cannot remove a later runtime.

## Browser and website behavior

`services/browser/siteCapabilities.ts` defines the application-owned adapter contract. Generic navigation, page and course tools use this contract. Adapters declare navigation policies, catalog and watch capabilities, and dispatch repository-defined tools. Registration belongs to `services/platform/index.ts`, rather than an import side effect in the browser abstraction layer.

Remote repositories continue to use the existing compiled bundle manifest and QuickJS workflow protocol. Source origin, hashes, resource limits, command validation, tool allowlists, permission checks and isolated credentials remain host responsibilities. Installing an adapter does not grant a repository additional operations.

**Migration status:** local compatibility orchestration and DOM parsers still exist under `services/platform`, `services/chaoxing` and the website tool modules. The adapter boundary separates their dependencies from generic tools; it does not mean all website implementation has moved to Open. Further migration must transfer behavior to the repository protocol and remove the corresponding compatibility implementation, with contract tests for each operation.

## Agent lifecycle

`agent/core/waitEvents.ts` connects wait registration and watch notifications without importing the wait implementation at runtime. Watch callbacks carry a binding generation so deferred notifications and background recovery cannot continue into a replacement runtime.

Static service imports must be acyclic. `scripts/architecture-graph.mjs` analyzes value imports and reexports, ignoring type-only edges. The architecture tests also inspect dynamic imports at generic tool boundaries. Domain-specific implementation is kept out of these generic entry points.

## Workspaces and chat rendering

Each independent workspace loads on its first visit and stays mounted afterward. The command buffer retains the latest unhandled command per workspace and event type, then delivers it once when that workspace subscribes. Commands shared by Agent and Study have separate delivery slots. Credentials are not part of this buffer.

`views/agentChat/useThreadView.ts` owns selection, scrolling and DOM observer cleanup. `utils/ui/threadCodeHighlight.ts` observes changed code blocks and coalesces work per animation frame. Earlier messages are not scanned on every streamed token. Mermaid, D2 and Infographic remain on their own rendering paths.

## Model and skill services

Model configuration keeps its public facade and persistence behavior. Remote catalog reconciliation, selected-model replacement and shared-key policy live in separate modules. The effort matrix painter has its own view composable.

Skill types, configuration storage and GitHub installation are separate modules. The installer receives catalog/configuration callbacks; it does not import the manager singleton. Existing storage names, paths and overwrite rules are preserved.

## Native modules

The existing IPC entry points and public module paths remain facades. CEF browser implementation is split into layout, sessions, tabs, cookies, network, evaluation, interaction and snapshot modules. The browser bridge separates protocol and evaluation. HTTP service separates routing, queries, answers and model execution. The secret vault separates cryptography, credentials and legacy migration. Document, image and font commands have dedicated modules.

Platform cfg guards and browser identity checks remain in force. Storage encryption formats, keychain identity, application identifier and updater identity are unchanged. Local Rust checks cover the current macOS target; Windows and Linux require their respective CI/toolchains.

## Local validation

- `npm test`
- `npm run build`
- `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `npm run rust:check`
- `npm run rust:test`

A native macOS bundle build and production-page smoke checks complement the unit tests. Builds and tests do not publish a release.

## 网课平台逻辑完整迁移方案（实施中）

本方案基于客户端提交 `fa9c4080` 的审计。当前完成的是模块拆分，以及经验正文和部分工作流的远程加载；平台实现完整迁移仍待实施。以下内容是实施目标和验收条件，不代表现有代码已经满足。

实施记录（2026-11-20）：已建立平台代码预算和 CI 检查，并接入 API 2 编译包、动态工具、独立沙箱、原生文档身份及固定 DOM 操作。新增了隔离凭据授权、媒体事件和有界持久检查点，恢复固定原包且先核对实际页面。通用安全表单已脱离旧平台登录处理器。协议、各平台限制及 Open 本地补丁见 [网站运行包 API 2](./website-runtime-v2.md)。真实两站业务和 Rust 平台特例尚未切换；受控网络/题库与三端实测仍待完成，阶段 1 仍在进行。

### 已确认的问题

- `agent/websiteToolDefinitions.ts` 固定列出学习通 14 个、在浙学 3 个工具，新增站点工具仍依赖客户端发版。
- `platform/index.ts` 注册具体平台适配器，`platform/websiteToolDispatch.ts` 按工具名分支导入客户端业务实现。接口形式通用，实际扩展能力仍由客户端决定。
- `agent/chaoxingStartup.ts`、`subagent/runtime.ts` 和完成证据逻辑识别平台名称、工具名、课程地址及平台回执字段。
- `services/chaoxing`、`platform/chaoxing`、`platform/zjooc` 仍含页面解析、定位、视频、作业、讨论和题库对接。部分文件直接加载本地 JS 页面脚本。
- `tools/websiteChapters.ts` 在本机计算预期的下一步，再要求仓库输出与其相同的动作。仓库和客户端各自实现了一份业务决策。
- 原生浏览器仍含课程地址跳转规则、讨论页修复和站点媒体处理。只删除前端平台目录无法完成迁移。
- 现有层边界测试主要检查部分入口的导入路径，无法证明站点实现已经从最终客户端产物移除。

### 责任边界

| 所属 | 持有的代码和状态 |
| --- | --- |
| Agent | 理解用户目标、选择已安装工具、识别验证码图片、处理缺少的信息、判断目标是否满足并向用户反馈 |
| 客户端通用宿主 | 浏览器与 frame 身份、快照和控件引用、输入与媒体操作、事件订阅、凭据引用及安全填写、用户授权、模型与题库服务接口、UI 数据模型、任务检查点、资源释放 |
| 网站仓库 | 网站名称和多域名元数据、页面分类、选择器与 DOM 解析、登录步骤、验证码规则、导航与弹窗策略、播放和恢复策略、章节顺序、测验填答复核、阅读和讨论流程、平台题库协议、站点经验和图谱 |
| Open | 官方目录、来源与版本信息、编译产物分发、完整快照与哈希、完整快照缓存和历史提交供应 |

学习通默认安装、禁止删除属于产品的安装策略，可以保留为数据配置。平台名称、图标、域名及旧数据迁移映射也可以作为元数据存在，但不能携带页面规则、工具执行或业务判断。其他 Open 仓库仍按需安装，支持删除；保留用户现有自定义 HTTP 来源和本地补充。

### 一个站点包覆盖完整实现

继续使用编译产物。站点包以一个不可变版本交付工具定义、运行入口、页面脚本资产、经验和图谱，包含包 ID、修订号、宿主 API 版本范围、资产哈希、域名及所需能力。所有资源属于同一快照，验证成功后整体切换。

工具定义由安装包声明。客户端只验证命名空间、参数与结果 schema、资源大小、包归属和能力授权，不再维护“学习通支持哪些工具”的名单。注册时生成包命名空间，避免不同来源的工具重名。卸载、切换来源和撤销授权后，下一轮目录和实际执行入口同步失效。

独立工具与工作流共用一套执行器。工作流可以在一次工具调用内连续完成已知步骤，返回完成、受阻、等待用户或等待事件的结构化状态。模型仍负责比较工具结果与用户完整目标。脚本回报成功只作为业务结果，不自动结束整个用户任务。

已有工具名称在过渡期由包清单声明别名，并绑定包版本和当前授权。最终客户端不通过旧名称识别站点、播放类型或完成状态。

### 宿主只执行通用操作

沿用 QuickJS 隔离，定义有类型的宿主命令协议，逐步替代 `SiteToolContext = Record<string, any>` 和注入整组函数的做法。第一批命令覆盖浏览器观察、定位与操作、受控页面解析、凭据请求和填写、图片裁剪、媒体状态和事件、受控 HTTP、题库查询、模型请求、UI 进度、检查点及资源释放。

宿主按实际操作检查当前包、浏览器、会话、frame/document 身份、用户授权和来源；命令不能仅凭包自报“只读”跳过写入检查。包声明的能力也不能扩大用户已有授权。普通更新不新增确认步骤，只有实际新增权限时走现有授权流程。

凭据填写返回引用和结果状态，仓库、模型上下文、事件和检查点均不接收真实密码。页面解析接口与凭据填写阶段需要单独验证读取边界。受控 HTTP 按实际目标域、重定向和凭据范围检查，模型及应用题库鉴权由宿主完成。平台的请求参数、响应解析与答案监听规则归仓库。

客户端可以保留文档显示、题目进度等通用 UI 数据结构。平台的题型映射、任务点含义、完成标记和入口定位归仓库。

### 任务、事件和更新生命周期

每个执行实例绑定包版本、任务 ID、浏览器 ID、用户授权范围和取消信号。事件订阅、页面 hook、定时器、请求、沙箱和临时引用登记到执行实例，取消、完成、卸载或关闭浏览器时统一释放。需要跨工具持续运行的订阅归属于宿主中的持久任务实例，不能依赖某个界面保持挂载。

视频结束、登录验证和测验变化通过通用事件恢复原工作流。阶段、等待条件及有界检查点采用可序列化数据，不序列化 JS 闭包、运行中的生成器或原始页面。恢复时使用同一包版本，并重新核对浏览器状态。结果不确定的提交只核对真实状态，不能自动重放。

运行中的任务固定使用启动版本。开发服务重新构建和 Open 更新供新任务使用。新版本故障不替换已验证缓存；工作流已经产生副作用后不能自动换旧版本从头执行。旧缓存缺少所需 API 时明确说明兼容问题，不调用客户端隐藏的旧平台实现。

### 实施顺序

先保留网站仓库当前未提交的用户文档改动，再同步开发基线。审计时本地在浙学仓库落后其远端跟踪分支 4 个提交，实施清单必须在同步后复核。

| 阶段 | 实施范围 | 通过条件 |
| --- | --- | --- |
| 0. 建立迁移清单 | 对每个工具和原生特例登记入口、调用链、目标仓库、共享能力和验收场景；给现有平台业务文件建立明确的临时清单 | 清单覆盖前端、Rust、页面脚本、提示词、注册、完成判断和默认经验；CI 阻止继续新增客户端平台业务 |
| 1. 完成通用执行协议 | 有类型的命令和回执、动态工具目录、能力检查、事件与资源登记、版本固定及恢复协议；Open 分发同一完整编译快照，三端共享协议契约测试 | 同一个客户端安装一个新的本地测试网站包后可注册、执行、等待和卸载工具，客户端无需新增站点分支 |
| 2. 在浙学先迁 | 登录、验证码、播放、题库监听与上传、平台题库登录、查询与模型回退全部迁到 ZError-zjooc | 客户端删除在浙学工具分支、启动特判和题库业务后，通过完整在浙学验收；真实凭据继续隔离 |
| 3. 学习通逐能力迁移 | 先登录与课程作业列表，再章节播放与连续学习，随后作业测验、阅读、讨论和字体处理 | 每个能力启用仓库版本后立即删除对应客户端实现；不累计两套正式实现 |
| 4. 清理原生与完成判断 | 通用宿主承接所需浏览器能力；站点 URL、导航、讨论和媒体策略迁包；完成校验使用通用任务范围与证据引用 | Rust 和通用 Agent 完成路径不依赖平台名称、站点专用工具名、平台选择器或地址 |
| 5. Open 分发与收口 | 按宿主 API 供应完整兼容快照；移除临时清单及 v1 客户端执行器，复核安装、更新、回滚和卸载 | 全新第三方站点接入不修改客户端源码；生产包检查和三平台回归通过 |

阶段 1 的动态加载和执行器必须先通过测试，阶段 2 才切换在浙学。每个学习通能力切换前都有仓库测试和客户端契约测试；切换后立刻删除对应本地分支。先处理依赖最多的协议、凭据和媒体事件，避免迁到一半又需要站点专用宿主命令。

客户端业务临时清单只允许缩小。普通浏览器或 Agent 入口不能新增对该清单的依赖，最终验收时清单归零。平台 ID 元数据、产品默认安装数据和必要的旧数据迁移例外单独列明用途，不用字符串替换或改名绕过检查。

### Open 分发

沿用现有站点端点和 `experience.json`，直接分发唯一的当前编译包。不要新增 `/v2` 路径、版本切换参数、旧版来源或回退流程。包内 `apiVersion` 仅用于格式校验。Open 缓存完整且不可变的提交快照，以同一 revision 进行条件请求。

Open、站点仓库和 dev 客户端共同验证同一份当前运行包，验收后删除本地站点实现。协议字段变化时同时更新 Open 和两站的测试，不另建旧版分发与执行链路。

旧版离线缓存、凭据引用、用户网站多域名设置和本地经验保留原存储语义。兼容转换只处理数据格式，不能继续在客户端执行旧站点业务。官方 HTTP、Open 和手动导入均运行相同验证与执行协议，避免开发模式通过而正式来源失败。

### 验收矩阵

- 登录覆盖已有登录态、退出登录、验证码、验证码重取、错误密码后更正、聊天安全表单、登录后还需列课程等复合目标。
- 播放覆盖静音首次生效、后台预览、暂停恢复、正常播完自动下一节、监控丢失、用户接管、取消和进程重启恢复。
- 章节覆盖已完成目录、编号范围、同名课程、未知任务点，以及 PDF、PPT、图书、章节测验和讨论。
- 作业覆盖批次、范围、冲突、无答案、平台题库要求登录、监听答案、远端查询和模型回退；核对实际填写和提交结果，避免重复提交。
- 证据引用绑定本任务的包、浏览器和文档；伪造完成标记、旧观察或未完成目标不能作为成功依据。
- 插件运行覆盖不兼容 API、损坏产物、版本切换、卸载、撤销授权、来源离线及跨站操作；取消后无挂起等待或后台写入。
- 生命周期覆盖重复安装卸载、开关标签、任务启停和长时间运行；记录堆对象、订阅、任务、请求数与各进程内存，不能只用 RSS 断言泄漏消失。
- 同一协议测试在 macOS CEF、Windows WebView2、Linux WebKitGTK 上执行；站点特性通过仓库做能力检测，通用宿主明确返回不支持。
- 新建一个非内置测试站点包，增加一个新工具和页面分类，通过 HTTP 与 Open 安装并执行。整个过程不修改客户端平台名单、启动规则、工具分支或完成校验。
- 检查生产 JS/Rust 资源与来源映射，确认已删除平台流程没有通过 raw import、默认经验、运行时生成字符串或原生补丁重新进入发布包。旧版迁移数据和测试 fixture 的例外需要逐项说明。

每个能力的完成记录包含客户端删除项、仓库修订、Open 快照版本、契约测试结果、真实网页验证和三平台能力结果。仅把文件移入 adapter、把选择器换个目录、增加从未执行的远程入口，都不能标记为迁移完成。
