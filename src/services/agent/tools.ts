/** Agent 工具表入口。定义按域拆在 toolDefs/。 */
import type { DomainToolPolicy } from './agentProfiles'
import type { HostCapabilities } from './hostCapabilities'
import { assembleRoleTools, type BrowserToolRole } from './subagent/tools'
import { withoutSubagentTools } from './subagent/enabled'
import { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'

export { CHAT_TOOLS } from './toolDefs/chatTools'
export { BROWSER_PRIMITIVE_TOOLS } from './toolDefs/browserPrimitiveTools'
export type { BrowserToolRole } from './subagent/tools'

export const BROWSER_TOOLS = [...BROWSER_PRIMITIVE_TOOLS]

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
  return withoutSubagentTools(assembled)
}
