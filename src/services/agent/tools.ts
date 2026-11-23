/** Agent 工具表入口。定义按域拆在 toolDefs/。 */
import type { HostCapabilities } from './hostCapabilities'
import { assembleRoleTools, type BrowserToolRole } from './subagent/tools'
import { withoutSubagentTools } from './subagent/enabled'
import { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'
import { WEB_SEARCH_TOOLS } from './toolDefs/webSearchTools'
import { CHAT_TOOLS } from './toolDefs/chatTools'
import { campusWriteDenial } from './campusPolicy'

export { CHAT_TOOLS } from './toolDefs/chatTools'
export { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'
export type { BrowserToolRole } from './subagent/tools'

/** 工具表与当前设置一致，关闭的能力不让模型继续尝试。 */
export const availableAgentTools = <T extends Array<{ function: { name: string } }>>(tools: T, search: { enabled: boolean }) => (
  tools.filter(({ function: { name } }) =>
    (search.enabled || name !== 'web_search') && !campusWriteDenial(name),
  )
)

export const assembleBrowserTools = (input?: {
  url?: string
  role?: BrowserToolRole | 'full'
  capabilities?: HostCapabilities
  startupHost?: string
}) => {
  const role = input?.role
  const assembled = role && role !== 'full'
    ? assembleRoleTools({
      url: input?.url,
      role,
      capabilities: input?.capabilities,
      startupHost: input?.startupHost,
    })
    : BROWSER_PRIMITIVE_TOOLS
  const browserTools = withoutSubagentTools(assembled)
  // 浏览器会话仍是主 Agent 对话；把通用搜索工具保留给主 Agent，子 Agent 不注入。
  if (!role || role === 'full' || role === 'parent') return [...browserTools, ...WEB_SEARCH_TOOLS]
  return browserTools
}

/** 普通对话也能操作浏览器，共享工具（搜索、Skill）只声明一次。 */
export const assembleAgentTools = (url = '', startupHost?: string) => {
  const tools = [...CHAT_TOOLS, ...assembleBrowserTools({ url, startupHost, role: 'parent' })]
  return [...new Map(tools.map(tool => [tool.function.name, tool])).values()]
}
