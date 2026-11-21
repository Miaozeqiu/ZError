import type { ChatToolContext } from '../toolContext'
import { websiteCheckpoints } from './checkpoints'

export async function websiteWorkflowTool(args: Record<string, unknown>, ctx: ChatToolContext) {
  try {
    const entries = await websiteCheckpoints.list(ctx.sessionId)
    if (args.action === 'list') return JSON.stringify({ ok: true, workflows: entries.map(entry => ({
      id: entry.id, tool: entry.name, host: entry.installed.host, revision: entry.installed.revision,
      browser_id: entry.browserId, updatedAt: entry.updatedAt,
    })) })
    const entry = entries.find(entry => entry.id === args.id)
    if (!entry) return JSON.stringify({ ok: false, error: '该检查点不存在或不属于当前对话' })
    if (args.action === 'discard') {
      if (ctx.role === 'explore') return JSON.stringify({ ok: false, denied: true })
      await websiteCheckpoints.remove(ctx.sessionId, entry.id)
      return JSON.stringify({ ok: true, discarded: true })
    }
    if (args.action !== 'resume') return JSON.stringify({ ok: false, error: '未知的检查点操作' })
    const browserId = ctx.ensureBrowser ? await ctx.ensureBrowser() : ctx.browserId()
    const { executeInstalledWebsiteTool } = await import('./installedTool')
    return executeInstalledWebsiteTool(entry.name, entry.input, ctx, browserId)
  } catch (error) {
    if (ctx.abort.aborted) throw error
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
