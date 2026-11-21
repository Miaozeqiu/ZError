import { publishWebsiteQuestions } from './observations'
import { browserDocuments, documentRecord, sameBrowserDocument } from '../../browser/documents'
import type { ChatToolContext } from '../toolContext'
import { createWebsiteServiceBroker, serviceMutation, type ServiceIdentity } from './serviceBroker'
import { packageState } from './packageState'
import type { HomeworkProgressUpdate } from '../homeworkProgress'

type Entry = { sessionId: string; browserId: string; execute: ReturnType<typeof createWebsiteServiceBroker>['execute'] }
const scopes = new Map<string, Entry>()

export function registerWebsiteServices(input: { ctx: ChatToolContext; browserId: string; host: string; owner: string; signal: AbortSignal; pause: () => void; resume: () => void; background?: boolean }) {
  const { ctx, signal } = input
  const stateOwner = input.owner
  const identity = async () => {
    const auth = await import('../../app/auth')
    return auth.authToken.value && auth.authUser.value ? { principal: String(auth.authUser.value.id), token: auth.authToken.value, revision: auth.authRevision.value } : undefined
  }
  let authModule: typeof import('../../app/auth')
  const ready = import('../../app/auth').then(value => { authModule = value })
  const broker = createWebsiteServiceBroker({ signal, pause: input.pause, resume: input.resume,
    identity: (): ServiceIdentity | undefined => authModule?.authToken.value && authModule.authUser.value
      ? { principal: String(authModule.authUser.value.id), token: authModule.authToken.value, revision: authModule.authRevision.value } : undefined,
    login: async replace => {
      await ready
      if (!replace && await identity()) return true
      if (replace) authModule.clearAuthSession()
      return new Promise<boolean>((resolve, reject) => {
        const cleanup = () => { signal.removeEventListener('abort', abort); window.removeEventListener('login-dialog-finished', finished) }
        const abort = () => { cleanup(); reject(new DOMException('已停止', 'AbortError')) }
        const finished = (event: Event) => { cleanup(); resolve((event as CustomEvent).detail === true && Boolean(authModule.authToken.value)) }
        signal.addEventListener('abort', abort, { once: true }); window.addEventListener('login-dialog-finished', finished)
        if (signal.aborted) { abort(); return }
        authModule.openLoginDialog()
      })
    },
    request: async (path, init) => {
      const { AUTH_API_BASE, remoteFetch } = await import('../../app/remoteHttp')
      // The provider is configured by the application; packages only supply relative paths.
      const target = new URL(path, AUTH_API_BASE)
      if (target.origin !== new URL(AUTH_API_BASE).origin || target.username || target.password || target.hash) throw new Error('服务请求越界')
      return remoteFetch(target.href, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }, false)
    },
    search: async args => {
      const { invoke } = await import('@tauri-apps/api/core')
      const [rows] = await invoke<unknown[][]>('lookup_homework_bank_answers', { questions: [{ title: args.title, type: args.type, options: args.options || null }] })
      return rows || []
    },
    generate: async (prompt, system) => {
      const { runTextModel } = await import('../../model/runner')
      return runTextModel(prompt, undefined, { systemPrompt: system, signal, tools: [], maxRounds: 1, outputTokenLimit: 2048, timeoutMs: 45000 })
    },
    publish: async value => {
      const { recordHomeworkProgress, liveSession } = await import('../chatStore')
      const session = ctx.parentSessionId || ctx.sessionId
      if (!liveSession(session)) throw new Error('对话已删除')
      const document = documentRecord((value as Record<string, unknown>).document)
      const fresh = (await browserDocuments(input.browserId, input.host)).documents
      signal.throwIfAborted()
      if (!fresh.some(row => sameBrowserDocument(row, document))) throw new Error('题目文档已更换，未发布旧题目')
      recordHomeworkProgress(session, ctx.parentAssistantId || ctx.assistantId || undefined, value as HomeworkProgressUpdate)
      publishWebsiteQuestions(input.browserId, session, fresh[0].url, (value as HomeworkProgressUpdate).assignmentId)
    },
    readStates: (principal, keys) => packageState.readMany(stateOwner, principal, keys),
    readState: (principal, key) => packageState.read(stateOwner, principal, key),
    writeState: (principal, key, value) => packageState.write(stateOwner, principal, key, value),
  }, input.background)
  const id = crypto.randomUUID()
  scopes.set(id, { sessionId: ctx.sessionId, browserId: input.browserId,
    execute: async (op, args) => { await ready; return broker.execute(op, args) } })
  return { id, dispose: () => { scopes.delete(id); broker.dispose() } }
}
export async function executeWebsiteService(name: string, args: Record<string, unknown>, ctx: ChatToolContext, browserId: string) {
  const scope = scopes.get(String(args.service_scope))
  if (!scope || scope.sessionId !== ctx.sessionId || scope.browserId !== browserId || !args.request || typeof args.request !== 'object' || Array.isArray(args.request)) throw new Error('网站服务授权已撤销')
  const op = String(args.service_op), request = args.request as Record<string, unknown>
  if (name === 'browser_package_read' && serviceMutation(op, request)) throw new Error('服务写入不能通过只读接口执行')
  return scope.execute(op, request)
}
