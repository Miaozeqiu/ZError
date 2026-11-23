import { invoke } from '@tauri-apps/api/core'
import { CLI_METHODS, validateCliRequest, safeCliOutput, type CliHandlers, type CliMethod, type CliParams } from './contracts'
import { redactNative } from '../security/secureStore'
import { configHandlers } from './handlers/config'
import { modelHandlers } from './handlers/models'
import { accountHandlers } from './handlers/accounts'
import { agentHandlers } from './handlers/agent'
import { folderHandlers, questionHandlers } from './handlers/database'
import { browserHandlers } from './handlers/browser'
import { serverHandlers } from './handlers/server'
import { websiteHandlers } from './handlers/websites'
import { toolHandlers } from './handlers/tools'

/** 每个参数定义都必须有对应的类型化处理函数；缺失时由类型检查报错。 */
export const cliHandlers: CliHandlers = {
  ...configHandlers, ...modelHandlers, ...accountHandlers, ...agentHandlers,
  ...folderHandlers, ...questionHandlers, ...browserHandlers, ...serverHandlers, ...websiteHandlers, ...toolHandlers,
  methods: async () => CLI_METHODS,
  status: async () => {
    const [{ modelConfigManager }, { getVersion }, server] = await Promise.all([import('../model/configManager'), import('@tauri-apps/api/app'), invoke('get_server_status')])
    await modelConfigManager.ready
    return { version: await getVersion(), platform: navigator.platform, server, agentModel: modelConfigManager.getSelectedAgentModel()?.id || null }
  },
  'app.show': async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow(); await window.show(); await window.unminimize(); await window.setFocus()
    return { visible: true }
  },
}

// 同一对话的启动请求排队期间，停止和状态查询仍可执行。
// 配置写入交给共用文档管理器，不另设 CLI 专用队列。
const sessions = new Map<string, Promise<unknown>>()
async function execute<M extends CliMethod>(method: M, params: CliParams<M>, assertActive: () => Promise<void>) {
  await assertActive()
  return cliHandlers[method](params, { assertActive })
}
export async function dispatchCli(method: string, params: unknown, assertActive: () => Promise<void> = async () => undefined): Promise<unknown> {
  validateCliRequest(method, params)
  // 仅在 JSON 校验边界进行类型转换；处理函数参数类型由定义推导。
  const input = params as CliParams<typeof method>
  const sessionId = ['agent.run', 'tools.run', 'browser.open'].includes(method) && 'sessionId' in input ? input.sessionId : undefined
  const key = typeof sessionId === 'string' ? sessionId : method.startsWith('server.') && method !== 'server.status' ? 'server' : undefined
  const operation = key ? (sessions.get(key) || Promise.resolve()).catch(() => undefined).then(() => execute(method, input, assertActive)) : execute(method, input, assertActive)
  if (key) sessions.set(key, operation)
  try { return await redactNative(safeCliOutput(await operation)) }
  finally { if (key && sessions.get(key) === operation) sessions.delete(key) }
}
