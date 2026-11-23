# 构建分包与已发布应用身份

ZError 已发布版本使用 `com.zerror.app`。这个值同时关系到应用身份、WebView 数据目录和 macOS 钥匙串授权；Windows 安装器与更新配置也必须与已有安装保持一致。保留 `identifier`、`productName`、CEF Helper 标识符、稳定签名要求、更新公钥和更新地址。

Tauri CLI 会对所有以 `.app` 结尾的标识符输出建议。这是一个后缀检查，不是构建校验失败。Apple 的 [CFBundleIdentifier 文档](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier) 规定了标识符格式及其与偏好设置、Launch Services 和签名的关系。

项目统一使用 `scripts/tauri-cli.mjs` 调用上游 CLI。该入口只把已发布标识符对应的完整后缀建议转成可见的 `Info [compat]` 说明，保留其他诊断和失败退出码。`npm run tauri`、签名构建脚本及三平台 CI 均经过此入口。直接运行上游 CLI 仍会输出原建议；不要仅为消除该提示更改已发布应用身份。

Mermaid 的上游解析器将协议依赖、解析器运行代码和全部语法 JSON 合并到同一个文件。`scripts/vite/mermaidParser.ts` 恢复这三个模块的边界，保持原有延迟加载与所有语法。这里不使用网络资源、不改变语法数据、不提高 Vite 的体积阈值，也不排除图表类型。

分包插件检查协议模块没有反向依赖，并拒绝解析器对导入绑定重新赋值；上游布局变化时构建失败，避免静默生成错误代码。回归测试比较所有 15 种解析器的语法树与错误信息，生产包另做实际 SVG 渲染验证。

本地检查使用 `npm test` 和 `npm run build`。原生构建使用 `node scripts/tauri-cli.mjs build`，沿用现有 CEF、签名和 updater 配置。本地构建测试时可通过配置将 `bundle.createUpdaterArtifacts` 设为 `false`，不改动正式配置和更新密钥。
