import { cliToolCatalog } from './catalog'
import { watch } from 'vue'
import { createRunController } from '../agent/core/controller'
import { cliRunCheckpoint } from './run'
import { validateToolCall } from '../agent/core/tools'
import { executeChatTool } from '../agent/executeChatTool'
import { createHostToolRunner } from '../agent/hostToolRunner'
import { createBrowserControlGate } from '../agent/browserControlGate'
import { isWebsiteHostCommand } from '../agent/websiteRuntime/protocol'
import { ensureAgentBrowser, bindChatBrowser, browserIdsForChat } from '../agent/agentBrowser'
import { listAppBrowsers, peekAppBrowserUrl } from '../browser/appBrowser'
import { agentApprovalState } from '../agent/agentApproval'
import { createChatToolContext } from '../agent/chatToolContextFactory'
import * as store from '../agent/chatStore'
import { redactNative } from '../security/secureStore'
import type { CliContext, CliParams } from './contracts'
import { sessionBusy } from './tasks'
import { requiredText } from './values'

export async function startCliTool(p: CliParams<'tools.run'>, context: CliContext) {
  await store.chatStoreReady
  if (isWebsiteHostCommand(p.name)) throw new Error('网站内部宿主命令只能由已授权的网站编译包调用')
  const existing = p.sessionId !== undefined ? store.liveSession(requiredText(p.sessionId, 'sessionId')) : undefined
  if (p.sessionId !== undefined && !existing) throw new Error('对话不存在')
  if (existing && (store.chatAborts.has(existing.id) || existing.messages.some(message => message.status === 'streaming'))) throw new Error('对话正在运行')
  const url = existing?.browserId ? peekAppBrowserUrl(existing.browserId) : ''
  const call = { id: crypto.randomUUID(), name: p.name, arguments: JSON.stringify(p.args) }
  const invalid = validateToolCall(await cliToolCatalog(url), call)
  if (invalid) throw new Error(invalid)
  await context.assertActive()
  if (existing && store.liveSession(existing.id) !== existing) throw new Error('对话已删除，未启动任务')
  if (existing && (sessionBusy(existing) || store.chatAborts.has(existing.id))) throw new Error('对话正在运行')
  const session = existing || store.createChat({ title: `CLI · ${p.name}`, activate: false })
  const previous = [...session.messages].reverse().find(message => message.role === 'assistant' && message.run)?.run
  const messageId = crypto.randomUUID()
  session.messages.push({ id: messageId, role: 'assistant', content: '', steps: [], status: 'streaming', run: cliRunCheckpoint(messageId, previous) })
  const abort = new AbortController()
  store.chatAborts.set(session.id, abort)
  void runTool(session.id, messageId, call, abort).catch(() => undefined)
  return { id: session.id, messageId, accepted: true }
}

async function runTool(sessionId: string, assistantId: string, call: { id: string; name: string; arguments: string }, abort: AbortController) {
  const session = () => store.liveSession(sessionId)
  const browserId = () => session()?.browserId || ''
  const message = () => session()?.messages.find(item => item.id === assistantId)
  const gate = createBrowserControlGate(sessionId, abort.signal)
  const run = createRunController({
    run: message()!.run!, signal: abort.signal, browserId,
    changed: run => store.patchMessage(sessionId, assistantId, { run }), checkpoint: store.flushChatCheckpoint,
    prepareBrowser: () => ensureAgentBrowser(sessionId), browserTabs: () => browserIdsForChat(session()),
    selectBrowser: async id => {
      if (!session() || !browserIdsForChat(session()).includes(id) || !listAppBrowsers().some(tab => tab.id === id)) return false
      bindChatBrowser(sessionId, id)
      return await ensureAgentBrowser(sessionId) === id
    },
  })
  run.state('running')
  const stopApprovalWatch = watch(() => agentApprovalState.pending?.sessionId === sessionId, pending => run.state(pending ? 'waiting_user' : 'running'))
  const execute = async (tool: typeof call): Promise<string> => {
    const invalid = validateToolCall(await cliToolCatalog(browserId() ? peekAppBrowserUrl(browserId()) : ''), tool)
    if (invalid) throw new Error(invalid)
    return gate.runTool(tool, browserEpoch => run.execute(tool, async expectedBrowserId => {
      const ctx = await createChatToolContext({
        call: tool, sessionId, assistantId, abort: abort.signal, role: 'parent', browserEpoch, expectedBrowserId,
        invokeHostTool: (name, args) => host(name, args),
      })
      return executeChatTool({ call: tool, ctx })
    }))
  }
  const host = createHostToolRunner({ executeTool: execute, liveTools: () => cliToolCatalog(browserId() ? peekAppBrowserUrl(browserId()) : '') }, call.id)
  try {
    // 复用浏览器接管、策略、运行包授权、操作回执和持久检查点校验。
    await gate.liveContext()
    await store.flushChatCheckpoint()
    const result = await redactNative(await execute(call))
    let error = ''
    try { const parsed = JSON.parse(result); if (parsed.ok === false || parsed.error || parsed.denied) error = String(parsed.error || '工具未成功执行') } catch { /* Text tool result. */ }
    if (error) run.fail(new Error(error))
    else await run.finish('completed')
    store.patchMessage(sessionId, assistantId, { content: result, status: error ? 'failed' : 'done', error: error || undefined })
  } catch (error) {
    if (!abort.signal.aborted) run.fail(error)
    store.patchMessage(sessionId, assistantId, { status: abort.signal.aborted ? 'stopped' : 'failed', error: await redactNative(error instanceof Error ? error.message : String(error)) })
  } finally {
    stopApprovalWatch(); run.dispose()
    if (store.chatAborts.get(sessionId) === abort) store.chatAborts.delete(sessionId)
    await store.flushChatCheckpoint().catch(() => undefined)
  }
}
