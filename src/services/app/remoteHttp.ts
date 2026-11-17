export const AUTH_API_BASE = 'https://app.zaizhexue.top'
export const CAMPUS_API_BASE = 'https://campuses.zerror.cc'
export const AUTH_TOKEN_KEY = 'zerror-auth-token'

let memoryAuthToken = ''

export class RemoteApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'RemoteApiError'
    this.status = status
    this.body = body
  }
}

export function readStoredAuthToken() {
  if (memoryAuthToken) return memoryAuthToken
  try {
    memoryAuthToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  } catch {
    memoryAuthToken = ''
  }
  return memoryAuthToken
}

export function rememberAuthToken(token: string) {
  memoryAuthToken = token || ''
  if (!memoryAuthToken) {
    try { localStorage.removeItem(AUTH_TOKEN_KEY) } catch { /* unavailable */ }
  }
}

const readJson = async (res: Response) => {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const messageFrom = (data: unknown, fallback: string) => {
  if (!data) return fallback
  if (typeof data === 'string' && data.trim()) return data
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['message', 'error', 'msg', 'detail']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }
  return fallback
}

const mergeHeaders = (init?: RequestInit, withAuth = true) => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (init?.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
  }
  const token = readStoredAuthToken()
  if (withAuth && token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export async function remoteFetch(url: string, init: RequestInit = {}, withAuth = true) {
  const { fetch } = await import('@tauri-apps/plugin-http')
  return fetch(url, {
    ...init,
    headers: mergeHeaders(init, withAuth),
  } as any)
}

export async function remoteJson<T = any>(url: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  const res = await remoteFetch(url, init, withAuth)
  const data = await readJson(res)
  if (!res.ok) {
    throw new RemoteApiError(res.status, messageFrom(data, res.statusText || '请求失败'), data)
  }
  return data as T
}

export function pickField<T = any>(source: unknown, ...keys: string[]): T | undefined {
  if (!source || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  for (const key of keys) {
    if (record[key] != null) return record[key] as T
  }
  return undefined
}
