import type { ToolDefinition } from '../core/tools'
import { validateToolCall } from '../core/tools'

export const WEBSITE_HOST_API = 2
export const WEBSITE_TOOL_TIMEOUT_MS = 120_000
export const WEBSITE_TOOL_PREFIX = 'browser_site_'
export const isWebsiteHostCommand = (name: string) => name === 'browser_package_read' || name === 'browser_package_act'
export const isWebsiteRuntimeToolName = (name: string) => /^browser_site_[a-z0-9_]+__[a-z][a-z0-9_]{0,23}$/.test(name) && name.length <= 63
export const WEBSITE_COMMANDS = ['context.publish', 'resource.read', 'browser.observe', 'browser.navigate', 'browser.click', 'browser.fill',
  'browser.press', 'browser.scroll', 'browser.wait', 'page.wait',
  'document.list', 'document.frames', 'document.query', 'document.glyphs', 'document.value', 'document.reveal', 'document.scroll', 'document.select', 'document.image', 'document.compare', 'document.navigate', 'document.click', 'document.fill',
  'media.read', 'media.play', 'media.pause', 'media.mute', 'media.wait', 'credentials.request', 'credentials.fill', 'workflow.checkpoint', 'service.session', 'service.check', 'service.request', 'service.read',
  'payload.from_state', 'payload.create', 'payload.append', 'state.read', 'state.write', 'knowledge.search', 'model.generate', 'questions.publish'] as const
export type WebsiteCommandName = typeof WEBSITE_COMMANDS[number]
export type WebsiteCommand = { op: WebsiteCommandName; args: Record<string, unknown> }
export type WebsitePackageTool = {
  name: string; description: string; parameters: Record<string, unknown>; result: Record<string, unknown>
  commands: WebsiteCommandName[]
}
export type WebsiteAutomation = { event: 'page'; tool: string }
export const PASSIVE_WEBSITE_COMMANDS = new Set<string>(['context.publish','resource.read','document.frames','document.glyphs','questions.publish','document.list','document.query','document.value','document.compare','browser.wait', 'service.session','service.check','service.request','service.read','state.read','state.write','payload.create','payload.append','payload.from_state'])
export type WebsiteRuntimePackage = {
  resources?: Array<{ id: string; size: number; sha256: string; data: string }>
  automations?: WebsiteAutomation[]
  apiVersion: 2
  bundle: { code: string; sha256: string }
  tools: WebsitePackageTool[]
}
export type InstalledWebsiteTool = {
  host: string; siteId: string; revision: string; authority: string
  source?: string
  runtime: WebsiteRuntimePackage; tool: WebsitePackageTool
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const identifier = /^[a-z][a-z0-9_]{0,23}$/
const maxBundleBytes = 256 * 1024

export const websiteToolName = (siteId: string, name: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId) || siteId.length > 24 || !identifier.test(name)) {
    throw new Error('网站工具命名空间无效')
  }
  return `${WEBSITE_TOOL_PREFIX}${siteId.replaceAll('-', '_')}__${name}`
}

// Limit the schema vocabulary to the constraints the host actually enforces.
const schemaKeys = new Set(['type', 'description', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems'])
const schemaTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
function validateSchema(value: unknown, depth = 0): asserts value is Record<string, unknown> {
  if (!record(value) || depth > 12 || Object.keys(value).some(key => !schemaKeys.has(key))
    || !schemaTypes.has(String(value.type))) throw new Error('网站工具包含不支持的参数或结果 schema')
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 2000)) throw new Error('schema 描述无效')
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 64)) throw new Error('schema 枚举无效')
  for (const key of ['minimum', 'maximum', 'minItems', 'maxItems']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key])
      || (key.endsWith('Items') && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)))) throw new Error('schema 数值限制无效')
  }
  if (value.type === 'object') {
    if (!record(value.properties) || Object.keys(value.properties).length > 64 || value.additionalProperties !== false
      || !Array.isArray(value.required) || value.required.some(key => typeof key !== 'string' || !Object.hasOwn(value.properties as object, key))) {
      throw new Error('网站工具对象 schema 必须声明字段并拒绝额外字段')
    }
    for (const [key, child] of Object.entries(value.properties)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) throw new Error('schema 字段名称无效')
      validateSchema(child, depth + 1)
    }
  } else if (value.type === 'array') {
    if (!Number.isSafeInteger(value.maxItems) || Number(value.maxItems) > 1024) throw new Error('网站工具数组必须有界')
    validateSchema(value.items, depth + 1)
  }
}

