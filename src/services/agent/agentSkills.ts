import { redactNative } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { reactive } from 'vue'
import { createSkillMarkdown, normalizeLegacySkillMarkdown, parseSkillFrontmatter, prepareSkillMarkdown, validateSkillMarkdown } from './skillFormat'
import { normalizeWebsiteHost, websitePrimaryHost } from './websiteIdentity'
import { isBuiltinRuntimeSkillFile, WEBSITE_RUNTIME_FILE_HINT } from './skillRuntimeFiles'
import { resolveWebsiteSkillTarget } from './websiteSkillTarget'
export { parseSkillFrontmatter } from './skillFormat'
import {
  listBundledSkillFiles,
  readBundledSkillFile,
} from './skills/builtinSkillAssets'
const isParserScriptPath = (path: string) => (
  /(?:^|\/)parsers\/[^/]+\/[^/]+\.js$/i.test(String(path || '').replace(/\\/g, '/'))
)
import { CHAOXING_SKILL_DESCRIPTION } from './skills/chaoxing'

export type SkillScope = 'browser' | 'learning' | 'both'

export type AgentSkillItem = {
  id: string
  name: string
  description: string
  enabled: boolean
  builtin: boolean
  scope: SkillScope
  customized?: boolean
  source?: string
  sourcePath?: string
  installedAt?: number
  updatedAt?: number
}

export type SkillDocument = {
  id: string
  name: string
  description: string
  markdown: string
  builtin: boolean
  customized: boolean
  source?: string
  sourcePath?: string
  files?: string[]
}

export type SkillFileContent = {
  id: string
  path: string
  content: string
  readonly: boolean
}

type SkillConfigRow = {
  enabled?: boolean
  source?: string
  sourcePath?: string
  installedAt?: number
  updatedAt?: number
}

type SkillConfigFile = {
  version: number
  skills: Record<string, SkillConfigRow>
}

type SkillMetaFile = {
  id: string
  name: string
  description: string
  source: string
  sourcePath: string
  installedAt: number
  updatedAt: number
}

type BuiltinSkillDef = {
  name: string
  description: string
  triggerHint: string
  defaultEnabled: boolean
  scope: SkillScope
  matchKeywords?: string[]
  editable?: boolean
}

export type SkillCatalogEntry = {
  id: string
  name: string
  description: string
}

export type SkillPromptBlock = {
  id: string
  triggerHint: string
  prompt: string
  preloaded?: boolean
}

const STORAGE_KEY = 'zerror-agent-skills'
const CONFIG_FILE = 'agent-skills.json'
const SKILLS_DIR = '.local/share/zerror/skills'
const SKILL_OVERRIDES_DIR = '.local/share/zerror/skill-overrides'
const SKILL_MAIN_FILE = 'SKILL.md'
const SKILL_META_FILE = 'meta.json'
const MAX_SKILL_FILE_BYTES = 512 * 1024

const TEXT_SKILL_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.sh', '.bash',
  '.py', '.js', '.ts', '.mjs', '.cjs', '.css', '.html', '.xml', '.toml', '.ini', '.csv',
])

const LEGACY_CHAOXING_SKILL_IDS = ['chaoxing-login', 'chaoxing-study', 'chaoxing-homework'] as const

const BUILTIN_SKILLS: Record<string, BuiltinSkillDef> = {
  chaoxing: {
    editable: true,
    name: '学习通',
    description: CHAOXING_SKILL_DESCRIPTION,
    triggerHint: '用户要登录、刷课、播视频、做学习通作业或章节测验时，先 read_agent_skill(chaoxing)。',
    defaultEnabled: true,
    scope: 'browser',
  },
  'campus-bank': {
    name: '校园题库',
    description: '查看、搜索、上传与编辑校园题库试卷和题目。',
    triggerHint: '用户问校园题、学校课、试卷，或要上传/改校园题库时，先 read_agent_skill(campus-bank)。',
    defaultEnabled: true,
    scope: 'learning',
  },
  'question-import': {
    name: '题库导入',
    description: '从附带文件或导入任务识别题目并写入本地/校园题库。',
    triggerHint: '用户要求导入、识别、收录或从文件提取题目时，先 read_agent_skill(question-import)。',
    defaultEnabled: true,
    scope: 'learning',
  },
  'knowledge-graph': {
    name: '知识图谱',
    description: '查看、绘制、补改、聚焦或打开学习页的科目知识图谱。',
    triggerHint: '用户要画图、补章/节、聚焦或打开图谱时，先 read_agent_skill(knowledge-graph)。',
    defaultEnabled: true,
    scope: 'learning',
  },
  'quiz-practice': {
    name: '练习与讲评',
    description: '出练习题、讲评作答、复习错题，以及查看练习记录。',
    triggerHint: '用户要出题、练习、订正或讲评时，先 read_agent_skill(quiz-practice)。',
    defaultEnabled: true,
    scope: 'learning',
  },
  'folder-admin': {
    name: '题库文件夹',
    description: '查看、新建、重命名、移动或删除题库文件夹，以及移动题目、改指标、挂知识点。',
    triggerHint: '用户要整理文件夹、挪题或改题目指标时，先 read_agent_skill(folder-admin)。',
    defaultEnabled: true,
    scope: 'learning',
  },
  'site-graph': {
    editable: true,
    name: '网站图谱',
    description: '改正网站节点、边、网址规则。用图谱工具一条条改，会自动保存。',
    triggerHint: '用户要改网站图谱，或任务中网址对不上节点、缺边、新站点没图时，先 read_agent_skill(site-graph)。',
    defaultEnabled: true,
    scope: 'browser',
  },
  'site-learn': {
    editable: true,
    name: '认识新站点',
    description: '当前网址没有现成刷课步骤时：探路、记录页面结构和站点步骤。先读这个 Skill，再读 sites/<主网站域名>/SKILL.md。',
    triggerHint: '当前站点没有对应步骤、图谱对不上、或没有专用工具时，先 read_agent_skill(site-learn)。',
    defaultEnabled: true,
    scope: 'browser',
  },
  'skill-edit': {
    name: '编辑 Skill',
    description: '列出、阅读、改写或恢复 Agent Skill 文件。先读这个 Skill，写文件细则在 references/edit.md。',
    triggerHint: '用户要改 Skill、问失败原因或要优化流程时，先 read_agent_skill(skill-edit)。',
    defaultEnabled: true,
    scope: 'both',
  },
}

