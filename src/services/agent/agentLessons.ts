import { hostnameOf } from '../browser/appBrowser'
import { siteGraphNodeForUrl } from '../browser/siteGraphCore'
import { failFingerprint } from './failGate'

export type AgentLesson = {
  id: string
  host: string
  tool: string
  error: string
  count: number
  at: number
  ok?: boolean
  handle?: string
  fingerprint?: string
  url?: string
  node?: string
  frame?: string
  result?: string
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

const handleOf = (body: Record<string, unknown>) => {
  const raw = body.handle
  if (!raw || typeof raw !== 'object') return ''
  const row = raw as Record<string, unknown>
  const kind = String(row.kind || '').trim()
  const title = String(row.title || row.label || row.name || '').trim()
  if (!kind) return ''
  return title ? `${kind}:${title}` : kind
}

const asLesson = (raw: unknown): AgentLesson | null => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const host = String(row.host || '').trim()
  const tool = String(row.tool || '').trim()
  const error = clipError(row.error)
  const ok = row.ok === true
  if (!host || !tool) return null
  if (!ok && !error) return null
  return {
    id: String(row.id || `${ok ? 'ok' : 'err'}:${host}:${tool}:${error || row.handle || ''}`).slice(0, 160),
    host,
    tool,
    error,
    count: Math.max(1, Number(row.count) || 1),
    at: Number(row.at) || Date.now(),
    ok,
    handle: row.handle == null ? undefined : String(row.handle),
    fingerprint: row.fingerprint == null ? undefined : String(row.fingerprint),
    url: row.url == null ? undefined : String(row.url),
    node: row.node == null ? undefined : String(row.node),
    frame: row.frame == null ? undefined : String(row.frame),
    result: row.result == null ? undefined : String(row.result),
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

const noteRow = (row: AgentLesson) => {
  const prev = lessons.find((item) => item.id === row.id)
  const next: AgentLesson = prev
    ? { ...prev, count: prev.count + 1, at: Date.now() }
    : row
  persist([...lessons.filter((item) => item.id !== row.id), next])
}

export const noteBrowserToolResult = (
  url: string,
  tool: string,
  raw: string,
  args: Record<string, unknown> = {},
) => {
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
  const host = hostOf(url || String(body.url || ''))
  if (!host || host === '导航' || !host.includes('.')) return
  const fingerprint = failFingerprint(name, { ...args, ...body })
  const pageUrl = String(url || body.url || '')
  if (isFailure(body)) {
    const error = clipError(body.error) || clipError(body.hint) || '失败'
    if (error.length < 4) return
    noteRow({
      id: `err:${fingerprint || `${host}:${name}:${error}`}`.slice(0, 160),
      host,
      tool: name,
      error,
      count: 1,
      at: Date.now(),
      ok: false,
      fingerprint,
      url: pageUrl || undefined,
    })
    return
  }
  const acted = name === 'browser_click' || name === 'browser_click_text' || name === 'browser_type' || name === 'browser_navigate'
  if (!acted) return
  const nextUrl = String(body.url || '')
  const changed = name === 'browser_navigate' || body.navigated === true || (nextUrl && nextUrl !== pageUrl)
  if (!changed) return
  const node = siteGraphNodeForUrl(nextUrl || pageUrl)?.id || ''
  const text = String(args.text || args.ref || body.text || body.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const frame = String(args.frame || body.frame || '').trim().slice(0, 80)
  const result = String(nextUrl || body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  noteRow({
    id: `ok:${host}:${node}:${name}:${text || fingerprint}`.slice(0, 160),
    host,
    tool: name,
    error: '',
    count: 1,
    at: Date.now(),
    ok: true,
    handle: text || undefined,
    fingerprint,
    url: pageUrl || undefined,
    node: node || undefined,
    frame: frame || undefined,
    result: result || undefined,
  })
}

/** 已经不会再犯的错不进【教训】：工具名当时不存在（后来加了别名）、参数写坏（宿主现在会修）。 */
const STALE_LESSON = /未知浏览器工具|缺少 handle/

export const lessonsForUrl = (url: string) => {
  const host = hostOf(url)
  if (!host) return [] as AgentLesson[]
  return lessons
    .filter((item) => item.host === host && item.ok !== true && item.count >= 2 && !STALE_LESSON.test(item.error))
    .sort((left, right) => right.at - left.at)
    .slice(0, 5)
}

/** 每条教训后面接的「下一步」按工具给，不要一句「换参数」套所有工具。 */
const nextStepFor = (tool: string) => {
  if (tool === 'browser_eval' || tool === 'browser_click' || tool === 'browser_click_text') {
    return '快照里目标还在就用 ref 点。点中后把这一步写进站点 SKILL.md。播起来之后 browser_watch。'
  }
  if (tool === 'browser_get_page') return '快照里的 ref 用来点。点中后写入站点 SKILL.md。'
  return '换办法，或 screenshot 看页。'
}

/** 只留错误的第一句：后面的旧建议可能已经过时。 */
const headlineOf = (error: string) => {
  const text = String(error || '').trim()
  const cut = text.search(/[。；;]/)
  return cut > 0 ? text.slice(0, cut) : text
}

export const winsForUrl = (url: string) => {
  const host = hostOf(url)
  if (!host) return [] as AgentLesson[]
  const node = siteGraphNodeForUrl(url)?.id || ''
  return lessons
    .filter((item) => item.host === host && item.ok === true && (!node || !item.node || item.node === node))
    .sort((left, right) => right.at - left.at)
    .slice(0, 4)
}

export const formatLessonsNudge = (url: string) => {
  const fails = lessonsForUrl(url)
  const wins = winsForUrl(url)
  const bits: string[] = []
  if (fails.length) {
    const lines = fails.map((item) => `- ${item.tool}：${headlineOf(item.error)}（${item.count} 次）。下一步：${nextStepFor(item.tool)}`)
    bits.push(`【教训】这个站已经错过：\n${lines.join('\n')}`)
  }
  if (wins.length) {
    const lines = wins.map((item) => {
      const where = item.node ? `${item.node} ` : ''
      const frame = item.frame ? ` 框=${item.frame}` : ''
      const landed = item.result ? ` → ${item.result}` : ''
      return `- ${where}${item.tool}${item.handle ? `「${item.handle}」` : ''}${frame}${landed}`
    })
    bits.push(`【做过】上次在这一页：\n${lines.join('\n')}`)
  }
  return bits.join('\n')
}
