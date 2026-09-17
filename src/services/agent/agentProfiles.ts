import { reactive } from 'vue'
import type { SkillScope } from './agentSkills'

export type AgentKind = 'browser' | 'learning'
export type DomainToolPolicy = 'current-site' | 'always' | 'never'

export type AgentProfile = {
  id: string
  name: string
  kind: AgentKind
  preset?: AgentKind
  systemOverlay: string
  skillIds: string[]
  toolPolicy: {
    domain: DomainToolPolicy
  }
}

type ProfileStore = {
  version: number
  defaultBrowserId: string
  defaultLearningId: string
  profiles: AgentProfile[]
}

const STORAGE_KEY = 'zerror-agent-profiles'
const CONFIG_FILE = 'agent-profiles.json'

const presetOf = (kind: AgentKind): AgentProfile => (
  kind === 'browser'
    ? {
      id: 'browser',
      name: '浏览器',
      kind: 'browser',
      preset: 'browser',
      systemOverlay: '',
      skillIds: [],
      toolPolicy: { domain: 'current-site' },
    }
    : {
      id: 'learning',
      name: '学习',
      kind: 'learning',
      preset: 'learning',
      systemOverlay: '',
      skillIds: [],
      toolPolicy: { domain: 'never' },
    }
)

const defaultStore = (): ProfileStore => ({
  version: 1,
  defaultBrowserId: 'browser',
  defaultLearningId: 'learning',
  profiles: [presetOf('browser'), presetOf('learning')],
})

export const agentProfileState = reactive({
  defaultBrowserId: 'browser',
  defaultLearningId: 'learning',
  profiles: defaultStore().profiles as AgentProfile[],
})

const asDomain = (value: unknown): DomainToolPolicy => (
  value === 'always' || value === 'never' ? value : 'current-site'
)

const asProfile = (raw: unknown, fallbackKind: AgentKind = 'browser'): AgentProfile | null => {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id || '').trim()
  if (!id) return null
  const kind: AgentKind = row.kind === 'learning' ? 'learning' : 'browser'
  const preset = row.preset === 'browser' || row.preset === 'learning' ? row.preset : undefined
  const toolPolicy = row.toolPolicy && typeof row.toolPolicy === 'object'
    ? row.toolPolicy as Record<string, unknown>
    : {}
  return {
    id,
    name: String(row.name || '').trim() || (kind === 'browser' ? '浏览器' : '学习'),
    kind: preset || fallbackKind === kind ? kind : kind,
    preset,
    systemOverlay: String(row.systemOverlay || ''),
    skillIds: Array.isArray(row.skillIds) ? row.skillIds.map((item) => String(item || '').trim()).filter(Boolean) : [],
    toolPolicy: { domain: kind === 'learning' ? 'never' : asDomain(toolPolicy.domain) },
  }
}

const mergePreset = (stored: AgentProfile | undefined, kind: AgentKind): AgentProfile => {
  const base = presetOf(kind)
  if (!stored) return base
  return {
    ...base,
    name: stored.name || base.name,
    systemOverlay: stored.systemOverlay,
    skillIds: stored.skillIds,
    toolPolicy: stored.toolPolicy,
  }
}

const persistFile = (store: ProfileStore) => {
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(store), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

const writeLocal = (store: ProfileStore) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // quota
  }
}

const readLocal = (): ProfileStore => {
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return defaultStore()
  }
}

const normalizeStore = (raw: unknown): ProfileStore => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const incoming = Array.isArray(row.profiles)
    ? row.profiles.map((item) => asProfile(item)).filter((item): item is AgentProfile => Boolean(item))
    : []
  const byId = new Map(incoming.map((item) => [item.id, item]))
  const browser = mergePreset(byId.get('browser'), 'browser')
  const learning = mergePreset(byId.get('learning'), 'learning')
  byId.delete('browser')
  byId.delete('learning')
  const customs = [...byId.values()].filter((item) => !item.preset)
  const store: ProfileStore = {
    version: 1,
    defaultBrowserId: String(row.defaultBrowserId || 'browser'),
    defaultLearningId: String(row.defaultLearningId || 'learning'),
    profiles: [browser, learning, ...customs],
  }
  if (!store.profiles.some((item) => item.id === store.defaultBrowserId && item.kind === 'browser')) {
    store.defaultBrowserId = 'browser'
  }
  if (!store.profiles.some((item) => item.id === store.defaultLearningId && item.kind === 'learning')) {
    store.defaultLearningId = 'learning'
  }
  return store
}

