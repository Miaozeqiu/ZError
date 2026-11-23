import { fileImportToolHandlers } from './toolHandlers/fileImport'
import { SUBAGENTS_ENABLED, SUBAGENT_DISABLED_HINT } from './subagent/enabled'
import { protectCredentials } from './credentialTools'
import { redactObject } from '../security/secretRedaction'
/** 对话工具分发。刷课走 browserTools，校园/题库/练习走 toolHandlers。 */
import { isModelStopped, type ModelToolCall } from '../model/runner'
import { executeBrowserTool } from './browserTools'
import { applyBrowserTodo, noteToolRoundForTodo } from './browserTodo'
import { campusToolHandlers } from './toolHandlers/campus'
import { folderToolHandlers } from './toolHandlers/folder'
import { quizToolHandlers } from './toolHandlers/quiz'
import { studyToolHandlers } from './toolHandlers/study'
import { searchToolHandlers } from './toolHandlers/search'
import { parseToolArgs } from './toolArgs'
import type { ChatToolContext, ChatToolHandler } from './toolContext'
import { isWebsiteRuntimeToolName } from './websiteRuntime/protocol'
import { getAgentPolicy } from './agentPolicy'
import { campusWriteDenial } from './campusPolicy'
import { requestAgentApproval } from './agentApproval'
import { noteFailAttempt, shouldBlockRepeatFail } from './failGate'
import { collectFinishEvidence, judgeFinish } from './finishGate'
import { intentFromTodoItems, setBrowserTaskIntent } from './browserTask'
import { withBrowserAutomation } from '../browser/control'
import { reviewSiteLearning, siteSkillReadIndex } from './siteLearningReview'
import { websitePrimaryHost } from './websiteIdentity'
import { resolveWebsiteSkillTarget } from './websiteSkillTarget'
import { canonicalSkillToolName } from './skillToolNames'
import { WEBSITE_REPOSITORY_READ_ONLY, websiteRepositoryTarget } from './websiteRepositoryTarget'
import { experienceHostForPage, websiteRepositoryHosts } from './websiteRepository'

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
  ...fileImportToolHandlers,
  ...campusToolHandlers,
  ...quizToolHandlers,
  ...studyToolHandlers,
  ...searchToolHandlers,
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
  return experienceHostForPage(url).catch(() => websitePrimaryHost(url))
}

