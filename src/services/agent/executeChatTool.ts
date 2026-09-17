import { isModelStopped, type ModelToolCall } from '../model/runner'
import { executeBrowserTool } from './browserTools'
import { applyBrowserTodo, pendingTodos } from './browserTodo'
import { campusToolHandlers } from './toolHandlers/campus'
import { folderToolHandlers } from './toolHandlers/folder'
import { quizToolHandlers } from './toolHandlers/quiz'
import { studyToolHandlers } from './toolHandlers/study'
import { parseToolArgs } from './toolArgs'
import type { ChatToolContext, ChatToolHandler } from './toolContext'
import { getAgentPolicy } from './agentPolicy'
import { requestAgentApproval } from './agentApproval'

const ensureApproved = async (
  ctx: ChatToolContext,
  kind: 'submit' | 'write_skill',
  title: string,
  detail: string,
) => {
  const policy = getAgentPolicy()
  const mode = kind === 'submit' ? policy.submit : policy.writeSkills
  if (mode === 'allow') return { ok: true as const }
  if (mode === 'deny') {
    return {
      ok: false as const,
      result: JSON.stringify({
        error: kind === 'submit' ? '当前策略禁止提交作业' : '当前策略禁止写入 Skill 文件',
        denied: true,
      }),
    }
  }
  const allow = await requestAgentApproval({
    sessionId: ctx.sessionId,
    kind,
    title,
    detail,
    signal: ctx.abort,
  })
  if (allow) return { ok: true as const }
  return {
    ok: false as const,
    result: JSON.stringify({ error: '用户拒绝了这次操作', denied: true }),
  }
}

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
    const approved = await ensureApproved(
      ctx,
      'write_skill',
      '写入 Skill 文件',
      `${String(args.skill_id || '').trim()} / ${String(args.path || '').trim() || 'SKILL.md'}`,
    )
    if (!approved.ok) return approved.result
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
      if (call.name === 'browser_homework' && String(args.action || '') === 'submit') {
        const approved = await ensureApproved(
          ctx,
          'submit',
          '提交作业',
          String(args.title || '将提交当前作业，并可能弹出确认框'),
        )
        if (!approved.ok) return approved.result
      }
      if (call.name === 'browser_finish' && String(args.status || '') === 'done') {
        const current = ctx.getTodos?.() || []
        if (pendingTodos(current).length) {
          ctx.setTodos?.(current.map((item) => (
            item.status === 'pending' ? { ...item, status: 'done' as const } : item
          )))
        }
      }
      const raw = await executeBrowserTool({
        name: call.name,
        args,
        browserId,
        sessionId: ctx.sessionId,
        wait: waitWithAbort(ctx.abort),
      })
      try {
        if (call.name !== 'browser_wait' && call.name !== 'browser_get_state') {
          const { noteBrowserToolResult } = await import('./agentLessons')
          const { peekAppBrowserUrl } = await import('../browser/appBrowser')
          noteBrowserToolResult(peekAppBrowserUrl(browserId), call.name, raw)
        }
      } catch {
        // 教训记失败不影响工具结果
      }
      return raw
    } catch (error) {
      if (ctx.abort.aborted || isModelStopped(error)) throw error
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handler = CHAT_TOOL_HANDLERS[call.name]
  if (!handler) return JSON.stringify({ error: `未知动作 ${call.name}` })
  return handler({ call, args, ctx })
}
