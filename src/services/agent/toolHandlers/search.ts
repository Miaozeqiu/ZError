import { useSettings } from '../../app/settings'
import { formatSearchContextForModel, performWebSearch } from '../../searchService'
import type { ChatToolHandler } from '../toolContext'

export const searchToolHandlers: Record<string, ChatToolHandler> = {
  web_search: async ({ args, ctx }) => {
    const query = String(args.query || '').trim()
    if (!query) return JSON.stringify({ error: '搜索关键词不能为空' })
    if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')

    try {
      const settings = useSettings().settings.search
      const outcome = await performWebSearch(query, settings, { signal: ctx.abort })
      return JSON.stringify({
        query: outcome.query,
        durationMs: outcome.durationMs,
        results: outcome.results,
        context: formatSearchContextForModel(outcome),
      })
    } catch (error) {
      if (ctx.abort.aborted) throw error
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        hint: '联网搜索失败，可以根据已有知识回答，或稍后重试。',
      })
    }
  },
}