export const executeChatTool = async (input: {
  call: ModelToolCall
  ctx: ChatToolContext
}): Promise<string> => {
  const { call, ctx } = input
  if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
  const aliased = canonicalSkillToolName(call.name)
  if (aliased !== call.name) {
    return executeChatTool({ call: { ...call, name: aliased }, ctx })
  }
  const denied = campusWriteDenial(call.name)
  if (denied) return JSON.stringify({ ok: false, denied: true, error: denied })
  const args = parseToolArgs(call.arguments)
  if (call.name === 'search_conversation_history' || call.name === 'read_conversation_history') {
    const { liveSession } = await import('./chatStore')
    const { conversationHistory } = await import('./conversationHistory')
    const { redactNative } = await import('../security/secureStore')
    const session = liveSession(ctx.sessionId)
    // Redact the whole source before slicing, otherwise a page boundary could
    // split a credential into fragments that no longer match the redactor.
    const safeSession = session ? await redactNative(redactObject(session)) : undefined
    return JSON.stringify(safeSession
      ? conversationHistory(safeSession, call.name === 'search_conversation_history' ? 'search' : 'read', args)
      : { ok: false, error: '当前对话不存在' })
  }
  let browserId = ctx.browserId()
  if (call.name === 'browser_workflows') {
    const { websiteWorkflowTool } = await import('./websiteRuntime/workflowTool')
    return websiteWorkflowTool(args, ctx)
  }
  if (call.name.startsWith('browser_') && ctx.ensureBrowser) {
    try {
      browserId = await ctx.ensureBrowser()
      if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
    } catch (error) {
      if (ctx.abort.aborted) throw error
      return JSON.stringify({ ok: false, error: `浏览器打开失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }

  if (isWebsiteRuntimeToolName(call.name)) {
    const { executeInstalledWebsiteTool } = await import('./websiteRuntime/installedTool')
    return executeInstalledWebsiteTool(call.name, args, ctx, browserId)
  }

  if (call.name === 'protect_credentials') return protectCredentials({ call, args, ctx })

  if (call.name === 'browser_package_read' || call.name === 'browser_package_act') {
    const { executeWebsiteHostTool } = await import('./websiteRuntime/hostTools')
    return executeWebsiteHostTool(call.name, args, ctx, browserId)
  }

  if (call.name === 'list_agent_skills') {
    const { listAgentSkillsForAgent } = await import('./agentSkills')
    return JSON.stringify(await listAgentSkillsForAgent())
  }

  if (call.name === 'set_website_icon') {
    const { websiteIconTool } = await import('./websiteIconTool')
    return websiteIconTool({ call, args, ctx })
  }

  if (call.name === 'read_agent_skill') {
    const { readAgentSkillContent } = await import('./agentSkills')
    const id = String(args.skill_id || '').trim()
    const content = await readAgentSkillContent(id)
    if (!content) {
      const hostHint = /[./]/.test(id) || /^(zjooc|zhihuishu|chaoxing)$/i.test(id)
        ? '站点步骤在 site-learn。下一步：read_agent_skill_file(skill_id=site-learn, path=sites/<主网站域名>/SKILL.md)。'
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
    const target = resolveWebsiteSkillTarget(String(args.skill_id || '').trim(), String(args.path || '').trim())
    const id = target.skillId
    let path = target.path
    if (id === 'site-learn') {
      const host = await siteLearnHost(ctx)
      const placed = placeSiteLearnPath(path, host)
      if (placed.error) return JSON.stringify({ error: placed.error, path: placed.path })
      path = placed.path
    }
    let content
    try {
      content = await readAgentSkillFileContent(id, path)
    } catch (error) {
      return JSON.stringify({ ok: false, id, path, error: `读取文件失败：${error instanceof Error ? error.message : String(error)}` })
    }
    if (!content) {
      const repository = websiteRepositoryTarget(id, path)
      if (repository) {
        return JSON.stringify({ ok: false, id, path, error: '当前网站经验来源没有该文件。', write_scope: 'read_only', hint: WEBSITE_REPOSITORY_READ_ONLY })
      }
      if (id === 'site-learn' && /^sites\/[^/]+\/SKILL\.md$/.test(path)) {
        return JSON.stringify({
          ok: true, id, path, exists: false, content: '', write_scope: 'website_files',
          hint: '本站尚未创建经验文件，已确认原文不存在。将本轮验证过的经验写入这个路径，成功后使用 updated；不能声明 covered。',
        })
      }
      return JSON.stringify({
        id, path,
        error: `Skill "${id}" 的文件 "${path}" 还不存在`,
        hint: id === 'site-learn'
          ? '站点步骤写在 sites/<主机>/SKILL.md。先看快照，走通后再写。'
          : undefined,
      })
    }
    return JSON.stringify({ ...content, exists: true })
  }

  if (call.name === 'write_agent_skill_file') {
    const requestedId = String(args.skill_id || '').trim()
    const { isSkillEditable } = await import('./agentSkills')
    if (!isSkillEditable(requestedId)) return JSON.stringify({ error: '此 Skill 为只读或不存在，不能修改', id: requestedId })
    const target = resolveWebsiteSkillTarget(requestedId, String(args.path || '').trim())
    const id = target.skillId
    let path = target.path
    if (id === 'site-learn') {
      const { placeSiteLearnPath } = await import('./agentSkills')
      const placed = placeSiteLearnPath(path, await siteLearnHost(ctx))
      if (placed.error) return JSON.stringify({ ok: false, error: placed.error, path: placed.path })
      path = placed.path
    }
    await websiteRepositoryHosts()
    const { skillFileWriteError } = await import('./agentSkills')
    const writeError = skillFileWriteError(id, path)
    if (writeError) return JSON.stringify({ error: writeError, id, path })
    const repository = websiteRepositoryTarget(id, path)
    if (repository && repository.path !== 'SKILL.md') {
      return JSON.stringify({ ok: false, id, path, error: WEBSITE_REPOSITORY_READ_ONLY })
    }
    const { siteGraphWriteBlocked } = await import('../browser/siteGraphSave')
    const blocked = siteGraphWriteBlocked(path)
    if (blocked) return JSON.stringify({ ok: false, error: blocked })
    if ((id === 'site-learn' && /^sites\/[^/]+\/SKILL\.md$/.test(path)) || (id === 'chaoxing' && path === 'SKILL.md')) {
      const { liveSession } = await import('./chatStore')
      const steps = liveSession(ctx.sessionId)?.messages.find(message => message.id === ctx.assistantId)?.steps || []
      if (siteSkillReadIndex(steps, id === 'chaoxing' ? 'sites/chaoxing.com/SKILL.md' : path) < 0) {
        return JSON.stringify({ error: '先用 read_agent_skill_file 读取本站原文，再按返回的编辑范围合并增量。', id, path })
      }
      const { readAgentSkillFileContent } = await import('./agentSkills')
      const original = await readAgentSkillFileContent(id, path)
      const originalText = repository
        ? (args.base_version && args.base_version === original?.repository_version ? original.local_experience : undefined)
        : original?.content
      if (originalText?.trim() === String(args.content ?? '').trim()) {
        return JSON.stringify({ ok: true, id, path, unchanged: true, hint: '内容与已有文件一致，无需写入或申请授权；收尾使用 covered。' })
      }
    }
    if (repository && !String(args.base_version || '').trim()) return JSON.stringify({ ok: false, id, path,
      error: '请读取本站 SKILL.md 的 local_experience，并将 repository_version 填入 base_version；现有经验已保留。' })
    const approved = await ensureApproved(
      ctx,
      'write_skill',
      repository ? '保存网站本地经验' : '写入 Skill 文件',
      `${id} / ${path || 'SKILL.md'}`,
    )
    if (!approved.ok) return JSON.stringify({ ...parseToolArgs(approved.result), id, path })
    const { writeAgentSkillFileContent } = await import('./agentSkills')
    const text = String(redactObject(args.content ?? ''))
    const written = repository
      ? await writeAgentSkillFileContent(id, path, text, String(args.base_version))
      : await writeAgentSkillFileContent(id, path, text)
    return JSON.stringify({ ...written, id, path })
  }

  if (call.name === 'reset_agent_skill_file') {
    const { resetAgentSkillFile } = await import('./agentSkills')
    return JSON.stringify(await resetAgentSkillFile(
      String(args.skill_id || '').trim(),
      String(args.path || '').trim() || undefined,
    ))
  }

  if (browserId && call.name === 'browser_site_graph') {
    const { applySiteGraphPatch } = await import('../browser/siteGraphCore')
    const { isOnlineSiteGraph, persistSiteGraph, presentSiteGraphPatch } = await import('../browser/siteGraphSave')
    await websiteRepositoryHosts()
    const state = await import('../browser/appBrowser').then((mod) => mod.getBrowserState(browserId).catch(() => null))
    const url = String(state?.url || '')
    const action = String(args.action || '').trim()
    const result = applySiteGraphPatch(args, { url, readonlySite: isOnlineSiteGraph })
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
        const { liveSession } = await import('./chatStore')
        const session = liveSession(ctx.sessionId)
        const current = session?.messages.find(message => message.id === ctx.assistantId)
        const currentSteps = current?.steps || []
        const goal = session?.messages.find(message => message.role === 'user' && message.id === current?.run?.goalMessageId)
        const evidence = await collectFinishEvidence(browserId, gateSession, {
          todos: ctx.getTodos?.() || [],
          role: ctx.role || 'parent',
          steps: currentSteps,
          completion: args.completion,
          goalText: goal?.content,
        })
        const judged = judgeFinish(String(args.status || ''), String(args.summary || ''), evidence)
        if (!judged.ok) return JSON.stringify({ ok: false, finished: false, error: 'error' in judged ? judged.error : '还不能收工' })
        let learning
        if (args.learning && judged.status === 'done' && (!ctx.role || ctx.role === 'parent')) {
          learning = reviewSiteLearning({ url: evidence.url || '', steps: currentSteps,
            learning: args.learning, writePolicy: getAgentPolicy().writeSkills })
          if (!learning.ok) learning = { decision: 'deferred', reason: learning.error }
        }
        if (judged.status !== 'watching') {
          const { stopWatchFor } = await import('./chatWatch')
          stopWatchFor(browserId)
        }
        return JSON.stringify({ ok: true, finished: judged.status !== 'watching', status: judged.status, summary: judged.summary, learning,
          ...(judged.status === 'watching' ? { awaitingVideo: true, taskComplete: false } : {}) })
      }
      const blocked = shouldBlockRepeatFail(gateSession, call.name, args)
      if (blocked.block) {
        return JSON.stringify({ ok: false, error: blocked.hint, failGate: true })
      }
      const execute = () => executeBrowserTool({
        name: call.name,
        args,
        browserId,
        sessionId: gateSession,
        signal: ctx.abort,
        wait: waitWithAbort(ctx.abort),
        onNavigation: ctx.onBrowserNavigation,
        role: ctx.role,
        jobId: ctx.jobId,
      })
      const raw = ctx.browserEpoch == null ? await execute() : await withBrowserAutomation(browserId, ctx.browserEpoch, execute)
      if (raw.includes('BROWSER_USER_CONTROL')) {
        return JSON.stringify({ ok: false, userTakeover: true, requiresRefresh: true, hint: '用户已接管浏览器，本次自动操作已中断。交还后先重新读取页面。' })
      }
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
      if (String(error).includes('BROWSER_USER_CONTROL')) {
        return JSON.stringify({ ok: false, userTakeover: true, requiresRefresh: true, hint: '用户已接管浏览器；交还后先重新读取页面，不要重试旧操作。' })
      }
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handler = CHAT_TOOL_HANDLERS[call.name]
  if (!handler) return JSON.stringify({ error: `未知动作 ${call.name}` })
  return handler({ call, args, ctx })
}
