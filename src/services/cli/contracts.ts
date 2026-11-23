import { validateToolCall } from '../agent/core/tools'

type Schema = { type?: string; enum?: readonly unknown[]; anyOf?: readonly Schema[]; properties?: Record<string, Schema>; required?: readonly string[]; [key: string]: unknown }
const text = { type: 'string' } as const
const id = { type: 'integer', minimum: 1 } as const
const bool = { type: 'boolean' } as const
const page = { page: id, pageSize: { type: 'integer', minimum: 1, maximum: 200 }, folderId: id } as const
const object = <const P extends Record<string, Schema>, const R extends readonly string[] = []>(properties: P, required: R = [] as unknown as R) => ({ type: 'object' as const, properties, required, additionalProperties: false })
const command = <const P extends Record<string, Schema> = {}, const R extends readonly string[] = []>(description: string, properties: P = {} as P, required: R = [] as unknown as R) => ({ description, parameters: object(properties, required) })
export const CLI_METHODS = {
  methods: command('全部 CLI 方法及参数'),
  status: command('软件状态'),
  'app.show': command('显示主窗口'),
  'config.get': command('读取配置，敏感字段仅显示是否已配置', { key: text }),
  'config.set': command('修改一个可写配置项；使用 config.get 查看配置', { key: text, value: {} }, ['key', 'value']),
  'models.list': command('供应商、模型和选择状态'),
  'models.add': command('添加自定义供应商/模型，必须从标准输入读取 JSON', {
    platformId: text, name: text, baseUrl: text, apiKey: text,
    protocol: { type: 'string', enum: ['openai-chat', 'openai-response', 'anthropic'] },
    model: object({ modelId: text, displayName: text, maxTokens: { type: 'integer', minimum: 1, maximum: 1000000 }, supportsTools: bool, hasVision: bool }, ['modelId']),
  }, ['model']),
  'models.key': command('设置供应商密钥，必须从标准输入读取 JSON', { platformId: text, apiKey: text }, ['platformId', 'apiKey']),
  'models.select': command('选择模型，id 为 null 时清除选择', { id: { anyOf: [text, { type: 'null' }] }, role: { type: 'string', enum: ['answer', 'summary', 'agent'] } }, ['id', 'role']),
  'models.platform_remove': command('删除自定义供应商及其模型', { platformId: text, confirm: { type: 'boolean', enum: [true] } }, ['platformId', 'confirm']),
  'models.remove': command('删除自定义模型', { id: text, confirm: { const: true, type: 'boolean', enum: [true] } }, ['id', 'confirm']),
  'accounts.list': command('列出网站凭据的配置状态'),
  'accounts.set': command('更新网站凭据，必须从标准输入读取 JSON', { host: text, account: text, password: text }, ['host', 'account', 'password']),
  'accounts.remove': command('删除网站凭据', { host: text, confirm: { type: 'boolean', enum: [true] } }, ['host', 'confirm']),
  'folders.list': command('文件夹列表'),
  'folders.add': command('添加文件夹', { name: text, parentId: { type: 'integer', minimum: 0 } }, ['name']),
  'folders.rename': command('重命名文件夹', { id, name: text }, ['id', 'name']),
  'folders.delete': command('删除文件夹', { id, deleteQuestions: bool, confirm: { type: 'boolean', enum: [true] } }, ['id', 'confirm']),
  'questions.list': command('分页题目列表', page),
  'questions.search': command('本地题库搜索', { ...page, keyword: text }, ['keyword']),
  'questions.add': command('添加题目', { content: text, options: text, answer: text, folderId: id, questionType: text }, ['content', 'answer', 'folderId']),
  'questions.update': command('更新题目', { id, content: text, options: text, answer: text, questionType: text }, ['id']),
  'questions.delete': command('删除题目', { id, confirm: { type: 'boolean', enum: [true] } }, ['id', 'confirm']),
  'server.status': command('题库 HTTP 服务状态'),
  'server.start': command('按网络配置启动题库 HTTP 服务'),
  'server.stop': command('停止题库 HTTP 服务'),
  'agent.list': command('对话列表与任务状态'),
  'agent.run': command('发送任务，返回对话 ID', { text, sessionId: text }, ['text']),
  'agent.status': command('对话状态；messageId 指定要查询的任务', { id: text, messageId: text }, ['id']),
  'agent.stop': command('停止运行任务；已结束的 messageId 不会停止下一轮任务', { id: text, messageId: text }, ['id']),
  'agent.remove': command('删除对话并释放其浏览器', { id: text, confirm: { type: 'boolean', enum: [true] } }, ['id', 'confirm']),
  'browser.list': command('浏览器标签页'),
  'browser.open': command('新建浏览器对话并打开网址', { url: text, sessionId: text }, ['url']),
  'browser.state': command('标签页状态', { id: text }, ['id']),
  'websites.list': command('已安装的网站经验'),
  'websites.install': command('从 Open 安装网址对应的经验', { url: text }, ['url']),
  'websites.refresh': command('更新已安装的网站经验', { host: text }, ['host']),
  'websites.remove': command('移除网站及其本地配置、账号与经验；默认必需仓库受保护', { host: text, confirm: { type: 'boolean', enum: [true] } }, ['host', 'confirm']),
  'tools.list': command('工具目录与参数；网站工具按网址加载', { url: text }),
  'tools.run': command('直接执行工具，复用对话、审批和操作校验，返回任务 ID', { name: text, args: { type: 'object' }, sessionId: text }, ['name', 'args']),
  'tools.result': command('读取完整工具结果；大于 2 MiB 时返回明确错误', { id: text, messageId: text }, ['id']),
} as const

