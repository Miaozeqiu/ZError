import assert from 'node:assert/strict'
import { afterEach, beforeEach, vi, test } from 'vitest'

let fetchImpl
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args) => fetchImpl(...args) }))
const { performWebSearch, formatSearchContextForModel } = await import('../../src/services/searchService.ts')
const config = {
  enabled: true, apiKey: '',
}
const result = { content: [{ type: 'text', text: JSON.stringify([
  { title: 'Example', url: 'https://example.test', text: 'Relevant answer' }
]) }] }
const json = payload => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const stalledBody = () => {
  let stream
  const started = deferred()
  const response = new Response(new ReadableStream({ start(controller) { stream = controller } }))
  const read = response.text.bind(response)
  response.text = () => { const pending = read(); started.resolve(); return pending }
  return { response, reading: started.promise, close: () => stream.close() }
}
const originalWindow = globalThis.window

beforeEach(() => {
  globalThis.window = { __TAURI_INTERNALS__: {}, location: { protocol: 'tauri:' } }
  fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body)
    if (!request.id) return new Response(null, { status: 202 })
    return json({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? {} : result })
  }
})
afterEach(() => {
  vi.useRealTimers()
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
})

test('remote handshake shares its session and injects search excerpts', async () => {
  const requests = []
  const normalFetch = fetchImpl
  fetchImpl = async (url, init) => {
    requests.push(init)
    const response = await normalFetch(url, init)
    if (requests.length === 1) response.headers.set('mcp-session-id', 'session-1')
    return response
  }
  const outcome = await performWebSearch('handshake', config, { force: true })
  assert.deepEqual(requests.map(item => JSON.parse(item.body).method), ['initialize', 'notifications/initialized', 'tools/call'])
  assert.equal(requests[2].headers['Mcp-Session-Id'], 'session-1')
  assert.equal(requests[0].signal, requests[2].signal)
  assert.match(formatSearchContextForModel(outcome), /Relevant answer/)
})

test('Exa key authentication is automatic and legacy connection options are ignored', async () => {
  const requests = []
  const normalFetch = fetchImpl
  fetchImpl = async (url, init) => { requests.push({ url, ...init }); return normalFetch(url, init) }
  await performWebSearch('key authentication', {
    ...config, apiKey: '  example-key  ', mode: 'local', remoteUrl: 'https://legacy.invalid',
    toolName: 'old_tool', customHeaders: '{"x-api-key":"obsolete"}',
  } as any, { force: true })
  assert.ok(requests.every(request => request.url === 'https://mcp.exa.ai/mcp'))
  assert.ok(requests.every(request => request.headers['x-api-key'] === 'example-key'))
  const call = JSON.parse(requests[2].body)
  assert.equal(call.params.name, 'web_search_exa')
  assert.equal(call.params.arguments.numResults, 5)
})

test('empty Exa keys use the keyless connection', async () => {
  const requests = []
  const normalFetch = fetchImpl
  fetchImpl = async (url, init) => { requests.push(init); return normalFetch(url, init) }
  await performWebSearch('keyless connection', config, { force: true })
  assert.ok(requests.every(request => !('x-api-key' in request.headers)))
})

test('timeout covers stalled headers even if HTTP ignores abort', async t => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  let signal
  const started = deferred()
  fetchImpl = async (_url, init) => { signal = init.signal; started.resolve(); return new Promise(() => {}) }
  const pending = performWebSearch('stalled headers', config, { force: true })
  const rejected = assert.rejects(pending, { name: 'TimeoutError' })
  await started.promise
  vi.advanceTimersByTime(30001)
  await rejected
  assert.equal(signal.aborted, true)
})

test('timeout remains active while reading a stalled response body', async t => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  let signal
  const body = stalledBody()
  fetchImpl = async (_url, init) => {
    signal = init.signal
    return body.response
  }
  const rejected = assert.rejects(performWebSearch('stalled body', config, { force: true }), { name: 'TimeoutError' })
  await body.reading
  vi.advanceTimersByTime(30001)
  await rejected
  assert.equal(signal.aborted, true)
  body.close()
})

test('one timeout budget includes initialization and the tool response', async t => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const normalFetch = fetchImpl
  const body = stalledBody()
  fetchImpl = async (url, init) => {
    vi.advanceTimersByTime(9000)
    if (JSON.parse(init.body).method === 'tools/call') {
      return body.response
    }
    return normalFetch(url, init)
  }
  const rejected = assert.rejects(performWebSearch('total budget', config, { force: true }), { name: 'TimeoutError' })
  await body.reading
  vi.advanceTimersByTime(3001)
  await rejected
  body.close()
})