export const agentSkillsState = reactive({
  ready: false,
  items: [] as AgentSkillItem[],
  installing: false,
  installError: '',
})

let memoryConfig: SkillConfigFile = { version: 1, skills: {} }
let fileReady = false

const defaultConfig = (): SkillConfigFile => ({ version: 1, skills: {} })

const migrateSkillConfig = (config: SkillConfigFile): SkillConfigFile => {
  const skills = { ...config.skills }
  let chaoxingRow = skills.chaoxing ? { ...skills.chaoxing } : undefined
  for (const id of LEGACY_CHAOXING_SKILL_IDS) {
    const row = skills[id]
    if (!row) continue
    if (!chaoxingRow) chaoxingRow = { ...row }
    else if (row.enabled === false) chaoxingRow = { ...chaoxingRow, enabled: false }
    delete skills[id]
  }
  if (chaoxingRow) skills.chaoxing = chaoxingRow
  return { ...config, skills }
}

const readLocal = (): SkillConfigFile => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as SkillConfigFile
    if (!raw || typeof raw !== 'object') return defaultConfig()
    return migrateSkillConfig({
      version: Number(raw.version) || 1,
      skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    })
  } catch {
    return defaultConfig()
  }
}

const writeLocal = (config: SkillConfigFile) => {
  memoryConfig = config
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // quota
  }
}

const persistFile = (config: SkillConfigFile) => {
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(config), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

const loadFile = async (): Promise<SkillConfigFile> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    })) as SkillConfigFile
    if (!raw || typeof raw !== 'object') return defaultConfig()
    return migrateSkillConfig({
      version: Number(raw.version) || 1,
      skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    })
  } catch {
    return defaultConfig()
  }
}

const saveConfig = (config: SkillConfigFile) => {
  writeLocal(config)
  persistFile(config)
  syncState()
}

const isEnabled = (id: string, row?: SkillConfigRow) => {
  if (typeof row?.enabled === 'boolean') return row.enabled
  return BUILTIN_SKILLS[id]?.defaultEnabled ?? true
}

const buildBuiltinMarkdown = (id: string, def: BuiltinSkillDef) => {
  const bundled = readBundledSkillFile(id, SKILL_MAIN_FILE)
  if (bundled) return bundled
  return createSkillMarkdown(id, def.description, def.name, `\n${def.triggerHint}\n`)
}

const readBuiltinSkillFileRaw = (id: string, relativePath: string): string | null => {
  const path = normalizeSkillRelativePath(relativePath) || (relativePath === SKILL_MAIN_FILE ? SKILL_MAIN_FILE : null)
  if (!path) return null
  return readBundledSkillFile(id, path)
}

const skillItemOf = (id: string): AgentSkillItem | null => (
  agentSkillsState.items.find((item) => item.id === id)
  || fallbackBuiltinItems().find((item) => item.id === id)
  || null
)

/** Runtime mutations remain available for website learning; other builtins are read-only. */
export const isSkillEditable = (id: string): boolean => {
  const item = skillItemOf(id)
  return Boolean(item && (!item.builtin || BUILTIN_SKILLS[id]?.editable))
}

/** Internal authoring/navigation instructions are not user-facing website configurations. */
export const isSkillVisibleInSettings = (id: string): boolean => {
  const item = skillItemOf(id)
  return Boolean(item && (!item.builtin || id === 'chaoxing'))
}

const assertSkillEditable = (id: string) => {
  if (!isSkillEditable(id)) throw new Error('此内置 Skill 为只读，不能修改或恢复')
}

export const skillFileWriteError = (id: string, relativePath: string): string | null => (
  BUILTIN_SKILLS[id] && !isBuiltinRuntimeSkillFile(relativePath) ? WEBSITE_RUNTIME_FILE_HINT : null
)

const isTextSkillFile = (relativePath: string) => {
  const lower = relativePath.toLowerCase()
  const base = lower.split('/').pop() || lower
  if (base === 'skill.md' || base === 'license' || base === 'makefile') return true
  const dot = base.lastIndexOf('.')
  if (dot === -1) return false
  return TEXT_SKILL_EXTENSIONS.has(base.slice(dot))
}

const normalizeSkillRelativePath = (raw: string) => {
  const normalized = String(raw || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..') || normalized === SKILL_META_FILE) return null
  if (!isTextSkillFile(normalized)) return null
  return normalized
}

const skillOverrideDir = (id: string) => `${SKILL_OVERRIDES_DIR}/${id}`

const walkSkillDir = async (dir: string): Promise<string[]> => {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(dir, { baseDir: BaseDirectory.Home })
    const files: string[] = []
    for (const entry of entries) {
      const name = entry.name || ''
      if (!name) continue
      const relative = name
      if (entry.isDirectory) {
        const nested = await walkSkillDir(`${dir}/${name}`)
        files.push(...nested.map((path) => `${relative}/${path}`))
      } else if (entry.isFile) {
        if (isTextSkillFile(relative)) files.push(relative)
      }
    }
    return files.sort((a, b) => a.localeCompare(b, 'en'))
  } catch {
    return []
  }
}

const readSkillOverride = async (id: string): Promise<string | null> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    try {
      return await readTextFile(`${skillOverrideDir(id)}/${SKILL_MAIN_FILE}`, { baseDir: BaseDirectory.Home })
    } catch {
      return await readTextFile(`${SKILL_OVERRIDES_DIR}/${id}.md`, { baseDir: BaseDirectory.Home })
    }
  } catch {
    return null
  }
}

const hasSkillOverride = async (id: string) => {
  if (await readSkillOverride(id)) return true
  const extras = await walkSkillDir(skillOverrideDir(id))
  if (extras.some((path) => path !== SKILL_MAIN_FILE && isBuiltinRuntimeSkillFile(path))) return true
  if (id === 'chaoxing') {
    for (const legacyId of LEGACY_CHAOXING_SKILL_IDS) {
      if (await readSkillOverride(legacyId)) return true
    }
  }
  return false
}

