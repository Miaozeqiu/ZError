import { parseDocument, stringify } from 'yaml'

const fields = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'])
const record = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)
const string = (value: unknown) => typeof value === 'string' ? value.trim() : ''
export const isSkillName = (name: string) => name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)

/** Parse YAML once for runtime, editor preview and validation. Never render the header as Markdown. */
export const parseSkillFrontmatter = (raw: string) => {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  const errors: string[] = []
  let data: Record<string, unknown> = {}
  if (match) {
    try {
      const doc = parseDocument(match[1])
      errors.push(...doc.errors.map(error => error.message))
      if (!errors.length) {
        const value: unknown = doc.toJS({ maxAliasCount: 100 })
        if (record(value)) data = value
        else errors.push('YAML frontmatter 必须是字段映射')
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'YAML 解析失败')
    }
  } else if (/^---[ \t]*\r?\n/.test(text)) {
    errors.push('YAML frontmatter 缺少结束分隔符 ---')
  }
  const metadata = record(data.metadata) ? data.metadata : {}
  const scopeValue = metadata['zerror-scope'] ?? data.scope
  const scope: 'browser' | 'learning' | 'both' | '' = scopeValue === 'browser' || scopeValue === 'learning' || scopeValue === 'both' ? scopeValue : ''
  return {
    name: string(data.name),
    displayName: string(metadata['display-name']) || string(data.name),
    description: string(data.description),
    compatibility: string(data.compatibility),
    allowedTools: string(data['allowed-tools']),
    license: string(data.license),
    metadata,
    scope,
    data,
    errors,
    body: (match ? match[2] : text).trim(),
    rawBody: match ? match[2] : text,
    header: match?.[1] ?? '',
    hasFrontmatter: Boolean(match),
  }
}

/** Root SKILL.md only; sites/<host>/SKILL.md are supporting documents. */
export const validateSkillMarkdown = (raw: string, directory: string): string[] => {
  const parsed = parseSkillFrontmatter(raw)
  const errors = [...parsed.errors]
  if (!parsed.hasFrontmatter) errors.push('SKILL.md 必须包含 YAML frontmatter')
  if (!isSkillName(directory)) errors.push('旧版目录 ID 不符合标准，请重新安装到小写英文、数字和连字符组成的目录')
  if (!isSkillName(parsed.name)) errors.push('name 必须为 1–64 位小写英文、数字或单连字符')
  if (parsed.name !== directory) errors.push(`name 必须与目录一致：${directory}`)
  if (typeof parsed.data.name !== 'string') errors.push('name 必须是字符串')
  if (typeof parsed.data.description !== 'string' || !parsed.description || parsed.description.length > 1024) {
    errors.push('description 必须是 1–1024 字的字符串')
  }
  for (const key of ['license', 'compatibility', 'allowed-tools']) {
    if (key in parsed.data && typeof parsed.data[key] !== 'string') errors.push(`${key} 必须是字符串`)
  }
  if (parsed.compatibility.length > 500) errors.push('compatibility 不得超过 500 字')
  if ('metadata' in parsed.data && (!record(parsed.data.metadata) || Object.values(parsed.metadata).some(value => typeof value !== 'string'))) {
    errors.push('metadata 必须是字符串到字符串的映射')
  }
  for (const key of Object.keys(parsed.data)) {
    if (!fields.has(key)) errors.push(`非标准字段 ${key}，请移入 metadata`)
  }
  return errors
}

export const createSkillMarkdown = (name: string, description: string, displayName: string, body: string) => (
  `---\n${stringify({ name, description, metadata: { 'display-name': displayName } })}---\n${body}`
)

/** Convert old Chinese names/scope without changing a single character of the body. No disk writes. */
export const normalizeLegacySkillMarkdown = (
  raw: string,
  directory: string,
  fallback: { name: string; description: string },
): string => {
  const parsed = parseSkillFrontmatter(raw)
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'))
  // Old directory IDs are kept readable. Never rename user directories or break historical IDs implicitly.
  if (!isSkillName(directory)) return raw
  if (!parsed.hasFrontmatter) return createSkillMarkdown(directory, fallback.description, fallback.name, parsed.rawBody)
  const doc = parseDocument(parsed.header)
  let changed = false
  if (typeof parsed.data.name === 'string' && parsed.name && !isSkillName(parsed.name) && /[^\x00-\x7f]/.test(parsed.name)) {
    if (!('metadata' in parsed.data)) doc.set('metadata', doc.createNode({}))
    if (!parsed.metadata['display-name']) doc.setIn(['metadata', 'display-name'], parsed.name)
    doc.set('name', directory)
    changed = true
  }
  if ('scope' in parsed.data && parsed.scope) {
    if (!doc.has('metadata')) doc.set('metadata', doc.createNode({}))
    doc.setIn(['metadata', 'zerror-scope'], parsed.scope)
    doc.delete('scope')
    changed = true
  }
  return changed ? `---\n${doc.toString()}---\n${parsed.rawBody}` : raw
}

export const prepareSkillMarkdown = (raw: string, directory: string, fallback: { name: string; description: string }) => {
  const content = normalizeLegacySkillMarkdown(raw, directory, fallback)
  const errors = validateSkillMarkdown(content, directory)
  if (errors.length) throw new Error(`Skill 格式错误：\n${errors.join('\n')}`)
  return content
}