test('caller cancellation interrupts a body after response headers arrive', async () => {
  let signal
  const body = stalledBody()
  fetchImpl = async (_url, init) => {
    signal = init.signal
    return body.response
  }
  const controller = new AbortController()
  const rejected = assert.rejects(performWebSearch('abort body', config, { signal: controller.signal, force: true }), { name: 'AbortError' })
  await body.reading
  controller.abort()
  await rejected
  assert.equal(signal.aborted, true)
  body.close()
})

test('SSE accepts the matching result without waiting for EOF or taking another ID', async () => {
  const normalFetch = fetchImpl
  let cancelled = false
  fetchImpl = async (url, init) => {
    if (JSON.parse(init.body).method !== 'tools/call') return normalFetch(url, init)
    const data = new TextEncoder().encode([
      'event: message\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} }),
      'data: ' + JSON.stringify({ jsonrpc: '2.0', id: 2, result })
    ].join('\r\n\r\n') + '\r\n\r\n')
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(data.slice(0, 23)); controller.enqueue(data.slice(23)) },
      cancel() { cancelled = true }
    }), { headers: { 'content-type': 'text/event-stream' } })
  }
  const outcome = await performWebSearch('open SSE', config, { force: true })
  assert.equal(outcome.results[0].snippet, 'Relevant answer')
  assert.equal(cancelled, true)
})

test('an already aborted request cannot return a cached search', async () => {
  await performWebSearch('cached cancellation', config)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(performWebSearch('cached cancellation', config, { signal: controller.signal }), { name: 'AbortError' })
})

test('DeepSeek sends a direct authenticated search and preserves UI and model excerpts', async () => {
  const requests = []
  fetchImpl = async (url, init) => {
    requests.push({ url, ...init })
    return json({ results: [{ title: 'Result', url: 'https://example.test', snippet: 'Short', summary: 'Long model excerpt', site_icon: 'https://example.test/icon.png', date: '2026-10-19T00:00:00Z' }] })
  }
  const outcome = await performWebSearch('DeepSeek query', { ...config, provider: 'deepseek', deepseekApiKey: ' ds-key ' }, { force: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.deepseek.com/v1/tools/search')
  assert.equal(requests[0].headers.Authorization, 'Bearer ds-key')
  assert.deepEqual(JSON.parse(requests[0].body), { query: 'DeepSeek query', count: 5, need_content: false })
  assert.equal(outcome.toolName, 'deepseek_search')
  assert.equal(outcome.results[0].snippet, 'Short')
  assert.equal(outcome.results[0].siteIcon, 'https://example.test/icon.png')
  assert.match(formatSearchContextForModel(outcome), /Long model excerpt/)
})

test('DeepSeek validates key and Unicode query length before requesting', async () => {
  fetchImpl = () => { throw new Error('unexpected request') }
  await assert.rejects(performWebSearch('query', { ...config, provider: 'deepseek' }), /API Key/)
  await assert.rejects(performWebSearch('😀'.repeat(129), { ...config, provider: 'deepseek', deepseekApiKey: 'key' }), /128/)
})

test('DeepSeek propagates authentication errors and accepts an empty result list', async () => {
  const settings = { ...config, provider: 'deepseek' as const, deepseekApiKey: 'key' }
  fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })
  await assert.rejects(performWebSearch('invalid key', settings, { force: true }), /401.*Invalid API key/)
  fetchImpl = async () => json({ results: [] })
  const outcome = await performWebSearch('no matches', settings, { force: true })
  assert.deepEqual(outcome.results, [])
})

test('DeepSeek also times out when native HTTP ignores cancellation', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const started = deferred()
  fetchImpl = async () => { started.resolve(); return new Promise(() => {}) }
  const rejected = assert.rejects(performWebSearch('stalled DeepSeek', {
    ...config, provider: 'deepseek', deepseekApiKey: 'key',
  }, { force: true }), { name: 'TimeoutError' })
  await started.promise
  vi.advanceTimersByTime(30001)
  await rejected
})

test('search caches are isolated by provider and API key', async () => {
  await performWebSearch('provider cache isolation', config)
  let calls = 0
  fetchImpl = async () => { calls += 1; return json({ results: [] }) }
  const settings = { ...config, provider: 'deepseek' as const, deepseekApiKey: 'key-one' }
  await performWebSearch('provider cache isolation', settings)
  await performWebSearch('provider cache isolation', settings)
  await performWebSearch('provider cache isolation', { ...settings, deepseekApiKey: 'key-two' })
  assert.equal(calls, 2)
})