const writeSkillOverride = async (id: string, markdown: string) => {
  const { writeTextFile, mkdir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  await mkdir(skillOverrideDir(id), { baseDir: BaseDirectory.Home, recursive: true })
  await remove(`${SKILL_OVERRIDES_DIR}/${id}.md`, { baseDir: BaseDirectory.Home }).catch(() => undefined)
  await writeTextFile(`${skillOverrideDir(id)}/${SKILL_MAIN_FILE}`, markdown, { baseDir: BaseDirectory.Home })
}

const removeSkillOverride = async (id: string) => {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(skillOverrideDir(id), { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await remove(`${SKILL_OVERRIDES_DIR}/${id}.md`, { baseDir: BaseDirectory.Home }).catch(() => undefined)
  } catch {
    // ignore
  }
}

const getInstalledSkillDir = (id: string) => `${SKILLS_DIR}/${id}`

const readInstalledSkillFile = async (id: string, relativePath: string): Promise<string | null> => {
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) return null
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(`${getInstalledSkillDir(id)}/${path}`, { baseDir: BaseDirectory.Home })
  } catch {
    return null
  }
}

const writeInstalledSkillFile = async (id: string, relativePath: string, content: string) => {
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) throw new Error('无效的文件路径')
  const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const full = `${getInstalledSkillDir(id)}/${path}`
  const parent = full.split('/').slice(0, -1).join('/')
  if (parent) await mkdir(parent, { baseDir: BaseDirectory.Home, recursive: true })
  await writeTextFile(full, content, { baseDir: BaseDirectory.Home })
}

const readOverrideSkillFile = async (id: string, relativePath: string): Promise<string | null> => {
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) return null
  if (path === SKILL_MAIN_FILE) return readSkillOverride(id)
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(`${skillOverrideDir(id)}/${path}`, { baseDir: BaseDirectory.Home })
  } catch {
    return null
  }
}

const writeOverrideSkillFile = async (id: string, relativePath: string, content: string) => {
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) throw new Error('无效的文件路径')
  const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const full = `${skillOverrideDir(id)}/${path}`
  const parent = full.split('/').slice(0, -1).join('/')
  await mkdir(skillOverrideDir(id), { baseDir: BaseDirectory.Home, recursive: true })
  if (parent !== skillOverrideDir(id)) await mkdir(parent, { baseDir: BaseDirectory.Home, recursive: true })
  await removeLegacySkillOverrideFile(id)
  await writeTextFile(full, content, { baseDir: BaseDirectory.Home })
}

const removeLegacySkillOverrideFile = async (id: string) => {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${SKILL_OVERRIDES_DIR}/${id}.md`, { baseDir: BaseDirectory.Home })
  } catch {
    // ignore
  }
}

export const listSkillFiles = async (id: string): Promise<string[]> => {
  const item = skillItemOf(id)
  if (!item) return []
  const files = new Set<string>()
  if (item.builtin) {
    for (const path of listBundledSkillFiles(id)) files.add(path)
    for (const path of await walkSkillDir(skillOverrideDir(id))) files.add(path)
  } else {
    files.add(SKILL_MAIN_FILE)
    for (const path of await walkSkillDir(getInstalledSkillDir(id))) {
      if (path !== SKILL_META_FILE) files.add(path)
    }
  }
  if (!files.size) files.add(SKILL_MAIN_FILE)
  return [...files].filter((path) => !isParserScriptPath(path) && (!item.builtin || isBuiltinRuntimeSkillFile(path))
    && !(id === 'chaoxing' && path.startsWith('sites/'))
    && !(id === 'site-learn' && /^sites\/[^/]+\//.test(path) && path.split('/')[1] !== websitePrimaryHost(path.split('/')[1]))).sort((a, b) => {
    if (a === SKILL_MAIN_FILE) return -1
    if (b === SKILL_MAIN_FILE) return 1
    return a.localeCompare(b, 'en')
  })
}

const readStoredSkillMarkdown = async (id: string): Promise<string | null> => {
  const override = await readSkillOverride(id)
  if (override) return override
  const bundled = readBundledSkillFile(id, SKILL_MAIN_FILE)
  if (bundled) return bundled
  const builtin = BUILTIN_SKILLS[id]
  if (builtin) return buildBuiltinMarkdown(id, builtin)
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(`${getInstalledSkillDir(id)}/${SKILL_MAIN_FILE}`, { baseDir: BaseDirectory.Home })
  } catch {
    return null
  }
}

// Present old documents in standard form; persist only after an explicit save.
const readSkillMarkdownRaw = async (id: string): Promise<string | null> => {
  const raw = await readStoredSkillMarkdown(id)
  if (!raw) return raw
  const fallback = BUILTIN_SKILLS[id] || await readSkillMeta(id)
  try {
    return normalizeLegacySkillMarkdown(raw, id, fallback || { name: id, description: '' })
  } catch {
    return raw // Keep malformed legacy files editable, with errors reported on save.
  }
}

const listInstalledSkillDirs = async (): Promise<string[]> => {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(SKILLS_DIR, { baseDir: BaseDirectory.Home })
    return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name || '').filter(Boolean)
  } catch {
    return []
  }
}

const readSkillMeta = async (id: string): Promise<SkillMetaFile | null> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(`${SKILLS_DIR}/${id}/meta.json`, { baseDir: BaseDirectory.Home })
    return JSON.parse(raw) as SkillMetaFile
  } catch {
    return null
  }
}

const readSkillBody = async (id: string): Promise<string> => {
  const raw = await readSkillMarkdownRaw(id)
  if (!raw) return ''
  return parseSkillFrontmatter(raw).body
}

const buildItems = async (config: SkillConfigFile): Promise<AgentSkillItem[]> => {
  const items: AgentSkillItem[] = []
  for (const [id, def] of Object.entries(BUILTIN_SKILLS)) {
    const row = config.skills[id]
    const customized = await hasSkillOverride(id)
    let name = def.name
    let description = def.description
    const markdown = (customized ? await readSkillOverride(id) : null) || readBundledSkillFile(id, SKILL_MAIN_FILE)
    if (markdown) {
      const parsed = parseSkillFrontmatter(markdown)
      if (parsed.displayName) name = parsed.displayName
      if (parsed.description) description = parsed.description
    }
    items.push({
      id,
      name,
      description,
      enabled: isEnabled(id, row),
      builtin: true,
      scope: def.scope,
      customized,
      installedAt: row?.installedAt,
      updatedAt: row?.updatedAt,
    })
  }

  const dirs = await listInstalledSkillDirs()
  for (const id of dirs) {
    if (BUILTIN_SKILLS[id] || id === 'parser') continue
    const meta = await readSkillMeta(id)
    const row = config.skills[id]
    if (!meta) continue
    const markdown = await readSkillMarkdownRaw(id)
    const parsed = markdown ? parseSkillFrontmatter(markdown) : null
    items.push({
      id,
      name: parsed?.displayName || meta.name || id,
      description: parsed?.description || meta.description || '',
      enabled: isEnabled(id, row),
      builtin: false,
      scope: parsed?.scope || 'both',
      source: meta.source,
      sourcePath: meta.sourcePath,
      installedAt: meta.installedAt,
      updatedAt: meta.updatedAt,
    })
  }

  return items.sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

const syncState = async () => {
  agentSkillsState.items = await buildItems(memoryConfig)
  agentSkillsState.ready = fileReady
}

memoryConfig = readLocal()
void loadFile().then(async (file) => {
  fileReady = true
  memoryConfig = migrateSkillConfig({
    version: 1,
    skills: { ...memoryConfig.skills, ...file.skills },
  })
  writeLocal(memoryConfig)
  persistFile(memoryConfig)
  await syncState()
})
void syncState()

export const refreshAgentSkills = async () => {
  await syncState()
}

export const setSkillEnabled = (id: string, enabled: boolean) => {
  const config = { ...memoryConfig, skills: { ...memoryConfig.skills } }
  config.skills[id] = {
    ...config.skills[id],
    enabled,
    updatedAt: Date.now(),
  }
  saveConfig(config)
}

export const uninstallSkill = async (id: string) => {
  if (BUILTIN_SKILLS[id]) return
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${SKILLS_DIR}/${id}`, { baseDir: BaseDirectory.Home, recursive: true })
  } catch {
    // ignore
  }
  const config = { ...memoryConfig, skills: { ...memoryConfig.skills } }
  delete config.skills[id]
  saveConfig(config)
}

