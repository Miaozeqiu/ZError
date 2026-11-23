# ZError CLI

安装包包含原生控制台程序 `zerror-cli`。不需要另外安装 Node.js、Python 或 Rust。CLI 连接同一用户的桌面进程；软件未运行时会尝试启动同一安装目录的 ZError。浏览器和 Agent 使用桌面软件已有的运行时、配置和数据。

## 安装命令

Windows 安装结束时自动创建 `%LOCALAPPDATA%\ZError\bin\zerror.cmd` 并加入当前用户 PATH。Linux DEB 安装后可直接运行 `/usr/bin/zerror`，无参数仍打开桌面软件。macOS 拖拽安装和 Linux AppImage 在首次启动时自动创建 `~/.local/bin/zerror` 并配置用户终端；软件更新后自动检查修复，不覆盖其他同名命令。

已经打开的终端需要重新打开，之后可直接运行：

```sh
zerror --help
```

macOS / Linux 自动配置支持 zsh（含 ZDOTDIR）、bash 的登录和交互配置，以及 fish（含 XDG_CONFIG_HOME）。配置使用独立标记块，保留原有内容，重复安装不重复追加。Windows 只更新用户 Path，保留现有项目和 `%变量%`，不修改系统 Path。

若命令不可用，在「设置 → 常规 → 命令行」点击「修复命令行」，或直接运行安装目录的 `zerror-cli cli install`。macOS 的程序位于 `ZError.app/Contents/MacOS/zerror-cli`；Linux AppImage 可运行 `./ZError.AppImage cli cli install`。AppImage 启动器保留原始 AppImage 路径，移动文件后重新打开软件即可修复。开发构建不自动接管正式安装的命令，可以通过上述入口手动配置。

## 常用命令

```sh
zerror status
zerror app show
zerror config get
zerror config set theme '"dark"'
zerror config set network.serverPort 3000
zerror config set search.enabled true
zerror models list
zerror models select --json '{"id":"模型ID","role":"agent"}'
zerror accounts list
zerror websites list
zerror websites install --json '{"url":"https://网站域名/"}'
zerror server start
zerror folders list
zerror questions search --json '{"keyword":"商业伦理","page":1,"pageSize":20}'
zerror agent run "搜索本地题库，解释商业伦理的主要概念" --wait
zerror agent list
zerror agent status 对话ID
zerror agent stop 对话ID
zerror browser list
zerror browser open https://example.com
```

`config set` 支持主题、语言、保存开关、题目显示、模型超时与重试次数、网络端口与局域网开关，以及搜索供应商和密钥等常用设置。窗口布局、账号、模型和仓库等有独立数据结构的设置通过各自命令管理。设置成功返回前会等待安全存储写入完成，桌面界面同步更新。界面自动保存和 CLI 共用文档写入队列；写入期间发生的其他修改会保留，同字段的较晚界面修改优先，并在回执前持久化。

所有参数 schema 可通过 `zerror methods` 查询。`zerror call 方法 --json …` 与上述命令使用同一个接口，不允许任意调用内部 Tauri IPC 或执行宿主代码。PowerShell 下建议通过标准输入传入 JSON，避免命令行引号的差异。

## 模型与账号

密钥、账号和密码只接受 `--json -` 从标准输入读取，不接受命令行中的真实凭据。可由密码管理器或自己的交互脚本生成 JSON，再写入 CLI 的标准输入。

`models add` 的 JSON 结构：

```json
{
  "name": "我的供应商",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "由标准输入传入",
  "protocol": "openai-chat",
  "model": {"modelId":"模型名称","supportsTools":true,"maxTokens":8192}
}
```

使用已有自定义供应商时，传入 `platformId` 和 `model`。`models key` 接受 `platformId`、`apiKey`；`accounts set` 接受 `host`、`account`、`password`；搜索密钥使用 `config set --json -`，输入结构为 `{"key":"search.tavilyApiKey","value":"由标准输入传入"}`。

凭据写入原有系统安全存储，模型和工具获得的仍是受域名限制的引用。CLI 默认不输出真实凭据，`accounts list` 只报告配置状态。需要系统凭据授权时，先在软件中完成解锁。

## Agent 和工具

`agent run` 默认立即返回对话 ID 和本轮 `messageId`；可用 `--session 对话ID` 继续已有对话。忙碌对话会拒绝新任务，不会打断正在执行的内容。`agent status 对话ID --message 消息ID` 和 `agent stop 对话ID --message 消息ID` 只查询或停止指定任务，已结束的任务不会误停后续任务。`--wait` 按这两个标识每半秒查询状态，默认最长等 600 秒；`--timeout 秒数` 可调整等待时间。等待超时或关闭终端不会停止任务，需要停止时使用 `agent stop`。

```sh
zerror tools list --json '{"url":"https://网站域名/"}'
zerror tools run --json '{"name":"list_folders","args":{}}' --wait
zerror tools run --json '{"sessionId":"浏览器所属对话ID","name":"browser_get_page","args":{}}' --wait
zerror tools result 对话ID
```

`tools run` 直接执行指定工具，不需要模型先决定调用。它仍创建对话内任务，并复用工具 schema 校验、策略、凭据隔离、用户接管、执行预算和操作回执。网站业务能力由已安装的 Open 编译包提供；内部 `browser_package_read/act` 不对 CLI 开放。需提交审批、登录输入或验证码处理的任务会在软件中继续，`agent status` 返回相应等待状态。

`browser open` 返回标签 ID 和所属对话 ID，后续工具调用传入该 `sessionId`。先读取页面，再使用快照中的 ref 或已观察到的目标进行操作；写入结果须重新读取核对，异常回执不得直接重试。`agent status` 为有限长度的近期消息预览；完整快照或截图使用 `tools result` 获取，超过接口大小限制时会明确报错。

