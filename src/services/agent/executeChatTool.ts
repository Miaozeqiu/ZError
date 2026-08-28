import { isModelStopped, type ModelToolCall } from '../model/runner'
import { executeBrowserTool } from './browserTools'
import { campusToolHandlers } from './toolHandlers/campus'
import { folderToolHandlers } from './toolHandlers/folder'
import { quizToolHandlers } from './toolHandlers/quiz'
import { studyToolHandlers } from './toolHandlers/study'
import { parseToolArgs } from './toolArgs'
import type { ChatToolContext, ChatToolHandler } from './toolContext'

const CHAT_TOOL_HANDLERS: Record<string, ChatToolHandler> = {
  ...folderToolHandlers,
  ...campusToolHandlers,
  ...quizToolHandlers,
  ...studyToolHandlers,
}

const waitWithAbort = (signal: AbortSignal) => (ms: number) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(new DOMException('已停止', 'AbortError'))
    return
  }
  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, ms)
  const onAbort = () => {
    window.clearTimeout(timer)
    reject(new DOMException('已停止', 'AbortError'))
  }
  signal.addEventListener('abort', onAbort, { once: true })
})

export const executeChatTool = async (input: {
  call: ModelToolCall
  ctx: ChatToolContext
}): Promise<string> => {
  const { call, ctx } = input
  if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
  const args = parseToolArgs(call.arguments)
  const browserId = ctx.browserId()

  if (browserId && call.name.startsWith('browser_')) {
    try {
      return await executeBrowserTool({
        name: call.name,
        args,
        browserId,
        sessionId: ctx.sessionId,
        wait: waitWithAbort(ctx.abort),
      })
    } catch (error) {
      if (ctx.abort.aborted || isModelStopped(error)) throw error
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handler = CHAT_TOOL_HANDLERS[call.name]
  if (!handler) return JSON.stringify({ error: `未知动作 ${call.name}` })
  return handler({ call, args, ctx })
}
