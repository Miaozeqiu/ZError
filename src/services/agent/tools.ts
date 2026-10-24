/** Agent 工具表入口。定义按域拆在 toolDefs/。 */
import type { DomainToolPolicy } from './agentProfiles'
import type { HostCapabilities } from './hostCapabilities'
import { assembleRoleTools, type BrowserToolRole } from './subagent/tools'
import { withoutSubagentTools } from './subagent/enabled'
import { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'
import { WEB_SEARCH_TOOLS } from './toolDefs/webSearchTools'
import { CHAT_TOOLS } from './toolDefs/chatTools'

export { CHAT_TOOLS } from './toolDefs/chatTools'
export { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'
export type { BrowserToolRole } from './subagent/tools'

export const BROWSER_TOOLS = [...BROWSER_PRIMITIVE_TOOLS, ...WEB_SEARCH_TOOLS]

/** 工具表与当前设置一致，关闭的能力不让模型继续尝试。 */
export const availableAgentTools = <T extends Array<{ function: { name: string } }>>(tools: T, search: { enabled: boolean }) => (
  search.enabled ? tools : tools.filter(tool => tool.function.name !== 'web_search')
)

export const assembleBrowserTools = (input?: {
  url?: string
  domain?: DomainToolPolicy
  role?: BrowserToolRole | 'full'
  capabilities?: HostCapabilities
}) => {
  const role = input?.role
  const assembled = role && role !== 'full'
    ? assembleRoleTools({
      url: input?.url,
      domain: input?.domain,
      role,
      capabilities: input?.capabilities,
    })
    : BROWSER_PRIMITIVE_TOOLS
  const browserTools = withoutSubagentTools(assembled)
  // 浏览器会话仍是主 Agent 对话；把通用搜索工具保留给主 Agent，子 Agent 不注入。
  if (!role || role === 'full' || role === 'parent') return [...browserTools, ...WEB_SEARCH_TOOLS]
  return browserTools
}

/** 普通对话也能操作浏览器，共享工具（搜索、Skill）只声明一次。 */
export const assembleAgentTools = (url = '') => {
  const tools = [...CHAT_TOOLS, ...assembleBrowserTools({ url, role: 'parent', domain: 'current-site' })]
  return [...new Map(tools.map(tool => [tool.function.name, tool])).values()]
}
