import { registerWebsiteServices } from './services'
import type { ChatToolContext } from '../toolContext'
import { installedWebsiteRuntimeTool, websiteRuntimeAuthorityActive, onWebsiteRepositoryChanged } from '../websiteRepository'
import { getAgentPolicy } from '../agentPolicy'
import { onAppBrowserClosed } from '../../browser/appBrowser'
import { browserDocuments } from '../../browser/documents'
import { watch } from 'vue'
import { redactNative } from '../../security/secureStore'
import { executeWebsitePackage } from './execute'
import { waitForWebsitePage } from './pageEvents'
import { WEBSITE_TOOL_TIMEOUT_MS } from './protocol'
import { scopedWebsiteHost } from './scopedHost'
import { websiteCheckpoints, sameWorkflowInput, type WebsiteCheckpoint } from './checkpoints'
import { validateWebsiteRuntime, verifyWebsiteRuntime } from './protocol'

const activeInvocations = new Map<string, { background: boolean; control: AbortController; finished: Promise<void> }>()
export async function executeInstalledWebsiteTool(name: string, args: unknown, ctx: ChatToolContext, browserId: string, options: { background?: boolean } = {}) {
  // A tab can belong to a parent chat and a subagent. They still share one document.
  const key = browserId
  let previous = activeInvocations.get(key)
  if (previous?.background && !options.background) {
    previous.control.abort(new DOMException('前台操作接管', 'AbortError'))
    await previous.finished
    ctx.abort.throwIfAborted()
    previous = activeInvocations.get(key)
  }
  if (previous) return JSON.stringify({ ok: false, reason: 'busy', error: '当前标签已有网站流程正在运行' })
  let finish!: () => void
  const invocation = { background: options.background === true, control: new AbortController(), finished: new Promise<void>(resolve => { finish = resolve }) }
  activeInvocations.set(key, invocation)
  try { return await runInstalledWebsiteTool(name, args, ctx, browserId, invocation.background, invocation.control) }
  finally { if (activeInvocations.get(key) === invocation) activeInvocations.delete(key); finish() }
}

async function runInstalledWebsiteTool(name: string, args: unknown, ctx: ChatToolContext, browserId: string, background: boolean, scope: AbortController) {
  let installed = installedWebsiteRuntimeTool(name)
  if (!installed || !ctx.invokeHostTool) return JSON.stringify({ ok: false, reason: 'invalid', error: '网站工具未安装或运行时不可用' })
  let saved: WebsiteCheckpoint | undefined
  try {
    saved = (await websiteCheckpoints.list(ctx.sessionId)).find(entry => entry.name === name)
    if (saved) {
      if (saved.browserId !== browserId || saved.installed.source !== installed.source || !sameWorkflowInput(saved.input, args)
        || saved.installed.host !== installed.host || saved.installed.siteId !== installed.siteId) {
        return JSON.stringify({ ok: false, reason: 'workflow_conflict', workflow_id: saved.id, error: '存在其他范围的未完成流程，请先查看或处理检查点' })
      }
      const runtime = validateWebsiteRuntime(saved.installed.runtime, installed.siteId)
      await verifyWebsiteRuntime(runtime)
      const tool = runtime.tools.find(tool => tool.name === installed!.tool.name)
      if (!tool) throw new Error('检查点缺少原工具定义')
      installed = { ...saved.installed, runtime, tool, authority: installed.authority }
    }
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
  const pinned = installed
  if (background && !pinned.runtime.automations?.some(row => row.event === 'page' && row.tool === pinned.tool.name)) {
    return JSON.stringify({ ok: false, reason: 'invalid', error: '此工具未声明后台自动运行权限' })
  }
  const checkpointId = saved?.id ?? crypto.randomUUID()
  let checkpointWritten = Boolean(saved)
  const abort = () => scope.abort(ctx.abort.reason)
  ctx.abort.addEventListener('abort', abort, { once: true })
  if (ctx.abort.aborted) abort()
  const active = () => ctx.browserId() === browserId && websiteRuntimeAuthorityActive(pinned)
  const revoke = () => { if (!active()) scope.abort(new Error('网站工具的执行权已撤销')) }
  const stopRepository = onWebsiteRepositoryChanged(host => { if (host === installed.host) revoke() })
  const stopBrowser = onAppBrowserClosed(id => { if (id === browserId) scope.abort(new Error('浏览器已关闭')) })
  const stopSelection = watch(() => ctx.browserId(), revoke, { flush: 'sync' })
  let remaining = WEBSITE_TOOL_TIMEOUT_MS, started = performance.now()
  let deadline: ReturnType<typeof setTimeout> | undefined
  const resume = () => {
    if (scope.signal.aborted) return
    started = performance.now()
    deadline = setTimeout(() => scope.abort(new Error('网站工具超过单次执行时间限制')), Math.max(0, remaining))
  }
  const pause = () => { clearTimeout(deadline); remaining -= performance.now() - started }
  resume()
  const services = registerWebsiteServices({ ctx, browserId, host: pinned.host, owner: pinned.host + '\n' + (pinned.source || ''), signal: scope.signal, pause, resume, background })
  const scoped = scopedWebsiteHost({ serviceScope: services.id, host: installed.host, browserId, ctx, signal: scope.signal, pause, resume })
  try {
    const result = await executeWebsitePackage(pinned, args, {
      signal: scope.signal, browserId,
      readOnly: () => ctx.role === 'explore' || getAgentPolicy().permissionMode === 'strict',
      isActive: active,
      currentUrl: async allowFrames => {
        const state = await browserDocuments(browserId, installed.host)
        if (!allowFrames && (state.documents.length > 1 || state.blockedFrames > 0)) throw new Error('包含 iframe 的页面请使用绑定文档身份的 document 命令')
        return state.documents[0].url
      },
      scoped: async (command, input) => await redactNative(await scoped.execute(command, input)),
      checkpoint: async state => {
        await websiteCheckpoints.save({ id: checkpointId, sessionId: ctx.sessionId, browserId, name, installed: pinned,
          input: args as Record<string, unknown>, state, updatedAt: Date.now() })
        checkpointWritten = true
        return { ok: true, checkpoint_id: checkpointId }
      },
      invoke: async (tool, input) => {
        const output = await ctx.invokeHostTool!(tool, input)
        return await redactNative(output)
      },
      delay: ms => new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('已停止', 'AbortError')) }
        const timer = setTimeout(() => { scope.signal.removeEventListener('abort', abort); resolve() }, ms)
        scope.signal.addEventListener('abort', abort, { once: true })
        if (scope.signal.aborted) abort()
      }),
      waitForPage: ms => waitForWebsitePage(browserId, scope.signal, ms),
    }, saved ? { state: saved.state, checkpoint_id: saved.id, requiresObservation: true } : undefined)
    if (checkpointWritten && (result.result as Record<string, unknown>).workflowPending !== true) await websiteCheckpoints.remove(ctx.sessionId, checkpointId)
    return JSON.stringify(await redactNative(result))
  } catch (error) {
    if (ctx.abort.aborted) throw error
    return JSON.stringify(await redactNative({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  } finally {
    clearTimeout(deadline)
    scoped.dispose(); services.dispose()
    ctx.abort.removeEventListener('abort', abort)
    stopRepository(); stopBrowser(); stopSelection()
  }
}