export function validateWebsiteRuntime(value: unknown, siteId: string): WebsiteRuntimePackage {
  if (!record(value) || value.apiVersion !== WEBSITE_HOST_API || !record(value.bundle)
    || typeof value.bundle.code !== 'string' || !value.bundle.code.trim()
    || new TextEncoder().encode(value.bundle.code).length > maxBundleBytes
    || typeof value.bundle.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.bundle.sha256)
    || !Array.isArray(value.tools) || !value.tools.length || value.tools.length > 32
    || new TextEncoder().encode(JSON.stringify(value.tools)).length > 64 * 1024) throw new Error('网站运行包格式或宿主 API 不兼容')
  const names = new Set<string>()
  let resources: WebsiteRuntimePackage['resources']
  if (value.resources !== undefined) {
    if (!Array.isArray(value.resources) || value.resources.length > 4) throw new Error('网站资源清单无效')
    const ids = new Set<string>(); let total = 0
    resources = value.resources.map(raw => {
      if (!record(raw) || Object.keys(raw).some(key => !['id', 'size', 'sha256', 'data'].includes(key))
        || typeof raw.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.id) || ids.has(raw.id)
        || !Number.isSafeInteger(raw.size) || Number(raw.size) < 1 || Number(raw.size) > 1024 * 1024
        || (total += Number(raw.size)) > 1024 * 1024 || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
        || typeof raw.data !== 'string' || raw.data.length !== Math.ceil(Number(raw.size) / 3) * 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)) throw new Error('网站资源格式或容量无效')
      ids.add(raw.id)
      return { id: raw.id, size: Number(raw.size), sha256: raw.sha256, data: raw.data }
    })
  }
  const tools = value.tools.map(raw => {
    if (!record(raw) || typeof raw.name !== 'string' || typeof raw.description !== 'string'
      || !raw.description.trim() || raw.description.length > 1000
      || !Array.isArray(raw.commands) || raw.commands.length > WEBSITE_COMMANDS.length
      || new Set(raw.commands).size !== raw.commands.length
      || raw.commands.some(command => !(WEBSITE_COMMANDS as readonly unknown[]).includes(command))) throw new Error('网站工具定义无效')
    const name = websiteToolName(siteId, raw.name)
    if (names.has(name)) throw new Error('网站工具重名')
    names.add(name)
    validateSchema(raw.parameters)
    validateSchema(raw.result)
    if (raw.parameters.type !== 'object' || raw.result.type !== 'object') throw new Error('网站工具输入与结果必须是对象')
    return { name: raw.name, description: raw.description, parameters: raw.parameters, result: raw.result,
      commands: raw.commands as WebsiteCommandName[] }
  })
  let automations: WebsiteAutomation[] | undefined
  if (value.automations !== undefined) {
    if (!Array.isArray(value.automations) || value.automations.length > 8) throw new Error('网站自动任务数量无效')
    const names = new Set<string>()
    automations = value.automations.map(raw => {
      if (!record(raw) || raw.event !== 'page' || typeof raw.tool !== 'string' || Object.keys(raw).some(key => !['event','tool'].includes(key)) || names.has(raw.tool)) throw new Error('网站自动任务格式无效')
      const tool = tools.find(tool => tool.name === raw.tool)
      if (!tool || !tool.commands.every(command => PASSIVE_WEBSITE_COMMANDS.has(command))) throw new Error('后台自动任务不能修改网页、弹凭据或调用模型')
      names.add(raw.tool)
      return { event: 'page' as const, tool: raw.tool }
    })
  }
  return { ...(resources ? { resources } : {}), ...(automations ? { automations } : {}), apiVersion: 2, bundle: { code: value.bundle.code, sha256: value.bundle.sha256 }, tools }
}

export const websiteRuntimeTools = (siteId: string, runtime: WebsiteRuntimePackage): ToolDefinition[] => runtime.tools.map(tool => ({
  type: 'function', function: { name: websiteToolName(siteId, tool.name), description: tool.description, parameters: tool.parameters },
}))

export async function verifyWebsiteRuntime(runtime: WebsiteRuntimePackage) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(runtime.bundle.code))
  const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== runtime.bundle.sha256) throw new Error('网站编译产物哈希不匹配')
  for (const resource of runtime.resources || []) {
    const bytes = Uint8Array.from(atob(resource.data), ch => ch.charCodeAt(0))
    if (bytes.length !== resource.size) throw new Error('网站资源大小不匹配')
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== resource.sha256) throw new Error('网站资源哈希不匹配')
  }
}

export function validateWebsiteValue(value: unknown, schema: Record<string, unknown>, label: string) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined || new TextEncoder().encode(serialized).length > 128 * 1024) throw new Error(`${label}超出大小限制`)
  const name = 'validate_website_value'
  const error = validateToolCall([{ type: 'function', function: { name, parameters: schema } }], { name, arguments: serialized })
  if (error) throw new Error(`${label}无效：${error}`)
}
