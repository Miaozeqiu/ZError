import type { ToolDefinition } from './core/tools'

// A source can describe an installed tool, but it cannot grant new host operations.
import { websiteToolHost } from './legacyWebsiteTools'
import { validateWebsiteRuntime, websiteRuntimeTools } from './websiteRuntime/protocol'
export { websiteToolHost, websiteHasSupportedTools, websiteToolNames } from './legacyWebsiteTools'

export function validateWebsiteTools(host: string, value: unknown, runtime?: unknown, siteId?: string): ToolDefinition[] {
  if (runtime !== undefined) {
    if (!siteId) throw new Error('网站运行包缺少身份')
    const tools = websiteRuntimeTools(siteId, validateWebsiteRuntime(runtime, siteId))
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(tools)) throw new Error('网站工具定义与运行包不一致')
    return tools
  }
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32 || JSON.stringify(value).length > 32 * 1024) {
    throw new Error('网站工具清单无效或过大。')
  }
  const names = new Set<string>()
  for (const row of value) {
    const tool = row?.function
    if (row?.type !== 'function' || typeof tool?.name !== 'string' || websiteToolHost(tool.name) !== host || names.has(tool.name)
      || typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > 1000
      || !tool.parameters || tool.parameters.type !== 'object' || tool.parameters.$ref !== undefined) {
      throw new Error('网站工具清单与当前网站或宿主能力不匹配。')
    }
    names.add(tool.name)
  }
  return value.map(({ function: { name, description, parameters } }) => ({ type: 'function', function: { name, description, parameters } }))
}