const promptCache = new Map<string, string>()

const fallbackBuiltinItems = (): AgentSkillItem[] => (
  Object.entries(BUILTIN_SKILLS).map(([id, def]) => ({
    id,
    name: def.name,
    description: def.description,
    enabled: def.defaultEnabled,
    builtin: true,
    scope: def.scope,
  }))
)

const scopeMatches = (scope: SkillScope, want?: SkillScope | AgentKindScope) => {
  if (!want) return true
  return scope === 'both' || scope === want
}

type AgentKindScope = 'browser' | 'learning'

export const getEnabledSkillItems = (scope?: AgentKindScope, allowedIds?: string[]): AgentSkillItem[] => {
  const items = agentSkillsState.items.length ? agentSkillsState.items : fallbackBuiltinItems()
  const enabled = items.filter((item) => item.id !== 'parser' && item.enabled && scopeMatches(item.scope || 'both', scope))
  if (!allowedIds?.length) return enabled
  const allow = new Set(allowedIds)
  return enabled.filter((item) => allow.has(item.id))
}

export const getEnabledSkillCatalog = (scope?: AgentKindScope, allowedIds?: string[]): SkillCatalogEntry[] => (
  getEnabledSkillItems(scope, allowedIds).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
  }))
)

const skillKeywords = (item: AgentSkillItem) => {
  const builtin = BUILTIN_SKILLS[item.id]
  const fromDesc = String(item.description || '')
    .split(/[\s，。；、/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
  const fromName = String(item.name || '').trim()
  const fromId = item.id.replace(/-/g, ' ')
  return [...(builtin?.matchKeywords || []), fromName, fromId, ...fromDesc]
}

const scoreSkill = (item: AgentSkillItem, text: string) => {
  const hay = String(text || '').toLowerCase()
  if (!hay.trim()) return 0
  let score = 0
  for (const keyword of skillKeywords(item)) {
    const key = keyword.trim().toLowerCase()
    if (key.length < 2) continue
    if (hay.includes(key)) score += key.length >= 4 ? 3 : 2
  }
  return score
}

export const matchSkillsForText = (text: string, limit = 2) => {
  const ranked = getEnabledSkillItems()
    .map((item) => ({ id: item.id, score: scoreSkill(item, text) }))
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit).map((row) => row.id)
}

export const getSkillPromptBlock = async (item: AgentSkillItem): Promise<{ triggerHint: string; prompt: string } | null> => {
  const builtin = BUILTIN_SKILLS[item.id]
  if (builtin) {
    const override = await readSkillOverride(item.id)
    const markdown = override || readBundledSkillFile(item.id, SKILL_MAIN_FILE)
    if (markdown) {
      const parsed = parseSkillFrontmatter(markdown)
      const body = parsed.body.trim()
      if (body) {
        return {
          triggerHint: parsed.description
            ? `当符合以下条件时使用：${parsed.description}`
            : builtin.triggerHint,
          prompt: `\n${body}\n`,
        }
      }
    }
    return { triggerHint: builtin.triggerHint, prompt: `\n${builtin.triggerHint}\n` }
  }
  if (promptCache.has(item.id)) {
    const body = promptCache.get(item.id) || ''
    if (!body) return null
    return {
      triggerHint: item.description ? `当符合以下条件时使用：${item.description}` : '按下面 Skill 说明执行。',
      prompt: `\n${body}\n`,
    }
  }
  const body = await readSkillBody(item.id)
  promptCache.set(item.id, body)
  if (!body.trim()) return null
  return {
    triggerHint: item.description ? `当符合以下条件时使用：${item.description}` : '按下面 Skill 说明执行。',
    prompt: `\n${body}\n`,
  }
}

export const getSkillPromptBlocksByIds = async (ids: string[]): Promise<SkillPromptBlock[]> => {
  const enabled = getEnabledSkillItems()
  const blocks: SkillPromptBlock[] = []
  for (const id of ids) {
    const item = enabled.find((row) => row.id === id)
    if (!item) continue
    const block = await getSkillPromptBlock(item)
    if (!block) continue
    blocks.push({
      id: item.id,
      triggerHint: block.triggerHint,
      prompt: block.prompt,
      preloaded: true,
    })
  }
  return blocks
}

export const skillSurfaceFiles = (files: string[]) => files.filter((path) => {
  if (path === SKILL_MAIN_FILE) return true
  if (/^references\/[^/]+\.md$/i.test(path)) return true
  if (/^sites\/[^/]+\/SKILL\.md$/i.test(path)) return true
  return false
})

const nextSkillHint = (id: string, files: string[]) => {
  if (id === 'site-learn') {
    return '这是总说明。本站步骤：read_agent_skill_file 读 files 里 sites/<主网站域名>/SKILL.md。步骤写法见 references/workflow.md。'
  }
  if (id === 'site-graph') {
    return '操作表：read_agent_skill_file(site-graph, references/edit.md)。用 browser_site_graph 一条条改。'
  }
  if (id === 'skill-edit') {
    return '写文件细则：read_agent_skill_file(skill-edit, references/edit.md)。'
  }
  if (id === 'chaoxing') {
    return '按任务读 files 里 references/login.md、study.md 或 homework.md。'
  }
  if (files.some((file) => file === 'references/workflow.md')) {
    return '细则：read_agent_skill_file 读 references/workflow.md。'
  }
  if (files.length) return '附属文件用 read_agent_skill_file 读。编辑也用它读原文再写回。'
  return undefined
}

export const nextSkillFileHint = (id: string, path: string, files: string[]) => {
  if (path === SKILL_MAIN_FILE) return nextSkillHint(id, files)
  const site = path.match(/^sites\/([^/]+)\/SKILL\.md$/)
  if (id === 'site-learn' && site) {
    const host = site[1]
    return [
      `本站步骤写在 sites/${host}/SKILL.md。`,
      '在当前网页验证步骤，再记录已验证的操作经验。',
      '播放页同一节常有多条视频，当前条只是其中一条。走通后把点了哪个字写回 SKILL.md。',
    ].filter(Boolean).join('')
  }
  if (id === 'site-learn' && path === 'references/workflow.md') {
    return '本站步骤：sites/<主网站域名>/SKILL.md。写哪一页、点哪个字、在哪个框、坑在哪。'
  }
  if (id === 'chaoxing' && /^references\//.test(path)) {
    return '按当前页【建议】做。结构变化时通过快照重新观察，走通后更新本站 SKILL.md。'
  }
  return undefined
}

const PARSER_PATH = /(?:^|\/)parsers\/|(?:see|schema|locators)(?:\.[\w-]+)?\.json$/

/** 新站文件在 sites/<主网站域名>/SKILL.md。解析器路径一律改去写经验。 */
export const placeSiteLearnPath = (relativePath: string, host: string) => {
  const path = resolveWebsiteSkillTarget('site-learn', relativePath).path
  if (PARSER_PATH.test(path)) {
    const where = host ? `sites/${host}/SKILL.md` : 'sites/<主网站域名>/SKILL.md'
    return {
      path,
      error: `不要写解析器。把步骤写进 ${where}：哪一页、点哪个字、在哪个框、坑在哪。`,
    }
  }
  if (!isBuiltinRuntimeSkillFile(path)) return { path, error: WEBSITE_RUNTIME_FILE_HINT }
  return { path }
}

export const readAgentSkillContent = async (id: string) => {
  const item = skillItemOf(id)
  if (!item || !item.enabled) return null
  const block = await getSkillPromptBlock(item)
  if (!block) return null
  const files = await listSkillFiles(id)
  const surface = skillSurfaceFiles(files)
  const parsed = parseSkillFrontmatter((await readSkillMarkdownRaw(id)) || '')
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    compatibility: parsed.compatibility || undefined,
    // Informational only; this does not grant tool permissions.
    allowedTools: parsed.allowedTools || undefined,
    content: `${block.triggerHint}${block.prompt}`.trim(),
    files: surface,
    hint: nextSkillHint(id, files),
  }
}

