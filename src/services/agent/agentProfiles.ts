import { reactive } from 'vue'

export type AgentProfile = {
  id: string
  name: string
  preset?: 'agent'
  systemOverlay: string
}

export type ProfileStore = {
  version: 2
  defaultId: string
  profiles: AgentProfile[]
}

const STORAGE_KEY = 'zerror-agent-profiles'
const CONFIG_FILE = 'agent-profiles.json'
const preset = (): AgentProfile => ({
  id: 'agent', name: 'Agent', preset: 'agent', systemOverlay: '',
})
const object = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
)
const asProfile = (value: unknown): AgentProfile | null => {
  const row = object(value)
  const id = String(row.id || '').trim()
  if (!id) return null
  return {
    id, name: String(row.name || '').trim() || 'Agent',
    ...(id === 'agent' ? { preset: 'agent' as const } : {}),
    systemOverlay: String(row.systemOverlay || ''),
  }
}

/** Collapse the two legacy defaults into one active configuration. Keep custom
 * profiles and edited inactive presets available, without the old agent kinds. */
export const normalizeProfileStore = (raw: unknown): ProfileStore => {
  const row = object(raw)
  const rows = Array.isArray(row.profiles) ? row.profiles.map(object) : []
  const profiles = [...new Map(rows.map(asProfile).filter((p): p is AgentProfile => !!p).map(p => [p.id, p])).values()]
  let agent = profiles.find(p => p.id === 'agent')
  const customs = profiles.filter(p => !['agent', 'browser', 'learning'].includes(p.id))
  const legacy = row.version !== 2 && !agent
  if (legacy) {
    const learning = profiles.find(p => p.id === row.defaultLearningId) || profiles.find(p => p.id === 'learning')
    const browser = profiles.find(p => p.id === row.defaultBrowserId) || profiles.find(p => p.id === 'browser')
    const learningRules = learning?.systemOverlay.trim() || ''
    const browserRules = browser?.systemOverlay.trim() || ''
    const rules = [learningRules, browserRules && browserRules !== learningRules
      ? `【网页操作附加规则】仅进行网页操作时适用：\n${browserRules}` : ''].filter(Boolean)
    agent = { ...preset(), systemOverlay: rules.join('\n\n') }
    for (const previous of profiles.filter(p => ['browser', 'learning'].includes(p.id))) {
      const selected = previous.id === learning?.id || previous.id === browser?.id
      if (!selected && previous.systemOverlay.trim()) {
        customs.push({ ...previous, id: `legacy-${previous.id}`, name: `${previous.name}（迁移）`, preset: undefined })
      }
    }
  }
  const all = [agent || preset(), ...customs]
  const requested = legacy ? 'agent' : String(row.defaultId || 'agent')
  return { version: 2, defaultId: all.some(p => p.id === requested) ? requested : 'agent', profiles: all }
}

const defaults = normalizeProfileStore(null)
export const agentProfileState = reactive({ defaultId: defaults.defaultId, profiles: defaults.profiles })
let revision = 0
let fileWrites = Promise.resolve()
const persistFile = (store: ProfileStore) => {
  fileWrites = fileWrites.then(async () => {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(store), { baseDir: BaseDirectory.Home })
  }).catch(() => undefined)
}
const writeLocal = (store: ProfileStore) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) } catch { /* Storage unavailable. */ }
}
const readLocal = (): unknown => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}
const applyStore = (store: ProfileStore) => {
  agentProfileState.defaultId = store.defaultId
  agentProfileState.profiles = store.profiles
}
const currentStore = (): ProfileStore => ({
  version: 2, defaultId: agentProfileState.defaultId,
  profiles: agentProfileState.profiles.map(p => ({ ...p })),
})
const saveStore = (store: ProfileStore) => {
  revision++
  const next = normalizeProfileStore(store)
  applyStore(next); writeLocal(next); persistFile(next)
}
const local = readLocal()
const hasLocal = Array.isArray(object(local).profiles) && (object(local).profiles as unknown[]).length > 0
applyStore(normalizeProfileStore(local))
if (hasLocal) writeLocal(currentStore())

void import('@tauri-apps/plugin-fs').then(async ({ readTextFile, BaseDirectory }) => {
  try {
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, { baseDir: BaseDirectory.Home }))
    // Local edits take precedence over an older file or an in-flight startup read.
    if (!hasLocal && revision === 0) saveStore(normalizeProfileStore(raw))
    else persistFile(currentStore())
  } catch { persistFile(currentStore()) }
}).catch(() => undefined)

export const listAgentProfiles = () => agentProfileState.profiles
export const getAgentProfile = (id: string) => agentProfileState.profiles.find(p => p.id === id) || null
export const getActiveAgentProfile = () => getAgentProfile(agentProfileState.defaultId) || getAgentProfile('agent') || preset()
export const setDefaultProfile = (id: string) => {
  if (!getAgentProfile(id)) return
  saveStore({ ...currentStore(), defaultId: id })
}
export const saveAgentProfile = (profile: AgentProfile) => {
  const next = asProfile(profile)
  if (!next) return
  const store = currentStore()
  const index = store.profiles.findIndex(p => p.id === next.id)
  if (index >= 0) store.profiles[index] = next
  else store.profiles.push(next)
  saveStore(store)
}
export const duplicateAgentProfile = (id: string, name?: string) => {
  const source = getAgentProfile(id)
  if (!source) return null
  const copy = { ...source, id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name || `${source.name} 副本`, preset: undefined }
  saveAgentProfile(copy)
  return copy
}
export const deleteAgentProfile = (id: string) => {
  const profile = getAgentProfile(id)
  if (!profile || profile.preset) return
  const store = currentStore()
  store.profiles = store.profiles.filter(p => p.id !== id)
  if (store.defaultId === id) store.defaultId = 'agent'
  saveStore(store)
}
export const resetAgentProfile = (id: string) => {
  if (id !== 'agent') return
  const store = currentStore()
  store.profiles = store.profiles.map(p => p.id === id ? preset() : p)
  saveStore(store)
}
