/** Agent 入口。对话循环在 chatLoop.ts，状态在 chatStore.ts。不要把刷课 CDP 写回这里。 */

export {
  sendChatMessage,
  stopChat,
  stopBrowserAgent,
  ensureBrowserChat,
  browserChatSessions,
} from './chat'
export { executeChatTool } from './executeChatTool'
export { executeBrowserTool } from './browserTools'
export { runBridgeAction } from './bridgeApi'
export { stopWatchFor } from './chatWatch'
export { CHAT_TOOLS, assembleBrowserTools } from './tools'
export { hostCapabilitiesFor } from './hostCapabilities'
export { runAgentTurnLoop } from './subagent/runtime'
