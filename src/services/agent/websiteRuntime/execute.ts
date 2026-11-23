import { serviceMutation } from './serviceBroker'
import { withWebsiteSandbox } from './sandbox'
import { websiteHostAwait } from './abortable'
import { validateWebsiteValue, verifyWebsiteRuntime, type InstalledWebsiteTool, type WebsiteCommandName } from './protocol'

export type WebsiteHost = {
  signal: AbortSignal
  browserId: string
  readOnly: () => boolean
  isActive: () => boolean
  currentUrl: (scopedDocument?: boolean) => Promise<string>
  invoke: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  waitForPage: (timeoutMs: number) => Promise<Record<string, unknown>>
  delay: (ms: number) => Promise<void>
  scoped?: (command: WebsiteCommandName, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  checkpoint?: (state: Record<string, unknown>) => Promise<Record<string, unknown>>
}
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
})
const string = { type: 'string' }
const target = { ref: string }
const document = objectSchema({ frameId: string, loaderId: string, url: string }, ['frameId', 'loaderId', 'url'])
const element = { document, selector: string, nth: { type: 'integer', minimum: 1, maximum: 100 } }
const commands: Record<WebsiteCommandName, { tool?: string; scoped?: boolean; mutates: boolean; schema: Record<string, unknown> }> = {
  'context.publish': { scoped: true, mutates: false, schema: objectSchema({ document, json: string }, ['document', 'json']) },
  'resource.read': { scoped: true, mutates: false, schema: objectSchema({ id: string, offset: { type: 'integer', minimum: 0, maximum: 1048576 }, length: { type: 'integer', minimum: 1, maximum: 8192 } }, ['id', 'offset', 'length']) },
  'browser.observe': { tool: 'browser_get_page', mutates: false, schema: objectSchema({}) },
  'browser.navigate': { tool: 'browser_navigate', mutates: true, schema: objectSchema({ url: string }, ['url']) },
  'browser.click': { tool: 'browser_click', mutates: true, schema: objectSchema(target, ['ref']) },
  'browser.fill': { tool: 'browser_type', mutates: true, schema: objectSchema({ ...target, text: string }, ['ref', 'text']) },
  'browser.press': { tool: 'browser_press', mutates: true, schema: objectSchema({ key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] } }, ['key']) },
  'browser.scroll': { tool: 'browser_scroll', mutates: true, schema: objectSchema({ amount: { type: 'integer', minimum: -10000, maximum: 10000 } }, ['amount']) },
  'browser.wait': { mutates: false, schema: objectSchema({ ms: { type: 'integer', minimum: 0, maximum: 30000 } }, ['ms']) },
  'page.wait': { mutates: false, schema: objectSchema({ timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 } }, ['timeoutMs']) },
  'document.list': { scoped: true, mutates: false, schema: objectSchema({}) },
  'document.frames': { scoped: true, mutates: false, schema: objectSchema(element, ['document', 'selector']) },
  'document.query': { scoped: true, mutates: false, schema: objectSchema({ ...element, attributes: { type: 'array', maxItems: 12, items: string }, limit: { type: 'integer', minimum: 1, maximum: 40 }, offset: { type: 'integer', minimum: 0, maximum: 10000 } }, ['document', 'selector', 'limit']) },
  'document.glyphs': { scoped: true, mutates: false, schema: objectSchema({ ...element, characters: string,
    raster: objectSchema({ size: { type: 'integer', minimum: 32, maximum: 512 }, fontSize: { type: 'integer', minimum: 16, maximum: 512 }, baseline: { type: 'integer', minimum: 0, maximum: 512 }, threshold: { type: 'integer', minimum: 0, maximum: 255 }, coarse: { type: 'integer', minimum: 8, maximum: 32 }, fine: { type: 'integer', minimum: 8, maximum: 32 } }, ['size', 'fontSize', 'baseline', 'threshold', 'coarse', 'fine']) }, ['document', 'selector', 'characters', 'raster']) },
  'document.reveal': { scoped: true, mutates: true, schema: objectSchema(element, ['document', 'selector']) },
  'document.scroll': { scoped: true, mutates: true, schema: objectSchema({ ...element, amount: { type: 'integer', minimum: -10000, maximum: 10000 } }, ['document', 'selector', 'amount']) },
  'document.select': { scoped: true, mutates: true, schema: objectSchema({ ...element, index: { type: 'integer', minimum: 1, maximum: 10000 } }, ['document', 'selector', 'index']) },
  'document.value': { scoped: true, mutates: false, schema: objectSchema(element, ['document', 'selector']) },
  'document.image': { scoped: true, mutates: false, schema: objectSchema(element, ['document', 'selector']) },
  'document.compare': { scoped: true, mutates: false, schema: objectSchema({ ...element, text: string }, ['document', 'selector', 'text']) },
  'document.navigate': { scoped: true, mutates: true, schema: objectSchema({ document, url: string }, ['document', 'url']) },
  'document.click': { scoped: true, mutates: true, schema: objectSchema(element, ['document', 'selector']) },
  'document.fill': { scoped: true, mutates: true, schema: objectSchema({ ...element, text: string }, ['document', 'selector', 'text']) },
  'media.read': { scoped: true, mutates: false, schema: objectSchema(element, ['document', 'selector']) },
  'media.wait': { scoped: true, mutates: false, schema: objectSchema({ ...element, until: { type: 'string', enum: ['ended', 'playing', 'paused'] }, timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 } }, ['document', 'selector', 'until', 'timeoutMs']) },
  'media.play': { scoped: true, mutates: true, schema: objectSchema(element, ['document', 'selector']) },
  'media.pause': { scoped: true, mutates: true, schema: objectSchema(element, ['document', 'selector']) },
  'media.mute': { scoped: true, mutates: true, schema: objectSchema({ ...element, muted: { type: 'boolean' } }, ['document', 'selector', 'muted']) },
  'credentials.request': { scoped: true, mutates: true, schema: objectSchema({ document, replaceRejected: { type: 'boolean' } }, ['document']) },
  'credentials.fill': { scoped: true, mutates: true, schema: objectSchema({ ...element, credential_id: string, field: { type: 'string', enum: ['account', 'password'] } }, ['document', 'selector', 'credential_id', 'field']) },
  'service.session': { scoped: true, mutates: false, schema: objectSchema({ service: { type: 'string', enum: ['account'] }, interactive: { type: 'boolean' }, replace: { type: 'boolean' } }, ['service']) },
  'service.check': { scoped: true, mutates: false, schema: objectSchema({ session_id: string }, ['session_id']) },
  'service.request': { scoped: true, mutates: false, schema: objectSchema({ session_id: string, path: string, method: { type: 'string', enum: ['GET', 'POST'] }, token_location: { type: 'string', enum: ['query', 'header'] }, token_name: string,
    query: { type: 'array', maxItems: 32, items: objectSchema({ name: string, value: string }, ['name', 'value']) }, json: string, payload_id: string }, ['session_id', 'path', 'method', 'token_location']) },
  'service.read': { scoped: true, mutates: false, schema: objectSchema({ session_id: string, request_id: string, pointer: string, offset: { type: 'integer', minimum: 0, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 32 } }, ['session_id', 'request_id', 'pointer']) },
  'payload.from_state': { scoped: true, mutates: false, schema: objectSchema({ session_id: string, keys: { type: 'array', maxItems: 512, items: string }, json: string, pointer: string, source_pointer: string }, ['session_id', 'keys', 'json', 'pointer', 'source_pointer']) },
  'payload.create': { scoped: true, mutates: false, schema: objectSchema({ json: string }, ['json']) },
  'payload.append': { scoped: true, mutates: false, schema: objectSchema({ payload_id: string, pointer: string, json: string }, ['payload_id', 'pointer', 'json']) },
  'state.read': { scoped: true, mutates: false, schema: objectSchema({ session_id: string, key: string }, ['session_id', 'key']) },
  'state.write': { scoped: true, mutates: true, schema: objectSchema({ session_id: string, key: string, json: { anyOf: [string, { type: 'null' }] } }, ['session_id', 'key', 'json']) },
  'knowledge.search': { scoped: true, mutates: false, schema: objectSchema({ title: string, type: { type: 'string', enum: ['single', 'multiple', 'judgement', 'completion'] }, options: string }, ['title', 'type']) },
  'model.generate': { scoped: true, mutates: true, schema: objectSchema({ prompt: string, system: string }, ['prompt', 'system']) },
  'questions.publish': { scoped: true, mutates: false, schema: objectSchema({ document, assignmentId: string, title: string, total: { type: 'integer', minimum: 0, maximum: 10000 }, phase: { type: 'string', enum: ['read', 'result'] },
    questions: { type: 'array', maxItems: 8, items: objectSchema({ question_id: string, number: { type: 'integer', minimum: 1 }, order: { type: 'integer', minimum: 1 }, type: string, stem: string, status: string, source: { type: 'string', enum: ['bank', 'agent'] },
      options: { type: 'array', maxItems: 32, items: objectSchema({ label: string, text: string }, ['label', 'text']) }, actual: objectSchema({ choices: { type: 'array', maxItems: 32, items: string }, blanks: { type: 'array', maxItems: 32, items: string } }) }, ['question_id', 'number', 'order', 'type', 'stem', 'status', 'options', 'actual']) } }, ['document', 'assignmentId', 'total', 'phase', 'questions']) },
  'workflow.checkpoint': { scoped: true, mutates: false, schema: objectSchema({ state: { type: 'object' } }, ['state']) },
}
const sameSite = (raw: string, host: string) => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && (url.hostname === host || url.hostname.endsWith('.' + host))
  } catch { return false }
}