## 数据与删除

题目和文件夹使用原有数据库接口，列表支持分页，每页最多 200 条。添加题目：

```sh
zerror folders add --json '{"name":"我的题库"}'
zerror questions add --json '{"content":"题目","answer":"答案","folderId":123}'
zerror questions update --json '{"id":456,"answer":"更新后的答案"}'
zerror questions delete --json '{"id":456,"confirm":true}'
```

删除要求显式 `confirm:true`。网站删除会清除该网站的本地配置、账号和经验；必需的默认仓库仍禁止删除。`models platform_remove` 删除自定义供应商及其模型，远程供应商受保护。`agent remove` 删除对话并释放对应浏览器。

## 输出与本机接口

业务命令的标准输出是一条 JSON：成功为 `{"ok":true,"result":…}`，失败为 `{"ok":false,"error":…}`。`--help` 和 `--version` 输出供人阅读的文本。退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | 命令行参数错误 |
| 3 | 无法连接或启动软件 |
| 4 | 操作失败、任务失败、停止或受阻 |
| 5 | 等待任务超时，任务仍可能运行 |

`--no-start` 只连接正在运行的软件。连接断开、请求超时或主界面重载后，操作可能已执行；CLI 不自动重放这类请求，应先查状态。

CLI 接口独立于题库 HTTP 服务。每次启动只绑定随机的 `127.0.0.1` 端口，使用随机凭证；连接文件在用户目录内由权限或 Windows ACL 保护。带浏览器 Origin / Fetch Metadata 的请求会被拒绝，凭证和请求内容不会通过广播事件发送给网站页面。只有可信主 Webview 能领取请求和返回经过安全存储脱敏的结果。

## 开发验证

```sh
npx vitest run testdata/cli
npx vue-tsc --noEmit -p testdata/cli/tsconfig.json
bash scripts/cargo.sh test --offline --lib --bin zerror-cli
npm run build
# 软件启动后，通过真正的原生 CLI 验证。使用本地模型与网页，不请求付费模型；测试记录会清理。
node scripts/test-cli-installed.mjs /绝对路径/zerror-cli
# 使用隔离的 Agent / 用户目录验证 Open Skill 安装与升级
node scripts/test-cli-skills.mjs /绝对路径/zerror-cli
```

构建时 Tauri 自动编译并打包额外的 `zerror-cli` Cargo binary。它独立于 GUI 主库，不加载 CEF。macOS、Windows 和 Linux 使用相同协议，仍需各平台安装包与桌面环境来运行对应浏览器功能。

## 代码边界

`src/services/cli/contracts.ts` 定义 schema 并推导参数类型，`commands.ts` 只负责完整的处理函数注册、请求验证与调度，领域实现位于 `handlers/`。配置写入由原有设置、模型和账号管理器持有，统一经过 `security/documentPersistence.ts`；CLI 不再另行读写这些文档。模型回合和 CLI 直接调用工具共用 `agent/chatToolContextFactory.ts`。

原生客户端入口保留在 `src-tauri/src/cli/client.rs`，参数解析、HTTP/连接权限、安装/启动、指定任务等待分别放在 `client/args.rs`、`transport.rs`、`platform.rs`、`wait.rs`。等待时遇到缺失或不匹配的任务标识会报错，不回退到对话的最新消息。

## 外部 Agent 的 Skill

通用 `zerror` Skill 由 Open 独立分发，源文件位于 `ZError-Open/open-api/agent-skills/zerror`，不与网站经验或网站业务运行包混用。它教外部 Agent 发现 CLI 方法、直接调用工具、等待准确的任务，以及使用原有凭据和审批流程。

```sh
zerror skill install --agent codex
# 也支持 claude、cursor、pi、opencode、shared
zerror skill install --dir /其他Agent的/skills
zerror skill list
zerror skill check
zerror skill update
# 可限定一个安装位置
zerror skill update --agent codex
# 此安装改为手动更新；重新 install 不带该选项可开启自动更新
zerror skill update --agent codex --no-auto-update
```

设置 → 常规 → 外部 Agent 提供“复制安装语句”，将语句发送给目标 Agent 后，由它识别自身类型、执行安装并读取 Skill。软件界面不再直接安装或更新 Skill。`shared` 对应 `~/.agents/skills`，Codex 尊重 `CODEX_HOME`，OpenCode 尊重 `XDG_CONFIG_HOME`。`--dir` 指向 skills 根目录，实际安装到其下的 `zerror/`。安装和升级无需启动 GUI；软件运行时每六小时检查一次已登记的自动更新安装。`skill sync` 执行同样的到期检查，`skill update` 则立即检查。

Open 提供 `/v1/agent-skills`、`/v1/agent-skills/zerror` 以及 `/v1/agent-skills/zerror/SKILL.md`。发布包包含独立语义版本、CLI 协议要求、全部文本文件与 SHA-256。CLI 验证清单和内容，只从 HTTPS 来源下载（环回 HTTP 供本地测试），不接受重定向、路径逃逸或跨平台重名路径。`--source` 可指定可信 Open 镜像或本地测试服务，已登记安装不能换源覆盖。

安装记录位于 CLI 用户私有目录和 Skill 内的 `.zerror-skill.json`。更新有进程锁、暂存和备份恢复；不降级，不接受相同版本号的不同内容。存在本地修改、额外文件、空目录或符号链接时会保留并报错，原有同名非托管 Skill 也不会被替换。SHA-256 用于校验完整性，来源信任仍依赖 HTTPS 和所选仓库。Skill 不含账号、密钥或自动授予操作权限。

安装文件后是否即时发现由宿主 Agent 决定；必要时使用其重载操作或新会话。这不代表当前会话已经热加载新版指令。
