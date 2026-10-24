/** browser_task：父派出隔离子 Agent，同步等待结构化回执。 */
import { listAppBrowsers, peekAppBrowserUrl } from '../../browser/appBrowser'
import { getProfileForKind } from '../agentProfiles'
import { getEnabledSkillCatalog } from '../agentSkills'
import { applyBrowserTodo } from '../browserTodo'
import { formatBrowserLiveContext } from '../browserLoop'
import { loadLiveExploreRefs } from '../chatStudy'
import { packAgentPanel } from '../../platform/panelAccess'
import { liveStudyPlayback } from '../../chaoxing/browser/playback'
import type { AgentChatMessage, AgentChatSession, AgentSubagentJob, AgentSubagentKind } from '../chatTypes'
import {
  chatAborts,
  liveSession,
  patchMessage,
  patchSession,
  persistSoon,
  sessions,
} from '../chatStore'
import { hostCapabilitiesFor } from '../hostCapabilities'
import {
  BROWSER_EXECUTE_PROMPT,
  BROWSER_EXPLORE_PROMPT,
  buildBrowserSystemPrompt,
} from '../prompts'
import { assembleBrowserTools } from '../tools'
import type { ChatToolContext } from '../toolContext'
import { acquireBrowser, registerChildAbort, releaseBrowser } from './owner'
import { SUBAGENT_DISABLED_HINT, SUBAGENTS_ENABLED } from './enabled'
import { summarizeSubagentReceipt } from './receipt'
import { runAgentTurnLoop } from './runtime'

const DEFAULT_ROUNDS: Record<AgentSubagentKind, number> = {
  explore: 24,
  execute: 40,
}

const promptOf = (kind: AgentSubagentKind) => {
  if (kind === 'explore') return BROWSER_EXPLORE_PROMPT
  return BROWSER_EXECUTE_PROMPT
}

const needsBrowser = (kind: AgentSubagentKind) => kind === 'explore' || kind === 'execute'

const lastFinishOf = (session?: AgentChatSession | null) => {
  const steps = [...(session?.messages || [])].reverse().flatMap((message) => message.steps || [])
  const finish = steps.find((step) => step.name === 'browser_finish' && step.result)
  if (!finish?.result) return null
  try {
    return JSON.parse(finish.result) as Record<string, unknown>
  } catch {
    return null
  }
}