type InferSchema<S> = S extends { anyOf: readonly (infer V)[] } ? InferSchema<V>
  : S extends { enum: readonly (infer V)[] } ? V
  : S extends { type: 'string' } ? string
  : S extends { type: 'integer' | 'number' } ? number
  : S extends { type: 'boolean' } ? boolean
  : S extends { type: 'null' } ? null
  : S extends { type: 'object'; properties: infer P; required: readonly (infer R)[] }
    ? keyof P extends never ? Record<string, never> : { [K in keyof P as K extends R ? K : never]: InferSchema<P[K]> } & { [K in keyof P as K extends R ? never : K]?: InferSchema<P[K]> }
  : S extends { type: 'object' } ? Record<string, unknown> : unknown
export type CliMethod = keyof typeof CLI_METHODS
export type CliParams<M extends CliMethod> = InferSchema<(typeof CLI_METHODS)[M]['parameters']>
export type CliContext = { assertActive: () => Promise<void> }
export type CliHandler<M extends CliMethod> = (params: CliParams<M>, context: CliContext) => Promise<unknown>
export type CliHandlers = { [M in CliMethod]: CliHandler<M> }
export type CliHandlerGroup<P extends string> = Pick<CliHandlers, Extract<CliMethod, `${P}.${string}`>>

export function validateCliRequest(method: string, params: unknown): asserts method is CliMethod {
  if (!Object.hasOwn(CLI_METHODS, method)) throw new Error('未知 CLI 方法，请运行 zerror methods')
  const entry = CLI_METHODS[method as keyof typeof CLI_METHODS]
  const error = validateToolCall([{ type: 'function', function: { name: method, parameters: entry.parameters } }], { name: method, arguments: JSON.stringify(params) })
  if (error) throw new Error(error)
}

export const safeCliOutput = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(safeCliOutput)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /password|api.?key|(?:^|access|refresh|admin)token$|authorization|cookie|secret|customHeaders/i.test(key) ? (item ? '[已配置]' : '') : safeCliOutput(item),
  ]))
  return value
}

/** 仅允许已知配置路径，禁止沿用户可控路径访问对象原型。 */
export function configValue(settings: unknown, key?: string): unknown {
  if (!key) return settings
  const path = key.split('.')
  let current = settings
  for (const part of path) {
    if (['__proto__', 'prototype', 'constructor'].includes(part) || !current || typeof current !== 'object' || !Object.hasOwn(current, part)) throw new Error('未知配置项')
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function patchConfig<T extends object>(settings: T, key: string, value: unknown): T {
  const next = JSON.parse(JSON.stringify(settings))
  const searchKeys = ['search.apiKey', 'search.deepseekApiKey', 'search.tavilyApiKey', 'search.braveApiKey', 'search.youApiKey']
  if (!searchKeys.includes(key)) configValue(next, key)
  const enums: Record<string, unknown[]> = { 'questionImport.saveMode': ['ask', 'auto', 'never'], theme: ['light', 'dark', 'auto'], language: ['zh-CN', 'en-US'], defaultDifficulty: ['easy', 'medium', 'hard'], 'search.provider': ['exa', 'deepseek', 'tavily', 'brave', 'you'] }
  const booleans = ['autoSave', 'autoAddToQuestionBank', 'showExplanation', 'autoUpdate', 'enableNotifications', 'suppressNoModelWarning', 'network.enableLanAccess', 'search.enabled']
  const ranges: Record<string, [number, number]> = { modelResponseTimeout: [5, 600], modelRetryCount: [0, 10], itemsPerPage: [1, 200], 'network.serverPort': [1, 65535] }
  if (searchKeys.includes(key)) { if (typeof value !== 'string') throw new Error('搜索密钥必须是字符串') }
  else if (enums[key]) { if (!enums[key].includes(value)) throw new Error('配置值不在允许范围内') }
  else if (booleans.includes(key)) { if (typeof value !== 'boolean') throw new Error('配置值必须是布尔值') }
  else if (ranges[key]) { const [min, max] = ranges[key]; if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`配置值必须是 ${min}–${max} 的整数`) }
  else throw new Error('该配置项暂不支持通过 CLI 修改；模型和网站账号请使用对应命令')
  const path = key.split('.')
  let parent = next as Record<string, unknown>
  for (const part of path.slice(0, -1)) parent = parent[part] as Record<string, unknown>
  parent[path.at(-1)!] = value
  return next
}
