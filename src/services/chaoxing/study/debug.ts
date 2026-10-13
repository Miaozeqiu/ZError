import { writeDebugDump } from '../../agent/debugLog'
import { readCdpStats } from '../../browser/cdpStats'

export type StudyParserStep = {
  label?: string
  video?: boolean
  quiz?: boolean
  doc?: boolean
  jobDone?: boolean
  active?: boolean
  mid?: string
}

export type StudyParserLive = {
  ts: string
  via: string
  href?: string
  handle?: Record<string, unknown>
  locate?: Record<string, unknown>
  tick?: Record<string, unknown>
  steps?: StudyParserStep[]
  playing?: boolean
  error?: string
}

let last: StudyParserLive & { cdp?: string; store?: string } = {
  ts: '',
  via: '',
}

const storeRing: string[] = []

/** 面板侧状态写入者的最近几笔（谁改了 jobs / video），和页内 tick 分开看。 */
export const noteStudyStore = (line: string) => {
  const stamp = new Date().toISOString().slice(11, 23)
  storeRing.push(`${stamp} ${String(line || '')}`)
  while (storeRing.length > 8) storeRing.shift()
  last.store = storeRing.join('\n')
  write(last, false)
}

let lastWrite = 0
const TICK_MS = 800

const slim = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item == null || item === '') continue
    if (typeof item === 'function') continue
    if (key === 'el' || key === 'v') continue
    out[key] = item
  }
  return out
}

const slimSteps = (rows: unknown): StudyParserStep[] | undefined => {
  if (!Array.isArray(rows) || !rows.length) return undefined
  return rows.slice(0, 16).map((row) => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    return {
      label: String(item.label || item.step || ''),
      video: Boolean(item.video),
      quiz: Boolean(item.quiz),
      doc: Boolean(item.doc),
      jobDone: item.jobDone === true || item.done === true,
      active: Boolean(item.active),
      mid: item.mid ? String(item.mid) : undefined,
    }
  })
}

const formatLive = (snap: StudyParserLive) => {
  const tick = snap.tick || {}
  const loc = snap.locate || {}
  const handle = snap.handle || {}
  const clock = tick.current != null || tick.duration != null
    ? `${tick.current ?? '?'} / ${tick.duration ?? '?'}`
    : ''
  const lines = [
    `# 刷课解析器实时数据`,
    `ts: ${snap.ts}`,
    `via: ${snap.via}`,
    `href: ${snap.href || ''}`,
    `playing: ${snap.playing ?? ''}`,
    `error: ${snap.error || ''}`,
    last.cdp || '',
    '',
    `## Handle`,
    Object.keys(handle).length
      ? Object.entries(handle).map(([key, value]) => `${key}=${value}`).join('  ')
      : '（无）',
    '',
    `## Locate`,
    `found=${loc.found ?? ''}  already=${loc.already ?? ''}  via=${loc.via || ''}  x=${loc.x ?? ''}  y=${loc.y ?? ''}  text=${loc.text || loc.step || ''}  error=${loc.error || ''}`,
    '',
    `## Tick`,
    `hasVideo=${tick.hasVideo ?? ''}  paused=${tick.paused ?? ''}  ended=${tick.ended ?? ''}  jobDone=${tick.jobDone ?? ''}  ${clock}  src=${String(tick.src || '').slice(0, 80)}`,
    '',
    `## 监测（store）`,
    last.store || '（无）',
    '',
    `## 任务点`,
    ...(snap.steps?.length
      ? snap.steps.map((item, idx) => (
        `${idx + 1}. ${item.label || '?'}${item.video ? ' 视频' : ''}${item.quiz ? ' 测验' : ''}${item.doc ? ' 文档' : ''}${item.jobDone ? ' 已完成' : ' 未完成'}${item.active ? ' ·当前' : ''}${item.mid ? ` mid=${item.mid}` : ''}`
      ))
      : ['（还没读到）']),
    '',
  ]
  return lines.join('\n')
}

const write = (snap: StudyParserLive, force: boolean) => {
  const now = Date.now()
  if (!force && now - lastWrite < TICK_MS) return
  lastWrite = now
  writeDebugDump('cx-study-live', formatLive(snap), 'md')
  writeDebugDump('cx-study-latest', JSON.stringify(snap, null, 2), 'txt')
}

/** 解析器最近一次 locate / tick / 任务点。开发模式写入 logs/agent-chat/cx-study-live.md */
export const noteStudyParser = (patch: {
  via: string
  href?: string
  handle?: unknown
  locate?: unknown
  tick?: unknown
  steps?: unknown
  jobs?: unknown
  playing?: boolean
  error?: string
  force?: boolean
}) => {
  last = {
    ...last,
    ts: new Date().toISOString(),
    via: patch.via,
    href: patch.href ?? last.href,
    handle: slim(patch.handle) ?? last.handle,
    locate: slim(patch.locate) ?? last.locate,
    tick: slim(patch.tick) ?? last.tick,
    steps: slimSteps(patch.steps ?? patch.jobs) ?? last.steps,
    playing: patch.playing ?? last.playing,
    // 错误只属于产生它的那次事件。之后 jobs / tick 正常写入就清掉，
    // 不然启动时一句「CDP 尚未就绪」会一直挂在实时文件里误导排查。
    error: patch.error ?? (/error|lost/i.test(patch.via) ? last.error : ''),
  }
  const important = /play|pause|step|done|lost|error/i.test(patch.via)
  void readCdpStats().then((stats) => {
    last.cdp = stats.line
    write(last, Boolean(patch.force || important))
  }).catch(() => {
    write(last, Boolean(patch.force || important))
  })
}

export const lastStudyParser = () => last
