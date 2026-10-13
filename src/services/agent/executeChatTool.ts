/** 对话工具分发。刷课走 browserTools，校园/题库/练习走 toolHandlers。 */
import { isModelStopped, type ModelToolCall } from '../model/runner'
import { executeBrowserTool } from './browserTools'
import { applyBrowserTodo, noteToolRoundForTodo } from './browserTodo'
import { campusToolHandlers } from './toolHandlers/campus'
import { folderToolHandlers } from './toolHandlers/folder'
import { quizToolHandlers } from './toolHandlers/quiz'
import { studyToolHandlers } from './toolHandlers/study'
import { parseToolArgs } from './toolArgs'
import type { ChatToolContext, ChatToolHandler } from './toolContext'
import { getAgentPolicy } from './agentPolicy'
import { requestAgentApproval } from './agentApproval'
import { noteFailAttempt, shouldBlockRepeatFail } from './failGate'
import { collectFinishEvidence, judgeFinish } from './finishGate'
import { intentFromTodoItems, setBrowserTaskIntent } from './browserTask'

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

const siteLearnHost = async (ctx: ChatToolContext) => {
  const id = ctx.browserId()
  if (!id) return ''
  const { peekAppBrowserUrl } = await import('../browser/appBrowser')
  const url = peekAppBrowserUrl(id)
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

const SKILL_TOOL_ALIASES: Record<string, string> = {
  browser_read_agent_skill: 'read_agent_skill',
  browser_read_agent_skill_file: 'read_agent_skill_file',
  browser_write_agent_skill_file: 'write_agent_skill_file',
  browser_list_agent_skills: 'list_agent_skills',
  browser_reset_agent_skill_file: 'reset_agent_skill_file',
}

export const executeChatTool = async (input: {
  call: ModelToolCall
  ctx: ChatToolContext
}): Promise<string> => {
  const { call, ctx } = input
  if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
  const aliased = SKILL_TOOL_ALIASES[call.name]
  if (aliased) {
    return executeChatTool({ call: { ...call, name: aliased }, ctx })
  }
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
    if (!content) {
      const hostHint = /[./]/.test(id) || /^(zjooc|zhihuishu|chaoxing)$/i.test(id)
        ? '站点步骤在 site-learn。下一步：read_agent_skill(site-learn)，再读 files 里 sites/<当前网址主机>/SKILL.md。'
        : undefined
      return JSON.stringify({
        error: `Skill "${id}" 不存在或未启用`,
        hint: hostHint,
      })
    }
    return JSON.stringify(content)
  }

  if (call.name === 'read_agent_skill_file') {
    const { placeSiteLearnPath, readAgentSkillFileContent } = await import('./agentSkills')
    const id = String(args.skill_id || '').trim()
    let path = String(args.path || '').trim()
    if (id === 'site-learn') {
      const host = await siteLearnHost(ctx)
      const placed = placeSiteLearnPath(path, host)
      if (placed.error) return JSON.stringify({ error: placed.error, path: placed.path })
      path = placed.path
    }
    const content = await readAgentSkillFileContent(id, path)
    if (!content) {
      return JSON.stringify({
        error: `Skill "${id}" 的文件 "${path}" 还不存在`,
        hint: id === 'site-learn'
          ? '站点步骤写在 sites/<主机>/SKILL.md。先看快照，走通后再写。'
          : undefined,
      })
    }
    return JSON.stringify(content)
  }

  if (call.name === 'write_agent_skill_file') {
    const id = String(args.skill_id || '').trim()
    let path = String(args.path || '').trim()
    if (id === 'site-learn') {
      const { placeSiteLearnPath } = await import('./agentSkills')
      const placed = placeSiteLearnPath(path, await siteLearnHost(ctx))
      if (placed.error) return JSON.stringify({ ok: false, error: placed.error, path: placed.path })
      path = placed.path
    }
    const { siteGraphWriteBlocked } = await import('../browser/siteGraphSave')
    const blocked = siteGraphWriteBlocked(path)
    if (blocked) return JSON.stringify({ ok: false, error: blocked })
    const approved = await ensureApproved(
      ctx,
      'write_skill',
      '写入 Skill 文件',
      `${id} / ${path || 'SKILL.md'}`,
    )
    if (!approved.ok) return approved.result
    const { writeAgentSkillFileContent } = await import('./agentSkills')
    return JSON.stringify(await writeAgentSkillFileContent(
      id,
      path,
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
    const { persistSiteGraph, presentSiteGraphPatch } = await import('../browser/siteGraphSave')
    const state = await import('../browser/appBrowser').then((mod) => mod.getBrowserState(browserId).catch(() => null))
    const url = String(state?.url || '')
    const action = String(args.action || '').trim()
    const result = applySiteGraphPatch(args, { url })
    let saved: { skillId: string; path: string } | undefined
    let saveError = ''
    if (result.ok && result.persist && result.site) {
      try {
        saved = await persistSiteGraph(result.site)
      } catch (error) {
        saveError = error instanceof Error ? error.message : String(error || '保存失败')
      }
    }
    return JSON.stringify(presentSiteGraphPatch(result, {
      action,
      saved,
      saveError: saveError || undefined,
    }))
  }

  if (browserId && call.name === 'browser_todo') {
    const current = ctx.getTodos?.() || []
    const result = applyBrowserTodo(current, args)
    if (result.ok) {
      ctx.setTodos?.(result.todos)
      if (String(args.action || '') === 'set') {
        setBrowserTaskIntent(ctx.parentSessionId || ctx.sessionId, intentFromTodoItems(result.todos.map((item) => item.text)))
      }
    }
    noteToolRoundForTodo(ctx.parentSessionId || ctx.sessionId, true, true)
    return JSON.stringify(result)
  }

  if (browserId && call.name === 'browser_task') {
    const { SUBAGENTS_ENABLED, SUBAGENT_DISABLED_HINT } = await import('./subagent/enabled')
    if (!SUBAGENTS_ENABLED) {
      return JSON.stringify({ ok: false, error: SUBAGENT_DISABLED_HINT })
    }
    const { runBrowserTask } = await import('./subagent/task')
    return runBrowserTask({
      args,
      ctx,
      parentStepId: ctx.parentStepId || call.id,
    })
  }

  if (browserId && call.name.startsWith('browser_')) {
    try {
      const gateSession = ctx.parentSessionId || ctx.sessionId
      noteToolRoundForTodo(
        gateSession,
        Boolean((ctx.getTodos?.() || []).length),
        call.name === 'browser_todo',
      )
      if (call.name === 'browser_finish') {
        const evidence = await collectFinishEvidence(browserId, gateSession, {
          todos: ctx.getTodos?.() || [],
          role: ctx.role || 'parent',
        })
        const judged = judgeFinish(String(args.status || ''), String(args.summary || ''), evidence)
        if (!judged.ok) return JSON.stringify({ ok: false, finished: false, error: 'error' in judged ? judged.error : '还不能收工' })
        return JSON.stringify({ ok: true, finished: true, status: judged.status, summary: judged.summary })
      }
      if (
        ctx.role === 'parser'
        && ctx.jobId
        && (call.name === 'browser_get_page' || call.name === 'browser_screenshot' || call.name === 'browser_eval')
      ) {
        const { acquireBrowser } = await import('./subagent/owner')
        const got = acquireBrowser(browserId, ctx.jobId)
        if (!got.ok) return JSON.stringify({ ok: false, error: got.error })
      }
      const blocked = shouldBlockRepeatFail(gateSession, call.name, args)
      if (blocked.block) {
        return JSON.stringify({ ok: false, error: blocked.hint, failGate: true })
      }
      const raw = await executeBrowserTool({
        name: call.name,
        args,
        browserId,
        sessionId: gateSession,
        wait: waitWithAbort(ctx.abort),
        role: ctx.role,
        jobId: ctx.jobId,
      })
      let ok = true
      try {
        const parsed = JSON.parse(raw) as { ok?: boolean; error?: unknown }
        ok = parsed.ok !== false && !parsed.error
      } catch {
        ok = !/^\s*\{/.test(raw)
      }
      noteFailAttempt(gateSession, call.name, args, ok)
      try {
        if (call.name !== 'browser_wait' && call.name !== 'browser_get_state') {
          const { noteBrowserToolResult } = await import('./agentLessons')
          const { peekAppBrowserUrl } = await import('../browser/appBrowser')
          noteBrowserToolResult(peekAppBrowserUrl(browserId), call.name, raw, args)
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