export const readAgentSkillFileContent = async (id: string, relativePath: string) => {
  const target = resolveWebsiteSkillTarget(id, relativePath)
  id = target.skillId
  relativePath = target.path
  const item = skillItemOf(id)
  if (!item) return null
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) return null
  // Website creation needs a definitive absence check. Directory enumeration and
  // optional overrides deliberately tolerate errors elsewhere; neither can be
  // used as proof that an existing site's original text is safe to replace.
  if (id === 'site-learn' && /^sites\/[^/]+\/SKILL\.md$/.test(path)) {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    let content: string | null
    try {
      content = await readTextFile(`${skillOverrideDir(id)}/${path}`, { baseDir: BaseDirectory.Home })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/ENOENT|No such file or directory|not found|os error 2\b/i.test(message)) throw error
      content = readBuiltinSkillFileRaw(id, path)
    }
    return content == null ? null : { id, path, content, hint: nextSkillFileHint(id, path, [path]) }
  }
  const files = await listSkillFiles(id)
  if (!files.includes(path)) return null
  let content: string | null = null
  if (path === SKILL_MAIN_FILE) {
    content = await readSkillMarkdownRaw(id)
  } else if (item.builtin) {
    content = await readOverrideSkillFile(id, path)
    if (content == null) content = readBuiltinSkillFileRaw(id, path)
  } else {
    content = await readInstalledSkillFile(id, path)
  }
  if (content == null) return null
  return { id: item.id, path, content, hint: nextSkillFileHint(id, path, files) }
}

export const listAgentSkillsForAgent = async () => {
  const items = agentSkillsState.items.length ? agentSkillsState.items : fallbackBuiltinItems()
  const skills = []
  for (const item of items) {
    skills.push({
      id: item.id,
      name: item.name,
      description: item.description,
      enabled: item.enabled,
      builtin: item.builtin,
      scope: item.scope,
      customized: Boolean(item.customized),
      editable: isSkillEditable(item.id),
      files: skillSurfaceFiles(await listSkillFiles(item.id)),
    })
  }
  return { skills }
}

