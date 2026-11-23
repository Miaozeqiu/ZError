import type { ModelToolCall } from '../model/runner'
import type { ChatToolContext } from './toolContext'
import { parseToolArgs } from './toolArgs'

type ContextInput = Pick<ChatToolContext, 'sessionId' | 'assistantId' | 'abort' | 'browserEpoch' | 'role' | 'parentSessionId' | 'parentAssistantId' | 'parentStepId' | 'jobId' | 'onBrowserNavigation' | 'invokeHostTool'> & {
  call: ModelToolCall
  expectedBrowserId?: string
  onDrawingGraph?: () => void
}

/** 模型回合与 CLI 直接工具调用共用的上下文；两个入口统一处理浏览器租约、
 * 父任务归属、附件，以及学习状态和任务清单的更新。 */
export async function createChatToolContext(input: ContextInput): Promise<ChatToolContext> {
  if (input.abort.aborted) throw new DOMException('已停止', 'AbortError')
  const [store, { scheduleStudyProgressEval }] = await Promise.all([import('./chatStore'), import('./chatStudy')])
  if (input.abort.aborted) throw new DOMException('已停止', 'AbortError')
  const target = input.parentSessionId || input.sessionId
  if (!store.liveSession(target)) throw new Error('对话已删除，不能继续执行工具')
  const messageId = input.parentAssistantId || input.assistantId
  return {
    sessionId: input.sessionId, assistantId: input.assistantId, abort: input.abort,
    browserEpoch: input.browserEpoch, role: input.role,
    parentSessionId: input.parentSessionId, parentAssistantId: input.parentAssistantId,
    parentStepId: input.parentStepId, jobId: input.jobId,
    onBrowserNavigation: input.onBrowserNavigation, invokeHostTool: input.invokeHostTool,
    ensureBrowser: async () => {
      const { ensureAgentBrowser } = await import('./agentBrowser')
      const id = await ensureAgentBrowser(target)
      if (input.expectedBrowserId && id !== input.expectedBrowserId) throw new Error('网页操作未执行：当前标签页已改变，请重新读取页面。')
      return id
    },
    browserId: () => store.liveSession(target)?.browserId || store.liveSession(input.sessionId)?.browserId || '',
    attachment: () => store.sessionAttachment(target), folders: () => store.sessionFolders(target),
    studySubjectId: () => { const id = Number(store.liveSession(target)?.studySubjectId); return Number.isFinite(id) && id > 0 ? id : undefined },
    setStudySubject: id => store.setChatStudySubject(id, target),
    markDrawingGraph: () => input.onDrawingGraph?.(),
    scheduleEval: evaluation => scheduleStudyProgressEval({ sessionId: target, messageId, ...evaluation, force: true }),
    getTodos: () => {
      if (input.parentSessionId) return store.liveSession(target)?.todos || []
      const message = store.liveSession(target)?.messages.find(row => row.id === messageId)
      return message?.todos ?? (input.call.name === 'browser_todo' && parseToolArgs(input.call.arguments).action !== 'set' ? store.liveSession(target)?.todos || [] : [])
    },
    setTodos: todos => {
      store.patchSession(target, session => ({ ...session, todos, updatedAt: Date.now() }))
      store.patchMessage(target, messageId, { todos })
    },
  }
}
