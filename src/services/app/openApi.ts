import { isTauri } from '@tauri-apps/api/core'

export const ZERROR_OPEN_ORIGIN = 'https://open.zerrorai.com'

export async function fetchOpenApiJson(path: string): Promise<unknown> {
  const url = ZERROR_OPEN_ORIGIN + path
  const init = { signal: AbortSignal.timeout(10000) }
  const fetcher = isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : fetch
  const response = await fetcher(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