export const writeAgentSkillFileContent = async (id: string, relativePath: string, content: string) => {
  const item = skillItemOf(id)
  if (!item) return { error: `Skill "${id}" 不存在` }
  if (!isSkillEditable(id)) return { error: '此内置 Skill 为只读，不能修改' }
  const target = resolveWebsiteSkillTarget(id, relativePath)
  id = target.skillId
  relativePath = target.path
  const writeError = skillFileWriteError(id, relativePath)
  if (writeError) return { error: writeError }
  const path = normalizeSkillRelativePath(relativePath)
  if (!path) return { error: '无效的文件路径' }
  const { siteGraphWriteBlocked } = await import('../browser/siteGraphSave')
  const graphBlocked = siteGraphWriteBlocked(path)
  if (graphBlocked) return { ok: false, error: graphBlocked }
  if (isParserScriptPath(path) || PARSER_PATH.test(path)) {
    return { error: '不要写解析器。把步骤写进 sites/<主网站域名>/SKILL.md。' }
  }
  const text = String(content ?? '')
  if (new TextEncoder().encode(text).length > MAX_SKILL_FILE_BYTES) {
    return { error: `文件超过 ${MAX_SKILL_FILE_BYTES} 字节` }
  }
  try {
    await saveSkillFileContent(id, path, text)
    const files = await listSkillFiles(id)
    return {
      ok: true,
      id,
      path,
      hint: '已写入。图谱会热加载。站点步骤写在 SKILL.md。',
      files,
    }
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : (error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '')
    return { error: message || '写入失败' }
  }
}

export const resetAgentSkillFile = async (id: string, relativePath?: string) => {
  const item = skillItemOf(id)
  if (!item) return { error: `Skill "${id}" 不存在` }
  if (!item.builtin) return { error: '只有内置 Skill 能恢复默认' }
  if (!isSkillEditable(id)) return { error: '此内置 Skill 为只读，不能恢复' }
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE) || SKILL_MAIN_FILE
  try {
    await resetSkillFileContent(id, path)
    const file = await readAgentSkillFileContent(id, path)
    return {
      ok: true,
      id,
      path,
      content: file?.content || '',
      hint: '已恢复为内置默认',
      files: await listSkillFiles(id),
    }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : ''
    return { error: message || '恢复失败' }
  }
}

export const getSkillDocument = async (id: string, siteHost?: string): Promise<SkillDocument | null> => {
  const item = skillItemOf(id)
  const scoped = id === 'site-learn' && Boolean(siteHost && normalizeWebsiteHost(siteHost) === siteHost)
  if (!item || (siteHost && !scoped) || (!scoped && !isSkillVisibleInSettings(id))) return null
  const prefix = scoped ? `sites/${siteHost}/` : ''
  const mainPath = scoped ? `${prefix}SKILL.md` : SKILL_MAIN_FILE
  const markdown = scoped ? (await getSkillFileContent(id, mainPath))?.content : await readSkillMarkdownRaw(id)
  if (!markdown) return null
  const parsed = parseSkillFrontmatter(markdown)
  const customized = item.builtin ? (scoped
    ? (await walkSkillDir(skillOverrideDir(id))).some(path => path.startsWith(prefix) && isBuiltinRuntimeSkillFile(path))
    : await hasSkillOverride(id)) : true
  const files = (await listSkillFiles(id)).filter(path => !scoped || path.startsWith(prefix))
  return {
    id: item.id,
    name: parsed.displayName || item.name,
    description: parsed.description || item.description,
    markdown,
    builtin: item.builtin && (!scoped || Boolean(readBundledSkillFile(id, mainPath))),
    customized,
    source: item.source,
    sourcePath: item.sourcePath,
    files,
  }
}

export const getSkillFileContent = async (id: string, relativePath: string): Promise<SkillFileContent | null> => {
  const item = skillItemOf(id)
  if (!item) return null
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE)
  if (!path) return null
  const files = await listSkillFiles(id)
  if (!files.includes(path)) return null
  let content = ''
  if (path === SKILL_MAIN_FILE) {
    content = (await readSkillMarkdownRaw(id)) || ''
  } else if (item.builtin) {
    content = (await readOverrideSkillFile(id, path)) || readBuiltinSkillFileRaw(id, path) || ''
  } else {
    content = (await readInstalledSkillFile(id, path)) || ''
  }
  return {
    id: item.id,
    path,
    content,
    readonly: !isSkillEditable(id),
  }
}

export const saveSkillFileContent = async (id: string, relativePath: string, content: string) => {
  const item = skillItemOf(id)
  if (!item) throw new Error('Skill 不存在')
  assertSkillEditable(id)
  const target = resolveWebsiteSkillTarget(id, relativePath)
  id = target.skillId
  relativePath = target.path
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE)
  if (!path) throw new Error('无效的文件路径')
  const writeError = skillFileWriteError(id, relativePath || SKILL_MAIN_FILE)
  if (writeError) throw new Error(writeError)
  if (isParserScriptPath(path)) throw new Error('不要写解析脚本。把步骤写进 sites/<主网站域名>/SKILL.md。')
  const text = String(await redactNative(redactObject(String(content ?? ''))))
  if (!text.trim() && path === SKILL_MAIN_FILE) throw new Error('Skill 内容不能为空')

  promptCache.delete(id)
  if (path === SKILL_MAIN_FILE) {
    await saveSkillDocument(id, text)
    return
  }
  if (item.builtin) {
    await writeOverrideSkillFile(id, path, text.endsWith('\n') ? text : `${text}\n`)
  } else {
    await writeInstalledSkillFile(id, path, text.endsWith('\n') ? text : `${text}\n`)
    const meta = await readSkillMeta(id)
    if (meta) {
      const now = Date.now()
      await writeInstalledSkillMeta(id, { ...meta, updatedAt: now })
      const config = { ...memoryConfig, skills: { ...memoryConfig.skills } }
      config.skills[id] = { ...config.skills[id], updatedAt: now }
      memoryConfig = config
      writeLocal(memoryConfig)
      persistFile(memoryConfig)
    }
  }
  await syncState()
  try {
    const {
      applyChaoxingImplContent,
      applyLearnedSiteGraphContent,
      isChaoxingImplPath,
      isLearnedParserPath,
      isLearnedSiteGraphPath,
      reloadChaoxingImpl,
      SITE_GRAPH_PATH,
    } = await import('./skillRuntime')
    const parserTouched = (id === 'site-learn' && (isLearnedSiteGraphPath(path) || isLearnedParserPath(path)))
      || (id === 'chaoxing' && (path === SITE_GRAPH_PATH || isChaoxingImplPath(path)))
    if (id === 'site-learn' && isLearnedSiteGraphPath(path)) applyLearnedSiteGraphContent(text)
    else if (id === 'site-learn' && isLearnedParserPath(path)) {
      const { reloadLearnedSiteGraphs } = await import('./skillRuntime')
      await reloadLearnedSiteGraphs()
    }
    else if (id === 'chaoxing' && path === SITE_GRAPH_PATH) applyChaoxingImplContent(path, text)
    else if (id === 'chaoxing' && isChaoxingImplPath(path)) await reloadChaoxingImpl(path)
    void parserTouched
  } catch (error) {
    console.warn('[site skill] 热加载失败', error)
  }
}

