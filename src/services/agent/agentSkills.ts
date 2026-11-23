import { createSkillGitHubInstaller } from './skills/skillGitHubInstaller'
import { createSkillConfigStorage } from './skills/skillConfigStorage'
import { redactNative } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { reactive } from 'vue'
import { createSkillMarkdown, normalizeLegacySkillMarkdown, parseSkillFrontmatter, prepareSkillMarkdown } from './skillFormat'
import { normalizeWebsiteHost, websitePrimaryHost } from './websiteIdentity'
import { isBuiltinRuntimeSkillFile, WEBSITE_RUNTIME_FILE_HINT } from './skillRuntimeFiles'
import { resolveWebsiteSkillTarget } from './websiteSkillTarget'
import { ensureChaoxingRepository, listChaoxingRepositoryFiles, readChaoxingRepositoryFile,
  writeChaoxingRepositoryFile, websiteRepositoryState, onWebsiteRepositoryChanged, CHAOXING_REPOSITORY,
  websiteRepositoryHosts, listWebsiteRepositoryFiles, readWebsiteRepositoryFile, writeWebsiteRepositoryFile, writeWebsiteRepositorySupplement, repositoryForHost, websiteRepositoryStates, repositorySourceFor } from './websiteRepository'
import { WEBSITE_REPOSITORY_READ_ONLY, websiteRepositoryTarget, resolveWebsiteRepositoryTarget } from './websiteRepositoryTarget'
import { repositoryPath as isRepositoryPath } from './websiteRepositoryCore'
export { parseSkillFrontmatter } from './skillFormat'
import {
  listBundledSkillFiles,
  readBundledSkillFile,
} from './skills/builtinSkillAssets'
const isParserScriptPath = (path: string) => (
  /(?:^|\/)parsers\/[^/]+\/[^/]+\.js$/i.test(String(path || '').replace(/\\/g, '/'))
)
import { CHAOXING_SKILL_DESCRIPTION } from './skills/chaoxing'

import type { SkillScope, AgentSkillItem, SkillDocument, SkillFileContent, SkillConfigRow, SkillConfigFile, SkillMetaFile, BuiltinSkillDef, SkillCatalogEntry } from './skills/skillTypes'
export type { SkillScope, AgentSkillItem, SkillDocument, SkillFileContent, SkillCatalogEntry } from './skills/skillTypes'

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
    name: '网站经验',
    description: '查找和保存各网站的导航步骤、页面结构和本地快捷入口。站点文件位于 sites/<主网站域名>/SKILL.md。',
    triggerHint: '需要查找或记录快捷入口，或在网站中摸索及更新流程时，使用 site-learn。',
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

const { readLocal, writeLocal, persistFile, loadFile } = createSkillConfigStorage(migrateSkillConfig, config => { memoryConfig = config })

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

export const skillFileWriteError = (id: string, relativePath: string): string | null => {
  if (BUILTIN_SKILLS[id] && !isBuiltinRuntimeSkillFile(relativePath)) return WEBSITE_RUNTIME_FILE_HINT
  const path = normalizeSkillRelativePath(relativePath)
  if (path && websiteRepositoryTarget(id, path)?.path.startsWith('references/')) {
    return WEBSITE_REPOSITORY_READ_ONLY
  }
  return null
}

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
  if (id === 'chaoxing') { await ensureChaoxingRepository(); return websiteRepositoryState.changedPaths.length > 0 }
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
  if (id === 'chaoxing') return (await listChaoxingRepositoryFiles()).sort((a, b) => a === SKILL_MAIN_FILE ? -1 : b === SKILL_MAIN_FILE ? 1 : a.localeCompare(b, 'en'))
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
  if (id === 'site-learn') for (const host of await websiteRepositoryHosts()) {
    if (host === 'chaoxing.com') continue
    for (const path of files) if (path.startsWith(`sites/${host}/`)) files.delete(path)
    for (const path of await listWebsiteRepositoryFiles(host)) files.add(`sites/${host}/${path}`)
  }
  return [...files].filter((path) => !isParserScriptPath(path) && (!item.builtin || isBuiltinRuntimeSkillFile(path))
    && !(id === 'chaoxing' && path.startsWith('sites/'))
    && !(id === 'site-learn' && /^sites\/[^/]+\//.test(path) && path.split('/')[1] !== websitePrimaryHost(path.split('/')[1]))).sort((a, b) => {
    if (a === SKILL_MAIN_FILE) return -1
    if (b === SKILL_MAIN_FILE) return 1
    return a.localeCompare(b, 'en')
  })
}

