/** Invocation-scoped capabilities. Packages never receive application tokens or a raw fetch function. */
export type ServiceIdentity = { principal: string; token: string; revision: number }
export type WebsiteServiceDependencies = {
  signal: AbortSignal
  identity: () => ServiceIdentity | undefined
  login: (replace: boolean) => Promise<boolean>
  request: (path: string, init: RequestInit) => Promise<Response>
  search: (query: Record<string, unknown>) => Promise<unknown>
  generate: (prompt: string, system: string) => Promise<string>
  publish: (value: unknown) => Promise<void>
  readStates: (principal: string, keys: string[]) => Promise<Array<string | null>>
  readState: (principal: string, key: string) => Promise<string | null>
  writeState: (principal: string, key: string, value: string | null) => Promise<void>
  pause: () => void; resume: () => void
}
const size = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value))
export function serviceMutation(op: string, args: Record<string, unknown>) {
  return op === 'service.session' ? args.interactive === true || args.replace === true
    : op === 'service.request' ? args.method !== 'GET'
    : ['state.write', 'model.generate'].includes(op)
}
export function createWebsiteServiceBroker(deps: WebsiteServiceDependencies, background = false) {
  const grants = new Map<string, ServiceIdentity>(), responses = new Map<string, unknown>(), payloads = new Map<string, unknown>()
  let closed = false, loginRequests = 0, rejected: ServiceIdentity | undefined
  const isRejected = (identity: ServiceIdentity) => rejected?.principal === identity.principal && rejected.token === identity.token && rejected.revision === identity.revision
  const active = () => { deps.signal.throwIfAborted(); if (closed) throw new Error('网站服务授权已释放') }
  const current = (id: unknown) => {
    active()
    const grant = grants.get(String(id)), identity = deps.identity()
    if (!grant || !identity || grant.principal !== identity.principal || grant.token !== identity.token || grant.revision !== identity.revision) throw new Error('服务账号已变化，请重新取得登录授权')
    return grant
  }
  const redact = (value: unknown) => {
    const tokens = [...new Set([...grants.values()].map(value => value.token).concat(deps.identity()?.token || '').filter(Boolean))]
      .flatMap(token => [token, encodeURIComponent(token)]).sort((a, b) => b.length - a.length)
    const text = (input: string) => tokens.reduce((result, token) => result.split(token).join('[credential]'), input)
    const visit = (input: unknown, depth = 0): unknown => {
      if (depth > 64) throw new Error('服务响应嵌套过深')
      if (typeof input === 'string') return text(input)
      if (Array.isArray(input)) return input.map(item => visit(item, depth + 1))
      if (object(input)) return Object.fromEntries(Object.entries(input).map(([key, item]) => [text(key), visit(item, depth + 1)]))
      return input
    }
    return visit(value)
  }
  const pointer = (value: unknown, path: unknown) => {
    if (typeof path !== 'string' || path.length > 1024 || path && !path.startsWith('/')) throw new Error('JSON 路径无效')
    for (const part of path ? path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')) : []) {
      if (['__proto__', 'prototype', 'constructor'].includes(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
      value = (value as Record<string, unknown>)[part]
    }
    return value
  }
  const boundedJson = async (response: Response) => {
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024 || !response.body) throw new Error('服务响应过大或没有正文')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    const abort = () => { void reader.cancel().catch(() => undefined) }
    deps.signal.addEventListener('abort', abort, { once: true })
    let bytes = 0
    try {
      while (true) {
        active()
        const { done, value } = await reader.read()
        active()
        if (done) break
        if ((bytes += value.length) > 8 * 1024 * 1024) throw new Error('服务响应超过限制')
        chunks.push(value)
      }
      const all = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(all)
      try { return redact(text.trim() ? JSON.parse(text) : null) } catch { return redact({ text: text.slice(0, 8192) }) }
    } finally { deps.signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined) }
  }
  return {
    dispose() { closed = true; grants.clear(); responses.clear(); payloads.clear(); rejected = undefined },
    async execute(op: string, args: Record<string, any>): Promise<Record<string, any>> {
      active()
      if (background && (op === 'model.generate' || op === 'service.session' && (args.interactive || args.replace))) throw new Error('后台事件不能弹出登录或产生模型调用')
      if (op === 'service.session') {
        if (args.service !== 'account') throw new Error('服务未配置')
        if (!args.replace && deps.identity() && isRejected(deps.identity()!)) return { ok: true, authenticated: false, authenticationRejected: true }
        if (args.replace && (!rejected || deps.identity()?.token !== rejected.token || deps.identity()?.principal !== rejected.principal)) throw new Error('没有可重新认证的失效会话')
        if (!deps.identity() || args.replace) {
          if (!args.interactive) return { ok: true, authenticated: false }
          if (++loginRequests > 2) throw new Error('本次流程重复请求登录，请检查服务响应')
          deps.pause()
          try { if (!await deps.login(args.replace === true)) return { ok: false, denied: true, reason: 'login_cancelled' } }
          finally { deps.resume() }
          active()
        }
        const identity = deps.identity()
        if (!identity) return { ok: false, reason: 'login_required' }
        // Reauthentication must not silently switch to another account in the middle of a paper.
        if (rejected && rejected.principal !== identity.principal) throw new Error('重新登录后账号发生变化，请重新开始当前任务')
        const session_id = crypto.randomUUID(); grants.set(session_id, { ...identity }); rejected = undefined
        return { ok: true, authenticated: true, session_id }
      }
      if (op === 'service.check') { if (isRejected(current(args.session_id))) throw new Error('服务会话已失效，请重新登录'); return { ok: true } }
      if (op === 'payload.from_state') {
        const grant = current(args.session_id)
        if (payloads.size >= 2 || !Array.isArray(args.keys) || !args.keys.length || args.keys.length > 512 || new Set(args.keys).size !== args.keys.length || args.keys.some((key: unknown) => typeof key !== 'string' || !/^[\w:/.-]{1,200}$/.test(key))) throw new Error('状态来源数量超过限制或存在重复')
        if (typeof args.json !== 'string' || size(args.json) > 96 * 1024) throw new Error('请求模板超过限制')
        const root = JSON.parse(args.json), target = pointer(root, args.pointer)
        if (!Array.isArray(target) || target.length) throw new Error('请求数组目标必须为空')
        const states = await deps.readStates(grant.principal, args.keys)
        current(args.session_id)
        let bytes = size(args.json)
        if (states.length !== args.keys.length) throw new Error('采集内容不完整，未发送部分数据')
        for (const json of states) {
          if (!json) throw new Error('采集内容不完整，未发送部分数据')
          if ((bytes += size(json)) > 6 * 1024 * 1024) throw new Error('完整正文超过限制')
          const rows = pointer(JSON.parse(json), args.source_pointer)
          if (!Array.isArray(rows) || target.length + rows.length > 2000) throw new Error('采集数组无效或超出限制')
          target.push(...rows)
        }
        if (size(root) > 6 * 1024 * 1024) throw new Error('完整正文超过限制')
        const payload_id = crypto.randomUUID(); payloads.set(payload_id, root)
        return { ok: true, payload_id, count: target.length }
      }
      if (op === 'payload.create') {
        if (payloads.size >= 2 || typeof args.json !== 'string' || size(args.json) > 96 * 1024) throw new Error('临时请求数据超出限制')
        const payload_id = crypto.randomUUID(); payloads.set(payload_id, JSON.parse(args.json)); return { ok: true, payload_id }
      }
      if (op === 'payload.append') {
        if (!payloads.has(args.payload_id)) throw new Error('请求数据已释放')
        const root = payloads.get(args.payload_id), target = pointer(root, args.pointer), rows = JSON.parse(args.json)
        if (!Array.isArray(target) || !Array.isArray(rows) || rows.length > 32 || target.length + rows.length > 2000) throw new Error('请求数组超出限制')
        const start = target.length; target.push(...rows)
        if (size(root) > 6 * 1024 * 1024) { target.splice(start); throw new Error('请求正文超过限制') }
        return { ok: true, count: target.length }
      }
      if (op === 'service.request') {
        const grant = current(args.session_id)
        if (isRejected(grant)) throw new Error('服务会话已失效，请重新登录')
        if (!['GET', 'POST'].includes(args.method) || typeof args.path !== 'string' || !/^\/(?!\/)[^?#\\\u0000-\u0020]*$/.test(args.path) || args.path.length > 1024) throw new Error('服务路径或方法无效')
        const query = new URLSearchParams()
        for (const pair of args.query || []) {
          if (!object(pair) || typeof pair.name !== 'string' || typeof pair.value !== 'string' || query.has(pair.name)) throw new Error('查询参数无效或重复')
          query.append(pair.name, pair.value)
        }
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (args.token_location === 'query') {
          if (!/^[a-zA-Z][\w-]{0,63}$/.test(args.token_name || '') || query.has(args.token_name)) throw new Error('凭据注入位置无效')
          query.set(args.token_name, grant.token)
        } else if (args.token_location === 'header') headers.Authorization = `Bearer ${grant.token}`
        else throw new Error('凭据注入方式无效')
        let body: string | undefined
        if (args.payload_id) {
          if (!payloads.has(args.payload_id)) throw new Error('请求数据已释放')
          body = JSON.stringify(payloads.get(args.payload_id))
        } else if (args.json !== undefined) {
          JSON.parse(args.json); body = args.json
        }
        if (body && args.method === 'GET') throw new Error('GET 请求不接受正文')
        if (body) headers['Content-Type'] = 'application/json'
        if (responses.size >= 8) throw new Error('服务响应数量超过限制')
        let response: Response
        try { response = await deps.request(args.path + (query.size ? '?' + query : ''), { method: args.method, headers, body, signal: deps.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }) }
        catch { active(); throw new Error('服务请求失败，请检查连接后重试') }
        current(args.session_id)
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { ok: true, status: response.status, redirected: true } }
        if (response.status === 401 || response.status === 400 && response.headers.get('www-authenticate')) rejected = grant
        let value: unknown = null
        if (response.status !== 204 && response.status !== 205) value = await boundedJson(response)
        current(args.session_id)
        // Some legacy APIs report an expired query token as HTTP 400, in a JSON error.
        if (response.status === 400 && /token/i.test(JSON.stringify(value))) rejected = grant
        if (size(value) + [...responses.values()].reduce<number>((sum, row) => sum + size(row), 0) > 16 * 1024 * 1024) throw new Error('服务响应缓存超过限制')
        const request_id = crypto.randomUUID(); responses.set(request_id, value)
        return { ok: true, status: response.status, request_id, authenticationRejected: rejected === grant }
      }
      if (op === 'service.read') {
        current(args.session_id)
        if (!responses.has(args.request_id)) throw new Error('服务响应已释放')
        const value = pointer(responses.get(args.request_id), args.pointer)
        if (Array.isArray(value)) {
          const offset = args.offset || 0, limit = args.limit || 16
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error('分页范围无效')
          const items = value.slice(offset, offset + limit)
          if (size(items) > 96 * 1024) return { ok: true, tooLarge: true, total: value.length, items: [] }
          return { ok: true, total: value.length, items, next_offset: offset + items.length < value.length ? offset + items.length : -1 }
        }
        if (size(value ?? null) > 96 * 1024) return { ok: true, tooLarge: true }
        return { ok: true, found: value !== undefined, value: value ?? null }
      }
      if (op === 'state.read' || op === 'state.write') {
        const grant = current(args.session_id)
        if (typeof args.key !== 'string' || !/^[\w:/.-]{1,200}$/.test(args.key)) throw new Error('状态键无效')
        if (op === 'state.read') return { ok: true, json: await deps.readState(grant.principal, args.key) }
        if (args.json !== null && (typeof args.json !== 'string' || size(args.json) > 96 * 1024)) throw new Error('状态内容超过限制')
        await deps.writeState(grant.principal, args.key, args.json === null ? null : JSON.stringify(redact(JSON.parse(args.json))))
        current(args.session_id); return { ok: true }
      }
      if (op === 'knowledge.search') {
        const rows = await deps.search(args)
        active()
        if (!Array.isArray(rows)) throw new Error('题库响应格式无效')
        const result = snapshot(rows)
        if (result.length > 24 || size(result) > 96 * 1024) return { ok: true, truncated: true, rows: [] }
        return { ok: true, rows: result, truncated: false }
      }
      if (op === 'model.generate') {
        if (typeof args.prompt !== 'string' || size(args.prompt) > 64 * 1024 || typeof args.system !== 'string' || size(args.system) > 8192) throw new Error('模型请求超过限制')
        const text = await deps.generate(args.prompt, args.system); active()
        if (typeof text !== 'string' || size(text) > 32768) throw new Error('模型返回超过限制')
        return { ok: true, text }
      }
      if (op === 'questions.publish') { await deps.publish(args); active(); return { ok: true } }
      throw new Error('未知的通用服务命令')
    },
  }
}
