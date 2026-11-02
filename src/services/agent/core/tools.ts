export type ToolDefinition = { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, any> } }
/** Registry/schema checking is deterministic and runs before any handler or optional hook. */
export const toolRegistry = (definitions: unknown[]) => {
  const registry = new Map<string, ToolDefinition>()
  for (const value of definitions) {
    const tool = value as ToolDefinition
    if (tool?.type !== 'function' || !tool.function?.name) continue
    if (registry.has(tool.function.name)) throw new Error(`重复工具定义：${tool.function.name}`)
    registry.set(tool.function.name, tool)
  }
  return registry
}
const validate = (value: unknown, schema: Record<string, any>, path: string): string | undefined => {
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) return `${path} 不在允许值中`
  if (schema.anyOf && !schema.anyOf.some((part: any) => !validate(value, part, path))) return `${path} 不符合任一允许格式`
  const kind = schema.type
  if (kind === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} 必须是对象`
    const row = value as Record<string, unknown>
    for (const key of schema.required || []) if (row[key] === undefined) return `${path}.${key} 缺失`
    for (const [key, item] of Object.entries(row)) {
      if (schema.properties?.[key]) { const error = validate(item, schema.properties[key], `${path}.${key}`); if (error) return error }
      else if (schema.additionalProperties === false) return `${path}.${key} 未声明`
    }
  } else if (kind === 'array') {
    if (!Array.isArray(value)) return `${path} 必须是数组`
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return `${path} 数量超出范围`
    for (let index = 0; index < value.length; index++) { const error = validate(value[index], schema.items || {}, `${path}[${index}]`); if (error) return error }
  } else if (kind === 'string' && typeof value !== 'string') return `${path} 必须是字符串`
  else if (kind === 'boolean' && typeof value !== 'boolean') return `${path} 必须是布尔值`
  else if ((kind === 'number' || kind === 'integer') && (typeof value !== 'number' || !Number.isFinite(value) || (kind === 'integer' && !Number.isInteger(value)))) return `${path} 必须是有效数字`
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return `${path} 数值超出范围`
  return undefined
}
export const validateToolCall = (definitions: unknown[], call: { name: string; arguments: string }) => {
  const tool = toolRegistry(definitions).get(call.name)
  if (!tool) return '工具未在本轮注册，不能执行；请只使用当前提供的工具。'
  let args: unknown
  try { args = JSON.parse(call.arguments || '{}') } catch { return '工具参数不是合法 JSON；请根据工具定义修正，不会尝试执行。' }
  return validate(args, tool.function.parameters || { type: 'object' }, '参数')
}
