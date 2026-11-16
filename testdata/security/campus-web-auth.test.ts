import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, expect, it, vi } from 'vitest'

const remote = vi.hoisted(() => ({ json: vi.fn(), invoke: vi.fn() }))
vi.mock('../../src/services/app/remoteHttp', () => ({
  AUTH_API_BASE: 'https://app.zaizhexue.top',
  RemoteApiError: class extends Error {},
  readStoredAuthToken: () => '',
  rememberAuthToken: vi.fn(),
  remoteJson: remote.json,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: remote.invoke }))

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

beforeEach(() => {
  vi.resetModules()
  remote.json.mockReset()
  remote.invoke.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('window', new EventTarget())
})

it('verifies the proposed token before publishing or persisting the desktop session', async () => {
  const auth = await import('../../src/services/app/auth')
  remote.json.mockResolvedValue({ id: 7, nickname: '测试用户' })
  await auth.acceptCampusWebSession('web-token', auth.authRevision.value, () => true)
  expect(remote.json).toHaveBeenCalledWith('https://app.zaizhexue.top/api/user/info', {
    headers: { Authorization: 'Bearer web-token' },
  }, false)
  expect(auth.authToken.value).toBe('web-token')
  expect(auth.authUser.value?.id).toBe(7)
  expect(remote.invoke).toHaveBeenCalledWith('write_auth', {
    content: expect.stringContaining('web-token'),
  })
  expect(localStorage.getItem('zerror-auth-token')).toBeNull()
})

it('cannot resurrect a login after the desktop logs out during verification', async () => {
  const auth = await import('../../src/services/app/auth')
  let resolve!: (value: unknown) => void
  remote.json.mockImplementation(() => new Promise(done => { resolve = done }))
  const pending = auth.acceptCampusWebSession('stale-token', auth.authRevision.value, () => true)
  auth.clearAuthSession()
  resolve({ id: 7, nickname: '旧账号' })
  await pending
  expect(auth.authToken.value).toBe('')
  expect(auth.authUser.value).toBeNull()
  await vi.waitFor(() => expect(remote.invoke).toHaveBeenCalledTimes(2))
  expect(remote.invoke.mock.calls.every(([, args]) => !args.content.includes('stale-token'))).toBe(true)
})

it('rejects invalid credentials and results from a replaced iframe', async () => {
  const auth = await import('../../src/services/app/auth')
  remote.json.mockRejectedValueOnce(new Error('401'))
  await expect(auth.acceptCampusWebSession('invalid', auth.authRevision.value, () => true)).rejects.toThrow()
  remote.json.mockResolvedValue({ id: 9, nickname: '旧页面' })
  await auth.acceptCampusWebSession('old-frame', auth.authRevision.value, () => false)
  expect(auth.authToken.value).toBe('')
  expect(remote.invoke).not.toHaveBeenCalled()
})

it.each(['tauri://localhost', 'http://tauri.localhost'])('iframe accepts its desktop parent at %s and treats desktop state as authoritative', (parentOrigin) => {
  const listeners = new Map<string, (event: any) => void>()
  const parent = { postMessage: vi.fn() }
  const port = { onmessage: null as any, postMessage: vi.fn(), close: vi.fn() }
  const local = storage()
  local.setItem('token', 'old-web-account')
  const location = { origin: 'https://tiku.zerrorai.com', reload: vi.fn() }
  const frame = {
    top: parent,
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    dispatchEvent: vi.fn(),
  }
  runInNewContext(readFileSync('src-tauri/src/campus_auth.js', 'utf8'), {
    window: frame, parent, top: parent, location, localStorage: local, Event,
  })
  const connect = (origin: string, source = parent) => listeners.get('message')!({
    origin, source, data: { channel: 'zerror-campus-auth-v1', type: 'connect' }, ports: [port],
  })
  connect('https://untrusted.test')
  expect(port.onmessage).toBeNull()
  connect(parentOrigin, {} as typeof parent)
  expect(port.onmessage).toBeNull()
  connect(parentOrigin)
  port.onmessage({ data: { type: 'session', revision: 4, token: 'desktop-token', user: { id: 1, nickname: '软件账号' } } })
  expect(local.getItem('token')).toBe('desktop-token')
  expect(location.reload).toHaveBeenCalledOnce()
  expect(port.postMessage).not.toHaveBeenCalled()
  port.onmessage({ data: { type: 'session', revision: 3, token: 'stale-token' } })
  expect(local.getItem('token')).toBe('desktop-token')
  local.setItem('token', 'new-login')
  listeners.get('ze-login-success')!({})
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'change', revision: 4, token: 'new-login' })
  local.removeItem('token')
  listeners.get('ze-logout')!({})
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'change', revision: 4, token: '' })
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ channel: 'zerror-campus-auth-v1', type: 'ready' }, '*')
})

it('applies desktop theme changes to the embedded site without saving or reloading', () => {
  const parent = { postMessage: vi.fn() }
  const listeners = new Map<string, (event: any) => void>()
  const window = {
    top: parent,
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    dispatchEvent: vi.fn(),
  }
  const document = { documentElement: { dataset: { theme: 'light' } } }
  const localStorage = storage()
  localStorage.setItem('ze-site-appearance', 'light')
  const location = { origin: 'https://tiku.zerrorai.com', reload: vi.fn() }
  const StorageEvent = vi.fn(function (type, init) { return { type, ...init } })
  runInNewContext(readFileSync('src-tauri/src/campus_auth.js', 'utf8'), {
    window, parent, top: parent, document, location, localStorage, StorageEvent, queueMicrotask,
  })
  const connect = () => {
    const port = { onmessage: null as any, close: vi.fn() }
    listeners.get('message')!({
      origin: 'http://localhost:1420', source: parent, ports: [port],
      data: { channel: 'zerror-campus-auth-v1', type: 'connect' },
    })
    return port
  }

  const port = connect()
  port.onmessage({ data: { type: 'theme', theme: 'dark' } })
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(window.dispatchEvent).toHaveBeenLastCalledWith({
    type: 'storage', key: 'ze-site-appearance', newValue: 'dark',
  })
  port.onmessage({ data: { type: 'theme', theme: 'auto' } })
  expect(document.documentElement.dataset.theme).toBe('dark')

  const current = connect()
  current.onmessage({ data: { type: 'theme', theme: 'light' } })
  port.onmessage({ data: { type: 'theme', theme: 'dark' } })
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('ze-site-appearance')).toBe('light')
  expect(location.reload).not.toHaveBeenCalled()
})

it('embeds the same origin as the native authentication script', async () => {
  const { CAMPUS_ORIGIN, CAMPUS_WORKSPACE_URL } = await import('../../src/services/app/campusWebAuth')
  expect(CAMPUS_WORKSPACE_URL).toBe('https://tiku.zerrorai.com/campus?embed=1')
  const source = readFileSync('src-tauri/src/campus_auth.js', 'utf8')
  for (const origin of [CAMPUS_ORIGIN, 'https://tiku.zerror.cc', 'https://tiku.zerrorai.com.example.test']) {
    const parent = { postMessage: vi.fn() }
    const window = { top: parent, addEventListener: vi.fn() }
    runInNewContext(source, { window, parent, top: parent, location: { origin } })
    expect(parent.postMessage).toHaveBeenCalledTimes(origin === CAMPUS_ORIGIN ? 1 : 0)
  }
})