/** Every yielded command is validated again by the host. The package has no I/O globals. */
export async function executeWebsitePackage(binding: InstalledWebsiteTool, input: unknown, host: WebsiteHost, resume?: Record<string, unknown>) {
  const pinned: InstalledWebsiteTool = JSON.parse(JSON.stringify(binding))
  const active = () => {
    host.signal.throwIfAborted()
    if (!host.isActive()) throw new Error('网站工具已卸载或来源已改变')
  }
  active()
  validateWebsiteValue(input, pinned.tool.parameters, '网站工具参数')
  await verifyWebsiteRuntime(pinned.runtime)
  const resourceBytes = new Map<string, Uint8Array>()
  active()
  return withWebsiteSandbox(async evaluate => {
    active()
    evaluate(`${pinned.runtime.bundle.code}\n;const __websiteTask = ZErrorSitePackage.create(${JSON.stringify({ tool: pinned.tool.name, args: input, ...(resume ? { resume } : {}) })}); JSON.stringify(true)`, true)
    let requiresResumeRead = Boolean(resume), observed = false
    let response: unknown = null
    for (let index = 0; index < 512; index++) {
      active()
      const step = evaluate(`JSON.stringify(__websiteTask.next(${JSON.stringify(response)}))`) as { done?: unknown; value?: unknown } | null
      if (!step || typeof step !== 'object' || typeof step.done !== 'boolean') throw new Error('网站流程回执无效')
      if (step.done) {
        if (requiresResumeRead) throw new Error('流程恢复后必须先核对实际页面')
        validateWebsiteValue(step.value, pinned.tool.result, '网站工具结果')
        return { ok: true, observed, repository: { id: pinned.siteId, revision: pinned.revision, sha256: pinned.runtime.bundle.sha256 }, result: step.value }
      }
      const command = step.value as { op?: unknown; args?: unknown } | null
      if (!command || typeof command.op !== 'string' || !Object.hasOwn(commands, command.op)
        || !pinned.tool.commands.includes(command.op as WebsiteCommandName)) throw new Error('网站流程请求了未声明的宿主能力')
      const spec = commands[command.op as WebsiteCommandName]
      validateWebsiteValue(command.args, spec.schema, '宿主命令参数')
      const args = command.args as Record<string, unknown>
      if ((spec.mutates || serviceMutation(command.op, args)) && host.readOnly()) throw new Error('当前权限只允许网站工具读取页面')
      if ((spec.mutates || serviceMutation(command.op, args)) && requiresResumeRead) throw new Error('流程恢复后先读取实际页面，不得直接重放操作')
      if (command.op === 'workflow.checkpoint' && requiresResumeRead) throw new Error('恢复核对前不能覆盖检查点')
      const localResource = command.op === 'resource.read'
      // Public, hash-pinned package assets do not access a tab. Avoid a native
      // frame-tree round trip for every small resource page; real DOM operations
      // still revalidate the current realm and exact document below.
      if (!localResource && (!sameSite(await websiteHostAwait(host.signal, () => host.currentUrl(spec.scoped || ['browser.wait', 'page.wait'].includes(String(command.op)))), pinned.host)
        || ['browser.navigate', 'document.navigate'].includes(command.op) && !sameSite(String(args.url), pinned.host))) {
        throw new Error('网站工具试图操作其域名范围之外的网页')
      }
      active()
      if (spec.mutates && /^(?:browser\.|document\.|media\.|credentials\.)/.test(command.op)) observed = false
      if (command.op === 'resource.read') {
        const resource = pinned.runtime.resources?.find(row => row.id === args.id)
        if (!resource) throw new Error('运行包未声明此资源')
        let bytes = resourceBytes.get(resource.id)
        if (!bytes) { bytes = Uint8Array.from(atob(resource.data), ch => ch.charCodeAt(0)); resourceBytes.set(resource.id, bytes) }
        const offset = Number(args.offset), end = Math.min(bytes.length, offset + Number(args.length))
        if (offset >= bytes.length) throw new Error('网站资源读取越界')
        response = { ok: true, bytes: Array.from(bytes.subarray(offset, end)), total: bytes.length, next_offset: end < bytes.length ? end : -1 }
      } else if (command.op === 'workflow.checkpoint') {
        if (!host.checkpoint) throw new Error('宿主未提供持久流程检查点')
        response = await websiteHostAwait(host.signal, () => host.checkpoint!(args.state as Record<string, unknown>))
      } else if (spec.scoped) {
        if (!host.scoped) throw new Error('宿主未提供文档或凭据能力')
        response = await websiteHostAwait(host.signal, () => host.scoped!(command.op as WebsiteCommandName, args))
      } else if (command.op === 'browser.wait') {
        await websiteHostAwait(host.signal, () => host.delay(Number(args.ms)))
        response = { ok: true }
      } else if (command.op === 'page.wait') {
        response = await websiteHostAwait(host.signal, () => host.waitForPage(Number(args.timeoutMs)))
      } else {
        response = await websiteHostAwait(host.signal, () => host.invoke(spec.tool!, args))
      }
      active()
      const receipt = response as Record<string, unknown> | null
      const actualRead = command.op === 'browser.observe'
        ? typeof receipt?.snapshot === 'string' && Boolean(receipt.snapshot.trim())
        : (command.op === 'document.query' || command.op === 'media.read') && receipt?.ok === true
      if (actualRead && receipt?.ok !== false && !receipt?.error && receipt?.denied !== true) { requiresResumeRead = false; observed = true }
      // A redirect must be checked before any page data is returned to package code.
      if (!localResource && !sameSite(await websiteHostAwait(host.signal, () => host.currentUrl(spec.scoped || ['browser.wait', 'page.wait'].includes(String(command.op)))), pinned.host)) throw new Error('网页已离开网站工具的域名范围，请重新核对')
      const serialized = JSON.stringify(response)
      if (new TextEncoder().encode(serialized).length > 128 * 1024) throw new Error('网站命令结果超过大小限制')
    }
    throw new Error('网站流程超过执行预算')
  })
}
