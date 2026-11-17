import { reactive } from 'vue'

export type PermissionMode = 'explore' | 'strict'
export type ConfirmPolicy = 'allow' | 'ask' | 'deny'
export type SubmitPolicy = 'ask' | 'allow'

export type AgentPolicy = {
  permissionMode: PermissionMode
  writeSkills: ConfirmPolicy
  submit: SubmitPolicy
  campusUpload: boolean
  campusEdit: boolean
}

const STORAGE_KEY = 'zerror-agent-policy'
const CONFIG_FILE = 'agent-policy.json'

const defaultPolicy = (): AgentPolicy => ({
  permissionMode: 'explore',
  writeSkills: 'ask',
  submit: 'ask',
  campusUpload: false,
  campusEdit: false,
})

export const agentPolicyState = reactive<AgentPolicy>(defaultPolicy())

let policyChanged = false
let pendingWrite = Promise.resolve()

const asPolicy = (raw: unknown): AgentPolicy => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const permissionMode = row.permissionMode === 'strict' ? 'strict' : 'explore'
  const writeSkills = row.writeSkills === 'allow' || row.writeSkills === 'deny' ? row.writeSkills : 'ask'
  const submit = row.submit === 'allow' ? 'allow' : 'ask'
  return {
    permissionMode, writeSkills, submit,
    campusUpload: row.campusUpload === true,
    campusEdit: row.campusEdit === true,
  }
}

const apply = (policy: AgentPolicy) => {
  Object.assign(agentPolicyState, policy)
}

const persistFile = (policy: AgentPolicy) => {
  pendingWrite = pendingWrite.then(async () => {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
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

const readLocal = (): Partial<AgentPolicy> => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

const save = (policy: AgentPolicy) => {
  apply(policy)
  writeLocal(policy)
  persistFile(policy)
}

export const getAgentPolicy = (): AgentPolicy => ({ ...agentPolicyState })

export const setAgentPolicy = (patch: Partial<AgentPolicy>) => {
  policyChanged = true
  save(asPolicy({ ...getAgentPolicy(), ...patch }))
}

apply(asPolicy(readLocal()))

void import('@tauri-apps/plugin-fs').then(async ({ readTextFile, BaseDirectory }) => {
  try {
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    }))
    if (policyChanged) return
    const local = readLocal()
    save(asPolicy({
      ...local, ...raw,
      campusUpload: local.campusUpload ?? raw?.campusUpload,
      campusEdit: local.campusEdit ?? raw?.campusEdit,
    }))
  } catch {
    if (!policyChanged) persistFile(getAgentPolicy())
  }
}).catch(() => undefined)
