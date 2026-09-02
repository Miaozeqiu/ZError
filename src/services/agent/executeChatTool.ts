import { isModelStopped, type ModelToolCall } from '../model/runner'
import { executeBrowserTool } from './browserTools'
import { applyBrowserTodo, pendingTodos } from './browserTodo'
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

  if (call.name === 'list_agent_skills') {
    const { listAgentSkillsForAgent } = await import('./agentSkills')
    return JSON.stringify(await listAgentSkillsForAgent())
  }

  if (call.name === 'read_agent_skill') {
    const { readAgentSkillContent } = await import('./agentSkills')
    const id = String(args.skill_id || '').trim()
    const content = await readAgentSkillContent(id)
    if (!content) return JSON.stringify({ error: `Skill "${id}" 不存在或未启用` })
    return JSON.stringify(content)
  }

  if (call.name === 'read_agent_skill_file') {
    const { readAgentSkillFileContent } = await import('./agentSkills')
    const id = String(args.skill_id || '').trim()
    const path = String(args.path || '').trim()
    const content = await readAgentSkillFileContent(id, path)
    if (!content) return JSON.stringify({ error: `Skill "${id}" 的文件 "${path}" 不存在` })
    return JSON.stringify(content)
  }

  if (call.name === 'write_agent_skill_file') {
    const { writeAgentSkillFileContent } = await import('./agentSkills')
    return JSON.stringify(await writeAgentSkillFileContent(
      String(args.skill_id || '').trim(),
      String(args.path || '').trim(),
      String(args.content ?? ''),
    ))
  }

  if (call.name === 'reset_agent_skill_file') {
    const { resetAgentSkillFile } = await import('./agentSkills')
    return JSON.stringify(await resetAgentSkillFile(
      String(args.skill_id || '').trim(),
      String(args.path || '').trim() || undefined,
    ))
  }

  if (browserId && call.name === 'browser_site_graph') {
    const { applySiteGraphPatch } = await import('../browser/siteGraph')
    const state = await import('../browser/appBrowser').then((mod) => mod.getBrowserState(browserId).catch(() => null))
    const url = String(state?.url || '')
    return JSON.stringify(applySiteGraphPatch(args, { url }))
  }

  if (browserId && call.name === 'browser_todo') {
    const current = ctx.getTodos?.() || []
    const result = applyBrowserTodo(current, args)
    if (result.ok) ctx.setTodos?.(result.todos)
    return JSON.stringify(result)
  }

  if (browserId && call.name.startsWith('browser_')) {
    try {
      if (call.name === 'browser_finish' && String(args.status || '') === 'done') {
        const left = pendingTodos(ctx.getTodos?.() || [])
        if (left.length) {
          return JSON.stringify({
            error: '清单还有未完成项，不能 finish(done)',
            pending: left.map((item) => item.text),
            hint: '先 browser_todo check 完成项，或改清单；监控中用 watching。',
          })
        }
      }
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