export const saveSkillDocument = async (id: string, markdown: string) => {
  const item = skillItemOf(id)
  if (!item) throw new Error('Skill 不存在')
  assertSkillEditable(id)
  const raw = String(markdown || '')
  if (!raw.trim()) throw new Error('Skill 内容不能为空')
  const content = prepareSkillMarkdown(raw, id, item)

  const parsed = parseSkillFrontmatter(content)
  promptCache.delete(id)

  if (item.builtin) {
    await writeSkillOverride(id, content.endsWith('\n') ? content : `${content}\n`)
  } else {
    const meta = await readSkillMeta(id)
    if (!meta) throw new Error('Skill 元数据缺失')
    const now = Date.now()
    const nextMeta: SkillMetaFile = {
      ...meta,
      name: parsed.displayName || meta.name,
      description: parsed.description || meta.description,
      updatedAt: now,
    }
    await writeInstalledSkillFile(id, SKILL_MAIN_FILE, content.endsWith('\n') ? content : `${content}\n`)
    await writeInstalledSkillMeta(id, nextMeta)
  }

  const config = { ...memoryConfig, skills: { ...memoryConfig.skills } }
  config.skills[id] = {
    ...config.skills[id],
    updatedAt: Date.now(),
  }
  memoryConfig = config
  writeLocal(memoryConfig)
  persistFile(memoryConfig)
  await syncState()
}

export const resetSkillDocument = async (id: string) => {
  const item = skillItemOf(id)
  if (!item?.builtin) return
  assertSkillEditable(id)
  await removeSkillOverride(id)
  promptCache.delete(id)
  await syncState()
  if (id === 'chaoxing') {
    const { reloadChaoxingImpl } = await import('./skillRuntime')
    await reloadChaoxingImpl()
  }
}

export const resetSkillFileContent = async (id: string, relativePath: string) => {
  const item = skillItemOf(id)
  if (!item?.builtin) return
  assertSkillEditable(id)
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE)
  if (!path) throw new Error('无效的文件路径')
  const writeError = skillFileWriteError(id, relativePath || SKILL_MAIN_FILE)
  if (writeError) throw new Error(writeError)
  promptCache.delete(id)
  if (path === SKILL_MAIN_FILE) {
    await resetSkillDocument(id)
    return
  }
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${skillOverrideDir(id)}/${path}`, { baseDir: BaseDirectory.Home })
  } catch {
    // ignore
  }
  await syncState()
  if (id === 'chaoxing') {
    const { reloadChaoxingImpl } = await import('./skillRuntime')
    await reloadChaoxingImpl(path)
  }
}

/** @deprecated 使用 getEnabledSkillCatalog + getSkillPromptBlocksByIds */
export const getEnabledSkillPromptBlocks = async () => {
  const enabled = getEnabledSkillItems()
  const blocks: { triggerHint: string; prompt: string }[] = []
  for (const item of enabled) {
    const block = await getSkillPromptBlock(item)
    if (block) blocks.push(block)
  }
  return blocks
}

const httpFetch = async (url: string) => {
  try {
    const { fetch } = await import('@tauri-apps/plugin-http')
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) throw new Error(`${res.status}`)
    return await res.text()
  } catch {
    const res = await globalThis.fetch(url)
    if (!res.ok) throw new Error(`${res.status}`)
    return await res.text()
  }
}

const httpFetchJson = async <T,>(url: string): Promise<T> => {
  const text = await httpFetch(url)
  return JSON.parse(text) as T
}

type GitHubContentEntry = {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
}

const parseGitHubInput = (input: string) => {
  const raw = String(input || '').trim()
  if (!raw) return null

  const urlMatch = raw.match(/github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/[^/]+\/(.+))?/i)
  if (urlMatch) {
    const owner = urlMatch[1]
    const repo = urlMatch[2].replace(/\.git$/i, '')
    const subPath = urlMatch[3]?.replace(/\/SKILL\.md$/i, '') || ''
    if (subPath) {
      const parts = subPath.split('/').filter(Boolean)
      const skillName = parts[parts.length - 1]
      const base = parts.slice(0, -1).join('/')
      return { owner, repo, skillName, basePath: base || '.agents/skills' }
    }
    return { owner, repo, skillName: '', basePath: '.agents/skills' }
  }

  const slash = raw.replace(/^github:/i, '').split('/').filter(Boolean)
  if (slash.length >= 2) {
    const owner = slash[0]
    const repo = slash[1].replace(/\.git$/i, '')
    if (slash.length >= 3) {
      return { owner, repo, skillName: slash[slash.length - 1], basePath: slash.slice(2, -1).join('/') || '.agents/skills' }
    }
    return { owner, repo, skillName: '', basePath: '.agents/skills' }
  }
  return null
}

const resolveSkillRoots = async (owner: string, repo: string, basePath: string) => {
  const candidates = [basePath, '.agents/skills', '.claude/skills', 'skills'].filter((value, index, arr) => value && arr.indexOf(value) === index)
  for (const candidate of candidates) {
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${candidate}`
      const entries = await httpFetchJson<GitHubContentEntry[]>(url)
      if (Array.isArray(entries) && entries.length) {
        return { root: candidate, entries: entries.filter((entry) => entry.type === 'dir') }
      }
    } catch {
      // try next
    }
  }
  return { root: basePath, entries: [] as GitHubContentEntry[] }
}

