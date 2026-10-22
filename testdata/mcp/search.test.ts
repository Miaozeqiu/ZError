import assert from 'node:assert/strict'
import { afterEach, beforeEach, vi, test } from 'vitest'

let fetchImpl
let invokeImpl
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invokeImpl(...args) }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args) => fetchImpl(...args) }))
const { performWebSearch, formatSearchContextForModel } = await import('../../src/services/searchService.ts')
const config = {
  enabled: true, mode: 'remote', remoteUrl: 'https://example.test/mcp', apiKey: '', authMode: 'none',
  toolName: 'web_search_exa', maxResults: 5, timeoutSeconds: 5, customHeaders: '', extraArguments: '',
  localCommand: 'node', localArgs: '', localEnv: ''
}
const result = { content: [{ type: 'text', text: JSON.stringify([
  { title: 'Example', url: 'https://example.test', text: 'Relevant answer' }
]) }] }
const json = payload => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
const flush = () => new Promise(resolve => setImmediate(resolve))
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
  invokeImpl = async name => {
    if (name === 'mcp_stdio_prepare') return 'test-search'
    if (name === 'mcp_stdio_search') return result
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

test('timeout covers stalled headers even if HTTP ignores abort', async t => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  let signal
  const started = deferred()
  fetchImpl = async (_url, init) => { signal = init.signal; started.resolve(); return new Promise(() => {}) }
  const pending = performWebSearch('stalled headers', config, { force: true })
  const rejected = assert.rejects(pending, { name: 'TimeoutError' })
  await started.promise
  vi.advanceTimersByTime(5001)
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
  vi.advanceTimersByTime(5001)
  await rejected
  assert.equal(signal.aborted, true)
  body.close()
})

test('one timeout budget includes initialization and the tool response', async t => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const normalFetch = fetchImpl
  const body = stalledBody()
  fetchImpl = async (url, init) => {
    vi.advanceTimersByTime(1500)
    if (JSON.parse(init.body).method === 'tools/call') {
      return body.response
    }
    return normalFetch(url, init)
  }
  const rejected = assert.rejects(performWebSearch('total budget', config, { force: true }), { name: 'TimeoutError' })
  await body.reading
  vi.advanceTimersByTime(501)
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

test('local arguments preserve Windows paths, UNC paths, spaces and empty args', async () => {
  let args
  invokeImpl = async (name, payload) => {
    if (name === 'mcp_stdio_prepare') return 'path-test'
    if (name === 'mcp_stdio_search') { args = payload.args; return result }
  }
  await performWebSearch('Windows args', {
    ...config, mode: 'local',
    localArgs: String.raw`"C:\Users\Alice\My Server\server.js" "" "\\server\shared folder\server.js" "--name=\"Alice\""`
  }, { force: true })
  assert.deepEqual(args, [String.raw`C:\Users\Alice\My Server\server.js`, '', String.raw`\\server\shared folder\server.js`, '--name="Alice"'])
})

test('unclosed quotes fail before starting a backend process', async () => {
  let calls = 0
  invokeImpl = async () => { calls++ }
  await assert.rejects(performWebSearch('bad quotes', { ...config, mode: 'local', localArgs: '"unfinished' }, { force: true }), /引号未闭合/)
  assert.equal(calls, 0)
})

test('local cancellation releases a handle that finishes preparing after abort', async () => {
  let prepared
  const calls = []
  invokeImpl = async (name, payload) => {
    calls.push([name, payload])
    if (name === 'mcp_stdio_prepare') return new Promise(resolve => { prepared = resolve })
  }
  const controller = new AbortController()
  const rejected = assert.rejects(performWebSearch('prepare race', { ...config, mode: 'local' }, { signal: controller.signal, force: true }), { name: 'AbortError' })
  controller.abort()
  await rejected
  prepared('late-handle')
  await flush()
  assert.equal(calls.some(([name]) => name === 'mcp_stdio_search'), false)
  assert.ok(calls.some(([name, payload]) => name === 'mcp_stdio_cancel' && payload.searchId === 'late-handle'))
})

test('cancelling an active local search reaches Rust and rejects promptly', async () => {
  const calls = []
  invokeImpl = async (name, payload) => {
    calls.push([name, payload])
    if (name === 'mcp_stdio_prepare') return 'running-handle'
    if (name === 'mcp_stdio_search') return new Promise(() => {})
  }
  const controller = new AbortController()
  const rejected = assert.rejects(performWebSearch('local abort', { ...config, mode: 'local' }, { signal: controller.signal, force: true }), { name: 'AbortError' })
  await flush()
  controller.abort()
  await rejected
  assert.ok(calls.some(([name, payload]) => name === 'mcp_stdio_cancel' && payload.searchId === 'running-handle'))
  assert.equal(calls.find(([name]) => name === 'mcp_stdio_search')[1].timeoutSecs, 5)
})