const readStoredSkillMarkdown = async (id: string): Promise<string | null> => {
  if (id === 'chaoxing') return (await readChaoxingRepositoryFile(SKILL_MAIN_FILE)).content
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
  const hosts = await websiteRepositoryHosts().catch(() => [])
  for (const [id, def] of Object.entries(BUILTIN_SKILLS)) {
    if (id === 'chaoxing' && !hosts.includes('chaoxing.com')) continue
    const row = config.skills[id]
    const customized = await hasSkillOverride(id)
    let name = def.name
    let description = def.description
    const markdown = id === 'chaoxing' ? await readStoredSkillMarkdown(id) : (customized ? await readSkillOverride(id) : null) || readBundledSkillFile(id, SKILL_MAIN_FILE)
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
      ...(id === 'chaoxing' ? { source: CHAOXING_REPOSITORY.url, sourcePath: CHAOXING_REPOSITORY.root } : {}),
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
onWebsiteRepositoryChanged(() => { promptCache.delete('chaoxing'); void syncState().catch(() => undefined) })

memoryConfig = readLocal()
const skillLoadFailed = (error: unknown) => {
  agentSkillsState.items = fallbackBuiltinItems()
  agentSkillsState.ready = fileReady
  websiteRepositoryState.error = error instanceof Error ? error.message : '网站仓库缓存暂不可用'
}
void loadFile().then(async (file) => {
  fileReady = true
  memoryConfig = migrateSkillConfig({
    version: 1,
    skills: { ...memoryConfig.skills, ...file.skills },
  })
  writeLocal(memoryConfig)
  persistFile(memoryConfig)
  await syncState()
}).catch(skillLoadFailed)
void syncState().catch(skillLoadFailed)

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

export const getSkillPromptBlock = async (item: AgentSkillItem): Promise<{ triggerHint: string; prompt: string } | null> => {
  const builtin = BUILTIN_SKILLS[item.id]
  if (builtin) {
    const override = item.id === 'chaoxing' ? null : await readSkillOverride(item.id)
    const markdown = item.id === 'chaoxing' ? await readStoredSkillMarkdown(item.id) : override || readBundledSkillFile(item.id, SKILL_MAIN_FILE)
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

export const skillSurfaceFiles = (files: string[]) => files.filter((path) => {
  if (path === SKILL_MAIN_FILE) return true
  if (/^references\/[^/]+\.md$/i.test(path)) return true
  if (/^sites\/[^/]+\/SKILL\.md$/i.test(path)) return true
  return false
})

const nextSkillHint = (id: string, files: string[]) => {
  if (id === 'site-learn') {
    return '用 read_agent_skill_file 读取 sites/<主网站域名>/SKILL.md 中的本站步骤和本地快捷入口。记录方法见 references/workflow.md。'
  }
  if (id === 'site-graph') {
    return '操作表：read_agent_skill_file(site-graph, references/edit.md)。用 browser_site_graph 一条条改。'
  }
  if (id === 'skill-edit') {
    return '写文件细则：read_agent_skill_file(skill-edit, references/edit.md)。'
  }
  if (id === 'chaoxing') {
    return '按任务读 files 里的 references/login.md、study.md 或 homework.md。保存经验时先读取 SKILL.md 的 local_experience。'
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
    return `本站经验归入 sites/${host}/SKILL.md。在当前网页验证目标和操作；同节多条视频时当前条只是其中一条。按返回的编辑范围保存已验证的导航步骤和本地快捷入口。`
  }
  if (id === 'site-learn' && path === 'references/workflow.md') {
    return '导航步骤和快捷入口都按网站归档。读取 sites/<主网站域名>/SKILL.md 查看该站经验和编辑范围。'
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
  // 通用 Skill 不依赖任何网站仓库的加载或缓存状态。
  const repository = await resolveWebsiteRepositoryTarget(id, path)
  if (repository) {
    if (!isRepositoryPath(repository.path)) return null
    const file = await readWebsiteRepositoryFile(repository.host, repository.path)
    if (file.content == null) return null
    const main = repository.path === SKILL_MAIN_FILE
    const source = websiteRepositoryStates[repository.host]?.source
    const experienceSource = source === 'http' ? 'http' as const : source === 'offline' ? 'unavailable' as const : 'online' as const
    return { id, path, content: file.content, repository_version: file.version,
      experience_source: experienceSource,
      write_scope: main ? 'local_experience' as const : 'read_only' as const,
      local_experience: main ? file.supplement : undefined,
      hint: main
        ? 'content 用于查阅来源文件与本地补充。编辑时仅在 local_experience 中合并已验证的增量，将更新后的本地笔记作为 content 写回此路径，并把 repository_version 填入 base_version。来源正文、参考文件和图谱只读。'
        : WEBSITE_REPOSITORY_READ_ONLY }
  }
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
      if (!/ENOENT|No such file or directory|not found|os error [23]\b/i.test(message)) throw error
      content = readBuiltinSkillFileRaw(id, path)
    }
    return content == null ? null : { id, path, content, write_scope: 'website_files' as const, hint: nextSkillFileHint(id, path, [path]) }
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
  return { id: item.id, path, content,
    write_scope: id === 'site-learn' && path.startsWith('sites/') ? 'website_files' as const : undefined,
    hint: nextSkillFileHint(id, path, files) }
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

export const writeAgentSkillFileContent = async (id: string, relativePath: string, content: string, repositoryVersion?: string) => {
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
    const changed = await saveSkillFileContent(id, path, text, { repositoryVersion, agentWrite: true })
    if (changed === false) return { ok: true, id, path, unchanged: true, hint: '本地经验内容未变化。' }
    const files = await listSkillFiles(id)
    return {
      ok: true,
      id,
      path,
      hint: websiteRepositoryTarget(id, path) ? '已保存本站的「本地经验」。' : '已保存文件。',
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
  const target = resolveWebsiteSkillTarget(id, relativePath || SKILL_MAIN_FILE)
  id = target.skillId
  const item = skillItemOf(id)
  if (!item) return { error: `Skill "${id}" 不存在` }
  if (!item.builtin) return { error: '只有内置 Skill 能恢复默认' }
  if (!isSkillEditable(id)) return { error: '此内置 Skill 为只读，不能恢复' }
  const path = normalizeSkillRelativePath(target.path)
  if (!path) return { error: '无效的文件路径' }
  try {
    await resetSkillFileContent(id, path, { agentWrite: true })
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
    ? (websiteRepositoryTarget(id, mainPath) ? Boolean(websiteRepositoryStates[siteHost!]?.changedPaths.length) : (await walkSkillDir(skillOverrideDir(id))).some(path => path.startsWith(prefix) && isBuiltinRuntimeSkillFile(path)))
    : await hasSkillOverride(id)) : true
  const files = (await listSkillFiles(id)).filter(path => !scoped || path.startsWith(prefix))
  return {
    id: item.id,
    name: parsed.displayName || item.name,
    description: parsed.description || item.description,
    markdown,
    builtin: item.builtin && (!scoped || Boolean(readBundledSkillFile(id, mainPath))),
    customized,
    source: websiteRepositoryTarget(id, mainPath) ? repositorySourceFor(websiteRepositoryTarget(id, mainPath)!.host)?.url : item.source,
    sourcePath: websiteRepositoryTarget(id, mainPath) ? repositorySourceFor(websiteRepositoryTarget(id, mainPath)!.host)?.root : item.sourcePath,
    files,
  }
}

export const getSkillFileContent = async (id: string, relativePath: string): Promise<SkillFileContent | null> => {
  const item = skillItemOf(id)
  if (!item) return null
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE)
  if (!path) return null
  const repository = await resolveWebsiteRepositoryTarget(id, path)
  if (repository) {
    if (!isRepositoryPath(repository.path)) return null
    const file = await readWebsiteRepositoryFile(repository.host, repository.path)
    return file.content == null ? null : { id, path, content: file.content, readonly: false, repositoryVersion: file.version }
  }
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

export const saveSkillFileContent = async (id: string, relativePath: string, content: string, options?: { repositoryVersion?: string; agentWrite?: boolean }) => {
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
  const repository = await resolveWebsiteRepositoryTarget(id, path)
  if (repository && options?.agentWrite) {
    if (repository.path !== SKILL_MAIN_FILE) throw new Error(WEBSITE_REPOSITORY_READ_ONLY)
    if (!options.repositoryVersion) throw new Error('请先读取本站 SKILL.md，并将 repository_version 填入 base_version。')
    const changed = await writeWebsiteRepositorySupplement(repository.host, text, { version: options.repositoryVersion })
    promptCache.delete(id)
    if (changed) await syncState()
    return changed
  }
  if (!text.trim() && path === SKILL_MAIN_FILE) throw new Error('Skill 内容不能为空')
  if (repository && id !== 'chaoxing') {
    const changed = await writeWebsiteRepositoryFile(repository.host, repository.path, text.endsWith('\n') ? text : `${text}\n`, options?.repositoryVersion)
    promptCache.delete(id)
    await syncState()
    return changed
  }

  promptCache.delete(id)
  if (path === SKILL_MAIN_FILE) {
    return saveSkillDocument(id, text, options)
  }
  if (id === 'chaoxing') {
    const changed = await writeChaoxingRepositoryFile(path, text.endsWith('\n') ? text : `${text}\n`, options?.repositoryVersion)
    await syncState()
    return changed
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

export const saveSkillDocument = async (id: string, markdown: string, options?: { repositoryVersion?: string }) => {
  const item = skillItemOf(id)
  if (!item) throw new Error('Skill 不存在')
  assertSkillEditable(id)
  const raw = String(markdown || '')
  if (!raw.trim()) throw new Error('Skill 内容不能为空')
  const content = prepareSkillMarkdown(raw, id, item)

  const parsed = parseSkillFrontmatter(content)
  promptCache.delete(id)

  let changed: boolean | undefined
  if (id === 'chaoxing') {
    changed = await writeChaoxingRepositoryFile(SKILL_MAIN_FILE, content.endsWith('\n') ? content : `${content}\n`, options?.repositoryVersion)
  } else if (item.builtin) {
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
  return changed
}

export const resetSkillDocument = async (id: string) => {
  const item = skillItemOf(id)
  if (!item?.builtin) return
  assertSkillEditable(id)
  if (id === 'chaoxing') await repositoryForHost('chaoxing.com').reset()
  else await removeSkillOverride(id)
  promptCache.delete(id)
  await syncState()
  if (id === 'chaoxing') {
    const { reloadChaoxingImpl } = await import('./skillRuntime')
    await reloadChaoxingImpl()
  }
}

export const resetSkillFileContent = async (id: string, relativePath: string, options?: { agentWrite?: boolean }) => {
  const item = skillItemOf(id)
  if (!item?.builtin) return
  assertSkillEditable(id)
  const path = normalizeSkillRelativePath(relativePath || SKILL_MAIN_FILE)
  if (!path) throw new Error('无效的文件路径')
  const writeError = skillFileWriteError(id, relativePath || SKILL_MAIN_FILE)
  if (writeError) throw new Error(writeError)
  const repository = await resolveWebsiteRepositoryTarget(id, path)
  if (repository && options?.agentWrite) throw new Error(WEBSITE_REPOSITORY_READ_ONLY)
  if (repository && id !== 'chaoxing') {
    await repositoryForHost(repository.host).reset(repository.path)
    await syncState()
    return
  }
  promptCache.delete(id)
  if (path === SKILL_MAIN_FILE) {
    await resetSkillDocument(id)
    return
  }
  if (id === 'chaoxing') {
    await repositoryForHost('chaoxing.com').reset(path)
    await syncState()
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

const { installSkillFromGitHub, writeInstalledSkillMeta } = createSkillGitHubInstaller({
  state: agentSkillsState, getConfig: () => memoryConfig,
  persist: config => { memoryConfig = config; writeLocal(config); persistFile(config) },
  readSkillMeta, isBuiltin: id => Boolean(BUILTIN_SKILLS[id]),
  invalidatePrompt: id => promptCache.delete(id), refresh: syncState,
})

export { installSkillFromGitHub }
