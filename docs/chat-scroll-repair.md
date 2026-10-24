# macOS 聊天滚动

主界面使用 WKWebView。Chromium 中的测试只能验证组件逻辑，不能证明 macOS 原生事件转换正确。

## 输入处理

`src-tauri/src/macos_wheel.rs` 在应用内部安装 NSEvent local monitor，仅匹配主 WKWebView 内的目标视图。CEF 浏览器、其他窗口及原生控件不经过此适配。

- 精确滚动、手势 phase、惯性 momentum、已连续化的事件原样放行；苹果鼠标和触控板的精确输入保持系统处理。
- 仅对离散滚轮输入分帧，按实际时间衰减剩余距离。普通滚轮距离倍率为 1.3（用户要求调快）；精确输入在此之前已原样放行。反向滚动立即取消旧方向尾部。
- 复制原事件保留窗口关联，再从 CoreGraphics Pixel 构造器复制完整滚动字段（含 fixed-point），并校正 NSEvent 窗口坐标；不能只修改 continuous 标记或直接使用没有窗口关联的新事件。
- 修饰键组合及减少动态效果模式保持原生。鼠标按键、键盘输入、目标视图变化会取消待发送的尾部。
- 鼠标轻微移动不取消已经接收的滚轮距离；同一目标视图内移动时更新事件位置，仅在目标改变或明确打断操作时停止尾部，避免手握鼠标产生位移后丢失滚动输入。
- 不使用全局事件监听/注入，不需要辅助功能、录屏或录音权限。识别的是输入事件性质，而不是设备品牌。

## 自动跟随

`src/utils/ui/threadScroll.ts` 是聊天自动写入 scrollTop 的唯一控制器。向上输入立即释放跟随；每次写入前还比较实际位置，防止 WebKit 已经滚动但 JS 事件尚未派发时被拉回。

消息变化与 ResizeObserver 共用可取消的动画帧，不使用延时追底轮询。只有实际向下移动回到底部，或用户明确点击回到底部/发送消息，才恢复跟随。输入文字和输入法开始事件不再触发追底。普通滚轮不经过 JavaScript 平滑动画。

## 验证

```sh
npx vitest run testdata/browser/thread-scroll.test.ts testdata/agent/agent-browser-pane.test.ts
bash scripts/cargo.sh test --offline macos_wheel::tests --lib
# 先启动项目的 Vite 服务（1420），再运行独立 WKWebView：
bash scripts/cargo.sh run --offline --example scroll_smoke
```

独立测试窗口不初始化数据库、模型或 CEF，不修改保存的对话。它加载实际聊天组件，用内存消息模拟持续输出，并输出 `WKWEBVIEW_SCROLL_REPORT` 后退出。

集成测试在测试窗口内部调用原生滚轮分帧和 WKWebView 事件处理，不向系统发送鼠标操作。它覆盖应用内命中判定、输入分类和事件派发，但未通过物理设备产生输入，因此不能代替真实普通鼠标、Magic Mouse 和触控板的硬件体验验证。

## 2026-10-24 Markdown 高度回归

初期纯文本测试改善后，恢复 Markdown 仍出现底部吸附，滚轮和拖动滚动条都受影响。真实轨迹显示已完成内容高度从 11067px 降到 9336px。鼠标移动取消滚轮尾部是独立的输入丢失问题，不足以解释此次布局回跳。

Markstream 1.1.4 的 `.markdown-renderer` 默认使用 `content-visibility: auto` 和 `contain-intrinsic-size: 800px 600px`。工具调用之间的短 Markdown 块离屏时按估算高度占位，进入可视区域后恢复真实高度，导致滚动范围改变；`max-live-nodes=0` 不会关闭这个 CSS 行为。聊天局部覆盖为 `content-visibility: visible`、`contain-intrinsic-size: none`，保留 Markdown、原生滚轮和已有自动跟随逻辑。代价是离屏 Markdown 也参与布局；未改变其他文档页面的渲染策略。

之前 WKWebView fixture 漏加载 AgentChat.vue 引入的 Markstream CSS，且结尾 45 段文本使上滚测试没有跨过短 Markdown 块边界，故之前通过的检查不能覆盖这个问题。已补齐真实样式，将结尾缩短并跨多个块滚动，增加实际自定义滚动条事件测试：

- 修复前同一 WKWebView fixture 失败：已关闭自动跟随时 scrollTop 从 38267 回跳到 38803；内容高度在 35373–39412px 之间变化。
- 修复后真实 WKWebView 15 项检查通过：静态滚轮与滚动条拖动过程中内容高度始终 5969px；首次底部小幅上滚从 5401 到 5371；新输出增长后位置仍为 5371。
- 前端跟随与浏览器面板 14 项测试通过。WKWebView 测试仍是应用内部构造输入，不能替代用户物理设备操作；最终体验继续由用户在正常长对话中确认。

本轮未改原生代码，不需要重新编译 macOS 程序；前端通过 Vite 热更新。临时纯文本内容已移除。debug 构建中的几何诊断默认关闭，需要在启动进程前设置 `ZERROR_SCROLL_TRACE=1` 才会记录到 `/tmp/zerror-scroll-trace.json`；不记录聊天文字或输入文字。