const applyStore = (store: ProfileStore) => {
  agentProfileState.defaultBrowserId = store.defaultBrowserId
  agentProfileState.defaultLearningId = store.defaultLearningId
  agentProfileState.profiles = store.profiles
}

const currentStore = (): ProfileStore => ({
  version: 1,
  defaultBrowserId: agentProfileState.defaultBrowserId,
  defaultLearningId: agentProfileState.defaultLearningId,
  profiles: agentProfileState.profiles.map((item) => ({ ...item, skillIds: [...item.skillIds], toolPolicy: { ...item.toolPolicy } })),
})

const saveStore = (store: ProfileStore) => {
  const next = normalizeStore(store)
  applyStore(next)
  writeLocal(next)
  persistFile(next)
}

applyStore(readLocal())

void import('@tauri-apps/plugin-fs').then(async ({ readTextFile, BaseDirectory }) => {
  try {
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    }))
    saveStore(normalizeStore({ ...readLocal(), ...raw, profiles: [
      ...(Array.isArray((raw as { profiles?: unknown }).profiles) ? (raw as { profiles: unknown[] }).profiles : []),
      ...readLocal().profiles,
    ] }))
  } catch {
    persistFile(currentStore())
  }
}).catch(() => undefined)

export const listAgentProfiles = () => agentProfileState.profiles

export const getAgentProfile = (id: string) => (
  agentProfileState.profiles.find((item) => item.id === id) || null
)

export const getActiveBrowserProfile = () => (
  getAgentProfile(agentProfileState.defaultBrowserId) || getAgentProfile('browser') || presetOf('browser')
)

export const getActiveLearningProfile = () => (
  getAgentProfile(agentProfileState.defaultLearningId) || getAgentProfile('learning') || presetOf('learning')
)

export const getProfileForKind = (kind: AgentKind) => (
  kind === 'browser' ? getActiveBrowserProfile() : getActiveLearningProfile()
)

export const skillScopeOfKind = (kind: AgentKind): SkillScope => kind

export const setDefaultProfile = (kind: AgentKind, id: string) => {
  const profile = getAgentProfile(id)
  if (!profile || profile.kind !== kind) return
  const store = currentStore()
  if (kind === 'browser') store.defaultBrowserId = id
  else store.defaultLearningId = id
  saveStore(store)
}

export const saveAgentProfile = (profile: AgentProfile) => {
  const store = currentStore()
  const index = store.profiles.findIndex((item) => item.id === profile.id)
  const next = asProfile(profile)
  if (!next) return
  if (index >= 0) store.profiles[index] = next
  else store.profiles.push(next)
  saveStore(store)
}

export const duplicateAgentProfile = (id: string, name?: string) => {
  const source = getAgentProfile(id)
  if (!source) return null
  const copy: AgentProfile = {
    ...source,
    id: `profile-${Date.now()}`,
    name: name || `${source.name} 副本`,
    preset: undefined,
    skillIds: [...source.skillIds],
    toolPolicy: { ...source.toolPolicy },
  }
  saveAgentProfile(copy)
  return copy
}

export const deleteAgentProfile = (id: string) => {
  const profile = getAgentProfile(id)
  if (!profile || profile.preset) return
  const store = currentStore()
  store.profiles = store.profiles.filter((item) => item.id !== id)
  if (store.defaultBrowserId === id) store.defaultBrowserId = 'browser'
  if (store.defaultLearningId === id) store.defaultLearningId = 'learning'
  saveStore(store)
}

export const resetAgentProfile = (id: string) => {
  if (id !== 'browser' && id !== 'learning') return
  const store = currentStore()
  const index = store.profiles.findIndex((item) => item.id === id)
  if (index >= 0) store.profiles[index] = presetOf(id)
  saveStore(store)
}
