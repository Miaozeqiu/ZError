import { reactive } from 'vue'

export type PermissionMode = 'explore' | 'strict'
export type ConfirmPolicy = 'allow' | 'ask' | 'deny'
export type SubmitPolicy = 'ask' | 'allow'

export type AgentPolicy = {
  permissionMode: PermissionMode
  writeSkills: ConfirmPolicy
  submit: SubmitPolicy
}

const STORAGE_KEY = 'zerror-agent-policy'
const CONFIG_FILE = 'agent-policy.json'

const defaultPolicy = (): AgentPolicy => ({
  permissionMode: 'explore',
  writeSkills: 'ask',
  submit: 'ask',
})

export const agentPolicyState = reactive<AgentPolicy>(defaultPolicy())

let fileReady = false

const asPolicy = (raw: unknown): AgentPolicy => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const permissionMode = row.permissionMode === 'strict' ? 'strict' : 'explore'
  const writeSkills = row.writeSkills === 'allow' || row.writeSkills === 'deny' ? row.writeSkills : 'ask'
  const submit = row.submit === 'allow' ? 'allow' : 'ask'
  return { permissionMode, writeSkills, submit }
}

const apply = (policy: AgentPolicy) => {
  agentPolicyState.permissionMode = policy.permissionMode
  agentPolicyState.writeSkills = policy.writeSkills
  agentPolicyState.submit = policy.submit
}

const persistFile = (policy: AgentPolicy) => {
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(policy), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

const writeLocal = (policy: AgentPolicy) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policy))
  } catch {
    // quota
  }
}

const readLocal = (): AgentPolicy => {
  try {
    return asPolicy(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return defaultPolicy()
  }
}

const save = (policy: AgentPolicy) => {
  apply(policy)
  writeLocal(policy)
  persistFile(policy)
}

export const getAgentPolicy = (): AgentPolicy => ({ ...agentPolicyState })

export const setAgentPolicy = (patch: Partial<AgentPolicy>) => {
  save(asPolicy({ ...getAgentPolicy(), ...patch }))
}

apply(readLocal())

void import('@tauri-apps/plugin-fs').then(async ({ readTextFile, BaseDirectory }) => {
  try {
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    }))
    const next = asPolicy({ ...readLocal(), ...raw })
    fileReady = true
    save(next)
  } catch {
    fileReady = true
    persistFile(getAgentPolicy())
  }
}).catch(() => {
  fileReady = true
})

void fileReady
