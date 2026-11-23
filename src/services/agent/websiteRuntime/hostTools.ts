import { executeWebsiteService } from './services'
import type { ChatToolContext } from '../toolContext'
import type { ToolDefinition } from '../core/tools'
import { getAgentPolicy } from '../agentPolicy'
import { callProtocol } from '../../browser/protocol'

// These schemas are used by the host runner and excluded from model discovery.
export const WEBSITE_HOST_TOOLS: ToolDefinition[] = ['browser_package_read', 'browser_package_act'].map(name => ({
  type: 'function', function: { name, parameters: { type: 'object', properties: {
    service_scope: { type: 'string' }, service_op: { type: 'string' }, request: { type: 'object' }, host: { type: 'string' }, action: { type: 'string' }, document: { type: 'object' },
    amount: { type: 'integer' }, index: { type: 'integer' }, url: { type: 'string' }, offset: { type: 'integer' }, selector: { type: 'string' }, nth: { type: 'integer' }, limit: { type: 'integer' },
    attributes: { type: 'array', items: { type: 'string' }, maxItems: 12 }, characters: { type: 'string' }, raster: { type: 'object' }, text: { type: 'string' }, muted: { type: 'boolean' }, secret_ref: { type: 'string' },
    until: { type: 'string' }, timeoutMs: { type: 'integer' }, wait_id: { type: 'string' },
  }, required: ['host', 'action'], additionalProperties: false } },
}))
const reads = new Set(['service', 'list', 'frames', 'query', 'glyphs', 'value', 'image', 'compare', 'media_read', 'media_wait', 'media_cancel'])
const writes = new Set(['service', 'reveal', 'scroll', 'select', 'navigate', 'click', 'fill', 'fill_secret', 'media_play', 'media_pause', 'media_mute'])
export async function executeWebsiteHostTool(name: string, args: Record<string, unknown>, ctx: ChatToolContext, browserId: string) {
  const read = name === 'browser_package_read'
  if (!(read ? reads : writes).has(String(args.action))) return JSON.stringify({ ok: false, reason: 'invalid', error: '宿主文档操作类型不匹配' })
  if (!read && (ctx.role === 'explore' || getAgentPolicy().permissionMode === 'strict')) return JSON.stringify({ ok: false, denied: true, error: '当前权限不允许修改网页' })
  ctx.abort.throwIfAborted()
  if (args.action === 'service') return JSON.stringify(await executeWebsiteService(name, args, ctx, browserId))
  const result = await callProtocol(browserId, 'website_document', args, ctx.browserEpoch === undefined ? undefined : { expectedEpoch: ctx.browserEpoch })
  return JSON.stringify(result)
}
