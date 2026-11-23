import { startNativeWatch, stopNativeWatch, nativeWatchFor, type NativeVideoTick } from '../../browser/videoWatch'
import { publishWebsiteObservation } from './observations'
import { serviceMutation } from './serviceBroker'
import type { ChatToolContext } from '../toolContext'
import type { WebsiteCommandName } from './protocol'
import { requestChatLogin } from '../chatLogin'
import { browserDocuments, documentRecord, sameBrowserDocument, type BrowserDocument } from '../../browser/documents'

type References = { account: string; password: string }
type Grant = { document: BrowserDocument; references: References; fields: Set<string> }
const actions: Partial<Record<WebsiteCommandName, string>> = {
  'document.glyphs': 'glyphs',
  'document.frames': 'frames', 'document.reveal': 'reveal',
  'document.value': 'value', 'document.scroll': 'scroll', 'document.select': 'select', 'document.image': 'image', 'document.compare': 'compare', 'document.navigate': 'navigate', 'document.list': 'list', 'document.query': 'query', 'document.click': 'click', 'document.fill': 'fill',
  'media.read': 'media_read', 'media.play': 'media_play', 'media.pause': 'media_pause', 'media.mute': 'media_mute',
}

export function scopedWebsiteHost(input: {
  host: string; browserId: string; ctx: ChatToolContext; signal: AbortSignal
  pause: () => void; resume: () => void; serviceScope?: string
}) {
  const grants = new Map<string, Grant>()
  let watchKey = '', closed = false, ownedWatchId: number | undefined
  const active = () => { input.signal.throwIfAborted(); if (closed) throw new Error('网站宿主授权已释放') }
  const mediaSamples = new Map<string, Record<string, any>>()
  const invoke = (action: string, args: Record<string, unknown>) => {
    if (action !== 'media_cancel') active()
    return input.ctx.invokeHostTool!(
    ['list', 'frames', 'query', 'glyphs', 'value', 'image', 'compare', 'media_read', 'media_wait', 'media_cancel'].includes(action) ? 'browser_package_read' : 'browser_package_act',
    { ...args, host: input.host, action },
    )
  }
  const currentDocument = async (value: unknown) => {
    active()
    const expected = documentRecord(value)
    const current = (await browserDocuments(input.browserId, input.host)).documents.find(row => sameBrowserDocument(row, expected))
    active()
    if (!current) throw new Error('当前文档已更换，请重新读取')
    return current
  }
  return {
    dispose: () => { closed = true; grants.clear(); mediaSamples.clear(); if (watchKey && nativeWatchFor(input.browserId)?.watchId === ownedWatchId) stopNativeWatch(input.browserId); watchKey = '' },
    execute: async (command: WebsiteCommandName, args: Record<string, unknown>) => {
      active()
      if (command === 'context.publish') {
        const expected = await currentDocument(args.document)
        const fresh = (await browserDocuments(input.browserId, input.host)).documents
        active()
        if (!fresh.some(row => sameBrowserDocument(row, expected))) throw new Error('当前文档已更换，请重新读取')
        const root = fresh[0]
        publishWebsiteObservation(input.browserId, input.ctx.parentSessionId || input.ctx.sessionId, root.url, String(args.json))
        return { ok: true }
      }
      if (/^(?:service|payload|state|knowledge|model|questions)\./.test(command)) {
        if (!input.serviceScope) throw new Error('宿主未授权通用服务')
        return input.ctx.invokeHostTool!(serviceMutation(command, args) ? 'browser_package_act' : 'browser_package_read',
          { host: input.host, action: 'service', service_scope: input.serviceScope, service_op: command, request: args })
      }
      if (command === 'media.wait') {
        const key = JSON.stringify([args.document, args.selector, args.nth])
        if (watchKey !== key) {
          const tick = (value: Record<string, any>): NativeVideoTick | null => value.ok === false || !Number.isFinite(value.duration) ? null
            : { hasVideo: true, current: Number(value.current) || 0, duration: value.duration, paused: value.paused === true, ended: value.ended === true, src: String(value.src || '') }
          const seed = mediaSamples.has(key) ? tick(mediaSamples.get(key)!) : null
          if (seed) {
            input.signal.throwIfAborted()
            watchKey = key
            ownedWatchId = startNativeWatch(input.browserId, input.ctx.parentSessionId || input.ctx.sessionId, seed, {
              handledByTool: true, readTick: async () => {
                if (closed || input.signal.aborted) return null
                return tick(await invoke('media_read', args))
              },
            })?.watchId
          }
        }
        input.signal.throwIfAborted()
        const wait_id = crypto.randomUUID()
        const cleanup = () => { void invoke('media_cancel', { ...args, wait_id }).catch(() => undefined) }
        input.pause()
        input.signal.addEventListener('abort', cleanup, { once: true })
        try { return await invoke('media_wait', { ...args, wait_id }) }
        finally { input.signal.removeEventListener('abort', cleanup); input.resume() }
      }
      if (command === 'credentials.request') {
        if (grants.size >= 4) throw new Error('本次工具请求凭据过于频繁，请核对登录结果')
        const document = await currentDocument(args.document)
        const origin = new URL(document.url).origin
        input.pause()
        let receipt: Awaited<ReturnType<typeof requestChatLogin>>
        try {
          receipt = await requestChatLogin(input.ctx.parentSessionId || input.ctx.sessionId, input.browserId, input.signal, {
            expectedOrigin: origin, replacingRejectedCredentials: args.replaceRejected === true,
            targetDocument: { host: input.host, document },
          })
        } finally { input.resume() }
        active()
        if (!receipt.ok) return receipt
        await currentDocument(document)
        const id = crypto.randomUUID()
        grants.set(id, { document, references: receipt.references, fields: new Set() })
        return { ok: true, credential_id: id }
      }
      if (command === 'credentials.fill') {
        const grant = grants.get(String(args.credential_id))
        const field = String(args.field)
        if (!grant || !['account', 'password'].includes(field) || !sameBrowserDocument(grant.document, documentRecord(args.document))) {
          throw new Error('凭据授权与当前文档不匹配')
        }
        if (grant.fields.has(field)) throw new Error('该凭据已发出填写操作，请先核对页面，不能直接重放')
        await currentDocument(grant.document)
        input.signal.throwIfAborted()
        grant.fields.add(field)
        return invoke('fill_secret', { document: grant.document, selector: args.selector,
          ...(args.nth === undefined ? {} : { nth: args.nth }), secret_ref: grant.references[field as keyof References] })
      }
      const action = actions[command]
      if (!action) throw new Error('未知的文档宿主操作')
      const receipt = await invoke(action, args)
      active()
      if (command.startsWith('media.') && receipt.ok !== false) {
        const key = JSON.stringify([args.document, args.selector, args.nth])
        if (!mediaSamples.has(key) && mediaSamples.size >= 4) mediaSamples.delete(mediaSamples.keys().next().value!)
        mediaSamples.set(key, receipt)
      }
      return receipt
    },
  }
}