export const runBrowserTask = async (input: {
  args: Record<string, unknown>
  ctx: ChatToolContext
  parentStepId?: string
}): Promise<string> => {
  const { args, ctx } = input
  if (!SUBAGENTS_ENABLED) {
    return JSON.stringify({ ok: false, error: SUBAGENT_DISABLED_HINT })
  }
  if (ctx.role && ctx.role !== 'parent') {
    return JSON.stringify({ ok: false, error: '子 Agent 不能再派 browser_task' })
  }
  const kind = String(args.kind || '').trim() as AgentSubagentKind
  if (kind !== 'explore' && kind !== 'execute') {
    return JSON.stringify({
      ok: false,
      error: 'browser_task 只能派 explore 或 execute。站点经验写进 SKILL.md。',
    })
  }
  const goal = String(args.goal || '').replace(/\s+/g, ' ').trim()
  if (!goal) return JSON.stringify({ ok: false, error: '缺少 goal' })
  const browserId = ctx.browserId()
  if (!browserId) return JSON.stringify({ ok: false, error: '当前没有浏览器窗口' })

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const maxRounds = Math.min(
    DEFAULT_ROUNDS[kind],
    Math.max(1, Number(args.maxRounds) || DEFAULT_ROUNDS[kind]),
  )
  const held = needsBrowser(kind) ? acquireBrowser(browserId, jobId) : { ok: true as const }
  if (!held.ok) return JSON.stringify({ ok: false, error: held.error })

  const parent = liveSession(ctx.sessionId)
  const job: AgentSubagentJob = {
    id: jobId,
    parentSessionId: ctx.sessionId,
    kind,
    goal,
    todoId: String(args.todoId || '').trim() || undefined,
    status: 'running',
    startedAt: Date.now(),
  }
  if (parent) {
    patchSession(ctx.sessionId, (session) => ({
      ...session,
      jobs: [...(session.jobs || []), job],
      updatedAt: Date.now(),
    }))
  }

  const childId = `sub-${jobId}`
  const assistantId = `assistant-${jobId}`
  const child: AgentChatSession = {
    id: childId,
    title: `${kind} · ${goal.slice(0, 24)}`,
    messages: [],
    browserId,
    parentId: ctx.sessionId,
    role: kind,
    todos: parent?.todos || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const userMessage: AgentChatMessage = {
    id: `user-${jobId}`,
    role: 'user',
    content: goal,
    steps: [],
    status: 'done',
  }
  const assistantMessage: AgentChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    steps: [],
    status: 'streaming',
    waiting: true,
  }
  child.messages.push(userMessage, assistantMessage)
  sessions.value = [child, ...sessions.value]

  const abort = new AbortController()
  chatAborts.set(childId, abort)
  registerChildAbort(ctx.sessionId, abort)
  const onParentAbort = () => {
    if (!abort.signal.aborted) abort.abort()
  }
  ctx.abort.addEventListener('abort', onParentAbort, { once: true })

  const url = peekAppBrowserUrl(browserId) || listAppBrowsers().find((item) => item.id === browserId)?.url || ''
  const profile = getProfileForKind('browser')
  const catalog = getEnabledSkillCatalog('browser', profile.skillIds.length ? profile.skillIds : undefined)
  const caps = hostCapabilitiesFor(url)
  const tools = assembleBrowserTools({
    url,
    domain: profile.toolPolicy.domain,
    role: kind,
    capabilities: caps,
  })
  const systemPrompt = [
    buildBrowserSystemPrompt({ catalog }),
    promptOf(kind),
    `【子任务】${kind}：${goal}`,
  ].filter(Boolean).join('\n\n')

  const releaseIfHeld = () => {
    releaseBrowser(browserId, jobId)
  }

  try {
    const result = await runAgentTurnLoop({
      sessionId: childId,
      assistantId,
      abort,
      modelPrompt: goal,
      history: [],
      systemPrompt,
      tools,
      liveTools: () => assembleBrowserTools({
        url: peekAppBrowserUrl(browserId) || url,
        domain: profile.toolPolicy.domain,
        role: kind,
        capabilities: hostCapabilitiesFor(peekAppBrowserUrl(browserId) || url),
      }),
      liveContext: async () => {
        const currentUrl = peekAppBrowserUrl(browserId) || url
        const parentNow = liveSession(ctx.sessionId)
        const refs = await loadLiveExploreRefs(browserId, currentUrl)
        return formatBrowserLiveContext({
          url: currentUrl,
          sessionId: ctx.sessionId,
          todos: parentNow?.todos || [],
          panel: packAgentPanel(browserId),
          browserId,
          role: kind,
          refs,
        })
      },
      maxRounds,
      timeoutMs: 15 * 60 * 1000,
      isBrowserChat: true,
      role: kind,
      parentSessionId: ctx.sessionId,
      parentAssistantId: ctx.assistantId,
      parentStepId: input.parentStepId,
      jobId,
    })

    const childNow = liveSession(childId)
    const finish = lastFinishOf(childNow)
    const playback = liveStudyPlayback(browserId)
    const ok = !result.failed && !result.aborted && finish?.ok !== false
    const summary = String(finish?.summary || childNow?.messages.find((item) => item.id === assistantId)?.content || result.text || goal)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400)
    const receipt = summarizeSubagentReceipt({
      ok,
      kind,
      summary: summary || (result.aborted ? '已中止' : result.failed || '子任务结束'),
      url: peekAppBrowserUrl(browserId) || url,
      error: result.failed || (result.aborted ? '已中止' : finish && finish.ok === false ? String(finish.error || '') : undefined),
      playing: playback?.playing,
      jobs: packAgentPanel(browserId)?.jobLine,
      wrote: childNow?.messages.some((message) => (message.steps || []).some((step) => step.name === 'write_agent_skill_file' && step.status === 'done')),
    })

    patchMessage(childId, assistantId, {
      content: result.text,
      status: result.aborted ? 'stopped' : result.failed ? 'failed' : 'done',
      error: result.failed,
    })
    patchSession(ctx.sessionId, (session) => ({
      ...session,
      jobs: (session.jobs || []).map((item) => (
        item.id === jobId
          ? {
            ...item,
            status: result.aborted ? 'stopped' : receipt.ok ? 'done' : 'failed',
            summary: receipt.summary,
            url: receipt.url,
            error: receipt.error,
            endedAt: Date.now(),
          }
          : item
      )),
      updatedAt: Date.now(),
    }))

    if (receipt.ok && job.todoId) {
      const current = liveSession(ctx.sessionId)?.todos || []
      const next = applyBrowserTodo(current, { action: 'check', id: job.todoId })
      if (next.ok) {
        patchSession(ctx.sessionId, (session) => ({ ...session, todos: next.todos, updatedAt: Date.now() }))
        patchMessage(ctx.sessionId, ctx.assistantId, { todos: next.todos })
      }
    }

    sessions.value = sessions.value.filter((item) => item.id !== childId)
    persistSoon(true)
    return JSON.stringify(receipt)
  } finally {
    ctx.abort.removeEventListener('abort', onParentAbort)
    if (chatAborts.get(childId) === abort) chatAborts.delete(childId)
    releaseIfHeld()
    sessions.value = sessions.value.filter((item) => item.id !== childId)
  }
}
