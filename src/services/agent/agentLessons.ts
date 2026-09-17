import { hostnameOf } from '../browser/appBrowser'

export type AgentLesson = {
  id: string
  host: string
  tool: string
  error: string
  count: number
  at: number
}

const STORAGE_KEY = 'zerror-agent-lessons'
const CONFIG_FILE = 'agent-lessons.json'
const MAX_LESSONS = 40

let lessons: AgentLesson[] = []

const hostOf = (url?: string) => {
  const host = hostnameOf(String(url || '')).replace(/^www\./i, '').toLowerCase()
  return host || ''
}

const clipError = (raw: unknown) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120)

const asLesson = (raw: unknown): AgentLesson | null => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const host = String(row.host || '').trim()
  const tool = String(row.tool || '').trim()
  const error = clipError(row.error)
  if (!host || !tool || !error) return null
  return {
    id: String(row.id || `${host}:${tool}:${error}`).slice(0, 160),
    host,
    tool,
    error,
    count: Math.max(1, Number(row.count) || 1),
    at: Number(row.at) || Date.now(),
  }
}

const persist = (next: AgentLesson[]) => {
  lessons = next.slice(-MAX_LESSONS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons))
  } catch {
    // quota
  }
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(lessons), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  if (Array.isArray(stored)) lessons = stored.map(asLesson).filter((item): item is AgentLesson => Boolean(item))
} catch {
  lessons = []
}

void import('@tauri-apps/plugin-fs').then(async ({ readTextFile, BaseDirectory }) => {
  try {
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    }))
    if (!Array.isArray(raw)) return
    const fromFile = raw.map(asLesson).filter((item): item is AgentLesson => Boolean(item))
    if (fromFile.length) persist(fromFile)
  } catch {
    if (lessons.length) persist(lessons)
  }
}).catch(() => undefined)

const isFailure = (body: Record<string, unknown>) => {
  if (body.ok === false) return true
  const error = clipError(body.error)
  return Boolean(error) && body.ok !== true
}

export const noteBrowserToolResult = (url: string, tool: string, raw: string) => {
  const name = String(tool || '').trim()
  if (!name.startsWith('browser_') || name === 'browser_todo' || name === 'browser_wait' || name === 'browser_finish') {
    return
  }
  let body: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch {
    return
  }
  if (!isFailure(body)) return
  const host = hostOf(url || String(body.url || ''))
  const error = clipError(body.error) || clipError(body.hint) || '失败'
  if (!host || host === '导航' || !host.includes('.') || error.length < 4) return
  const id = `${host}:${name}:${error}`
  const prev = lessons.find((item) => item.id === id)
  const next: AgentLesson = prev
    ? { ...prev, count: prev.count + 1, at: Date.now() }
    : { id, host, tool: name, error, count: 1, at: Date.now() }
  persist([...lessons.filter((item) => item.id !== id), next])
}

export const lessonsForUrl = (url: string) => {
  const host = hostOf(url)
  if (!host) return [] as AgentLesson[]
  return lessons
    .filter((item) => item.host === host && item.count >= 2)
    .sort((left, right) => right.at - left.at)
    .slice(0, 5)
}

export const formatLessonsNudge = (url: string) => {
  const rows = lessonsForUrl(url)
  if (!rows.length) return ''
  const lines = rows.map((item) => `- ${item.tool}：${item.error}（${item.count} 次）。不要再用同一参数重试，先 get_page / screenshot 看 iframe 或改步骤。`)
  return `【教训】这个站已经错过：\n${lines.join('\n')}`
}
