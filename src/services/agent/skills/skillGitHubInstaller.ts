import { parseSkillFrontmatter, validateSkillMarkdown } from '../skillFormat'
import type { SkillConfigFile, SkillMetaFile } from './skillTypes'
const SKILLS_DIR = '.local/share/zerror/skills'
const SKILL_MAIN_FILE = 'SKILL.md'
const SKILL_META_FILE = 'meta.json'
const MAX_SKILL_FILE_BYTES = 512 * 1024

const TEXT_SKILL_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.sh', '.bash',
  '.py', '.js', '.ts', '.mjs', '.cjs', '.css', '.html', '.xml', '.toml', '.ini', '.csv',
])


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


/** Downloads and installs files; the caller owns reactive catalog and config state. */
export function createSkillGitHubInstaller(deps: {
  state: { installError: string; installing: boolean }
  getConfig: () => SkillConfigFile; persist: (config: SkillConfigFile) => void
  readSkillMeta: (id: string) => Promise<SkillMetaFile | null>
  isBuiltin: (id: string) => boolean; invalidatePrompt: (id: string) => void
  refresh: () => Promise<void>
}) {
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
  const dir = `${SKILLS_DIR}/${id}`
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true })
  await writeTextFile(`${dir}/${SKILL_META_FILE}`, JSON.stringify(meta, null, 2), { baseDir: BaseDirectory.Home })
}

const writeInstalledSkill = async (payload: {
  id: string
  files: Array<{ relativePath: string; content: string }>
  meta: SkillMetaFile
}) => {
  const { writeTextFile, mkdir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const dir = `${SKILLS_DIR}/${payload.id}`
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
  deps.invalidatePrompt(payload.id)
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
  if (deps.isBuiltin(id)) throw new Error(`不能覆盖内置 Skill：${id}`)
  const existing = await deps.readSkillMeta(id)
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
  const current = deps.getConfig()
  const config = { ...current, skills: { ...current.skills } }
  config.skills[id] = {
    ...config.skills[id],
    enabled: config.skills[id]?.enabled ?? true,
    source: meta.source,
    sourcePath: meta.sourcePath,
    installedAt: now,
    updatedAt: now,
  }
  deps.persist(config)
  return id
}

const installSkillFromGitHub = async (input: string) => {
  deps.state.installError = ''
  deps.state.installing = true
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
      deps.state.installError = failures.join('\n')
    }
    await deps.refresh()
    return installed
  } catch (error) {
    const message = error instanceof Error ? error.message : '安装失败'
    deps.state.installError = message
    throw error
  } finally {
    deps.state.installing = false
  }
}

return { installSkillFromGitHub, writeInstalledSkillMeta }
}
