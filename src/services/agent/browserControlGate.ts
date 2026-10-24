import { ModelStoppedError, type ModelToolCall } from '../model/runner'
import { browserControlRevision, controlForSession, userControlsBrowser } from '../browser/control'
import { clearFailGate } from './failGate'

/** 人工接管前生成的工具调用不能在交还后直接重放，先返回中断结果让模型基于新页面决策。 */
export const createBrowserControlGate = (sessionId: string, signal: AbortSignal) => {
  let roundRevision = browserControlRevision(sessionId)
  return {
    liveContext: async (read?: () => string | Promise<string>) => {
      for (;;) {
        if (signal.aborted) throw new DOMException('已停止', 'AbortError')
        if (userControlsBrowser(sessionId)) {
          return '【浏览器由用户控制】普通对话可以继续。当前不能执行浏览器工具；用户主动发送新消息时宿主会交还控制权；后台监控消息不能夺回控制权。'
        }
        const revision = browserControlRevision(sessionId)
        const text = await read?.() || ''
        if (!userControlsBrowser(sessionId) && revision === browserControlRevision(sessionId)) {
          if (roundRevision !== revision) clearFailGate(sessionId)
          roundRevision = revision
          return text
        }
      }
    },
    runTool: async (call: ModelToolCall, execute: (epoch: number) => Promise<string>) => {
      if (signal.aborted) throw new DOMException('已停止', 'AbortError')
      if (!call.name.startsWith('browser_')) return execute(controlForSession(sessionId)?.epoch || 0)
      if (userControlsBrowser(sessionId)) throw new ModelStoppedError()
      if (call.name.startsWith('browser_') && roundRevision !== browserControlRevision(sessionId)) {
        return JSON.stringify({ ok: false, userTakeover: true, requiresRefresh: true, hint: '用户已操作过网页，本次旧操作未执行。先 browser_get_page 核对最新页面，再决定下一步；不要直接重试旧 ref。' })
      }
      return execute(controlForSession(sessionId)?.epoch || 0)
    },
  }
}
