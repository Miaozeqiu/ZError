import { sameDocumentValue } from '../security/documentPersistence'
import type { ToolDefinition } from './core/tools'
import { validateWebsiteRuntime, websiteRuntimeTools } from './websiteRuntime/protocol'
/** Tool schemas can only come from their verified executable package. */
export function validateWebsiteTools(_host: string, value: unknown, runtime?: unknown, siteId?: string): ToolDefinition[] {
  if (runtime === undefined) {
    if (value !== undefined && (!Array.isArray(value) || value.length)) throw new Error('网站工具需要已验证的编译运行包')
    return []
  }
  if (!siteId) throw new Error('网站运行包缺少身份')
  const tools = websiteRuntimeTools(siteId, validateWebsiteRuntime(runtime, siteId))
  if (value !== undefined && !sameDocumentValue(value, tools)) throw new Error('网站工具定义与运行包不一致')
  return tools
}
