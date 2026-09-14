# Windows 本地测试包

本地测试包基于 `dev-improvements`（版本 2.2.8），包含本 PR 的选项解析修复和构建适配。

## 修复内容

- 无标签选项保留完整正文，包括 `10 kg`、`New York`、`x+y`。
- 小数只跳过编号识别；位于字母或数字标签块内时仍作为正文保留。
- 恢复非 1 起始、非连续数字编号的多行选项兼容性。
- 复用已有全 frame 点击桥，补齐构建缺失的 `clickFrameText` 导出。
- 开发调试桥的截图接口在当前源码中没有实现：截图请求明确失败，状态查询、点击和题目检查保留可用结果，不返回成功的空截图。

## 本地构建

使用 Windows x64、Node.js 24、Rust MSVC 工具链和 Visual Studio C++ 构建工具。在仓库根目录运行：

```powershell
npm ci --no-audit --no-fund
npm test
npm run tauri:build:win:local
```

构建先执行 `vue-tsc --noEmit` 和 Vite，再使用锁定的 Cargo 依赖编译 Rust、生成 NSIS 安装包。默认产物为：

```text
src-tauri/target/release/bundle/nsis/ZError_2.2.8_x64-setup.exe
```

本地配置 `src-tauri/tauri.local-test.conf.json` 仅关闭更新包签名产物的生成，不需要官方私钥。正式发布配置保持原有设置。本包沿用应用标识 `com.zerror.app` 与版本 2.2.8，并复用该应用的数据目录；安装前退出正在运行的 ZError。

## 安装后验证

优先复测原来失败的真实题目，并检查最终返回的选项正文。纯函数测试使用以下固定模型输出验证映射；真实模型是否选择正确答案需要在实际题目中确认。

| 选项输入 | 固定模型输出 | 预期返回 |
| --- | --- | --- |
| `0.3\n0.1\n0.2\n0.4` | `ANSWER: 4` | `0.4` |
| `10 kg\n20 kg` | `ANSWER: 2` | `20 kg` |
| `A. 概率\n0.3\nB. 概率\n0.4` | `ANSWER: 2` | `概率\n0.4` |

`npm test` 覆盖当前源码的选项、提示词、答案还原与浏览器桥返回行为；桥测试使用模拟的 Tauri 调用，不代表真实 WebView2/OCS/模型流程已验收。真实答题和页面勾选由安装后的测试确认。

安装包、构建日志和校验信息可放在已忽略的 `artifacts/`，不提交二进制、账户数据或签名私钥。