const writeInstalledSkillMeta = async (id: string, meta: SkillMetaFile) => {
  const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const dir = getInstalledSkillDir(id)
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true })
  await writeTextFile(`${dir}/${SKILL_META_FILE}`, JSON.stringify(meta, null, 2), { baseDir: BaseDirectory.Home })
}

const writeInstalledSkill = async (payload: {
  id: string
  files: Array<{ relativePath: string; content: string }>
  meta: SkillMetaFile
}) => {
  const { writeTextFile, mkdir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const dir = getInstalledSkillDir(payload.id)
  await remove(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true })
  for (const file of payload.files) {
    const path = normalizeSkillRelativePath(file.relativePath)
    if (!path || path === SKILL_META_FILE) continue
    const full = `${dir}/${path}`
    const parent = full.split('/').slice(0, -1).join('/')
    if (parent !== dir) await mkdir(parent, { baseDir: BaseDirectory.Home, recursive: true })
    await writeTextFile(full, file.content, { baseDir: BaseDirectory.Home })
  }
  await writeInstalledSkillMeta(payload.id, payload.meta)
  promptCache.delete(payload.id)
}

const listGitHubContentsRecursive = async (
  owner: string,
  repo: string,
  dirPath: string,
): Promise<GitHubContentEntry[]> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`
  let entries: GitHubContentEntry[]
  try {
    entries = await httpFetchJson<GitHubContentEntry[]>(url)
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  const files: GitHubContentEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'file') files.push(entry)
    else if (entry.type === 'dir') {
      files.push(...await listGitHubContentsRecursive(owner, repo, entry.path))
    }
  }
  return files
}

const installOneSkillFromRepo = async (
  owner: string,
  repo: string,
  root: string,
  skillDirName: string,
) => {
  const remotePrefix = `${root}/${skillDirName}`.replace(/\/+/g, '/')
  const remoteFiles = await listGitHubContentsRecursive(owner, repo, remotePrefix)
  if (!remoteFiles.length) throw new Error(`目录 ${skillDirName} 为空`)

  const prefix = `${remotePrefix}/`
  const downloaded: Array<{ relativePath: string; content: string }> = []
  let markdown = ''

  for (const entry of remoteFiles) {
    const relativePath = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.name
    if (!relativePath || relativePath === SKILL_META_FILE || !isTextSkillFile(relativePath)) continue
    const url = entry.download_url || `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${entry.path}`
    const content = await httpFetch(url)
    if (new TextEncoder().encode(content).length > MAX_SKILL_FILE_BYTES) throw new Error(`${relativePath} 超过文件大小限制`)
    downloaded.push({ relativePath, content })
    if (relativePath === SKILL_MAIN_FILE) markdown = content
  }

  if (!markdown) throw new Error(`${skillDirName} 缺少 SKILL.md`)

  const parsed = parseSkillFrontmatter(markdown)
  const errors = validateSkillMarkdown(markdown, skillDirName)
  if (errors.length) throw new Error(`${skillDirName}: ${errors.join('；')}`)
  const id = skillDirName
  if (BUILTIN_SKILLS[id]) throw new Error(`不能覆盖内置 Skill：${id}`)
  const existing = await readSkillMeta(id)
  if (existing && (existing.source !== `${owner}/${repo}` || existing.sourcePath !== remotePrefix)) {
    throw new Error(`Skill ID ${id} 已被其他来源使用`)
  }
  const now = Date.now()
  const meta: SkillMetaFile = {
    id,
    name: parsed.displayName || skillDirName,
    description: parsed.description || '',
    source: `${owner}/${repo}`,
    sourcePath: remotePrefix,
    installedAt: now,
    updatedAt: now,
  }
  await writeInstalledSkill({ id, files: downloaded, meta })
  const config = { ...memoryConfig, skills: { ...memoryConfig.skills } }
  config.skills[id] = {
    ...config.skills[id],
    enabled: config.skills[id]?.enabled ?? true,
    source: meta.source,
    sourcePath: meta.sourcePath,
    installedAt: now,
    updatedAt: now,
  }
  memoryConfig = config
  writeLocal(memoryConfig)
  persistFile(memoryConfig)
  return id
}

export const installSkillFromGitHub = async (input: string) => {
  agentSkillsState.installError = ''
  agentSkillsState.installing = true
  try {
    const parsed = parseGitHubInput(input)
    if (!parsed) throw new Error('请输入 owner/repo 或 GitHub 链接')

    const installed: string[] = []
    if (parsed.skillName) {
      const base = parsed.basePath.replace(/\/$/, '')
      const id = await installOneSkillFromRepo(parsed.owner, parsed.repo, base, parsed.skillName)
      installed.push(id)
    } else {
      const { root, entries } = await resolveSkillRoots(parsed.owner, parsed.repo, parsed.basePath)
      if (!entries.length) throw new Error('仓库里没找到 .agents/skills、.claude/skills 或 skills 目录')
      const failures: string[] = []
      for (const entry of entries) {
        try {
          const id = await installOneSkillFromRepo(parsed.owner, parsed.repo, root, entry.name)
          installed.push(id)
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `${entry.name} 安装失败`)
        }
      }
      if (!installed.length) throw new Error(failures.join('\n') || '未能安装任何 Skill，请检查仓库结构')
      agentSkillsState.installError = failures.join('\n')
    }
    await syncState()
    return installed
  } catch (error) {
    const message = error instanceof Error ? error.message : '安装失败'
    agentSkillsState.installError = message
    throw error
  } finally {
    agentSkillsState.installing = false
  }
}
