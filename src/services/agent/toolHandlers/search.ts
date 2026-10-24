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
        ok: false,
        query,
        error: error instanceof Error ? error.message : String(error),
        hint: '本次未取得联网证据。不要声称已检索或核实；存在不确定结论时明确说明，不能把搜索失败当成答案正确的依据。',
      })
    }
  },
}
