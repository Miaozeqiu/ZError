import type { PlatformAdapter, PlatformId, PlatformRole } from './types'

const adapters: PlatformAdapter[] = []

export const registerPlatformAdapter = (adapter: PlatformAdapter) => {
  const index = adapters.findIndex((item) => item.id === adapter.id)
  if (index >= 0) adapters[index] = adapter
  else adapters.push(adapter)
}

export const listPlatformAdapters = () => [...adapters]

export const getPlatformAdapter = (id: PlatformId) => (
  adapters.find((item) => item.id === id) || null
)

export const resolvePlatformAdapter = (url: string): PlatformAdapter | null => {
  const href = String(url || '')
  if (!href) return null
  return adapters.find((item) => item.matchHost(href)) || null
}

export const resolvePlatformRole = (url: string): { adapter: PlatformAdapter; role: PlatformRole } | null => {
  const adapter = resolvePlatformAdapter(url)
  if (!adapter) return null
  const role = adapter.roleOf(url)
  if (!role) return null
  return { adapter, role }
}
