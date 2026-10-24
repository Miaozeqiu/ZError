import type { PageRef } from './refs'

export const PAGE_SNAP_FRESH_MS = 4000
export const SNAP_LINE_LIMIT = 80
const ACTION_SNAP_MS = 1500

export type CachedPageSnap = {
  at: number
  url: string
  title: string
  snapshot: string
  refs: PageRef[]
}

const snaps = new Map<string, CachedPageSnap>()
let genSeq = 0
const activeGen = new Map<string, number>()
const abandoned = new Set<string>()

const genKey = (id: string, gen: number) => `${id}:${gen}`

/** 快照编号变化不是页面内容变化。保留勾选、禁用、文字等实际状态的差异。 */
export const snapshotContentChanged = (before: string, after: string) => {
  const content = (text: string) => text.replace(/\s*\[ref=e\d+\]/g, '')
  return Boolean(before && after && content(before) !== content(after))
}

export const beginPageSnap = (id: string) => {
  const gen = ++genSeq
  activeGen.set(id, gen)
  return gen
}

export const abandonPageSnap = (id: string, gen: number) => {
  abandoned.add(genKey(id, gen))
}

export const pageSnapAbandoned = (id: string, gen: number) => abandoned.has(genKey(id, gen))

export const rememberPageSnap = (
  id: string,
  snap: Omit<CachedPageSnap, 'at'>,
  gen?: number,
) => {
  if (gen != null && (pageSnapAbandoned(id, gen) || activeGen.get(id) !== gen)) return false
  snaps.set(id, { ...snap, at: Date.now() })
  return true
}

export const cachedPageSnap = (id: string) => snaps.get(id) || null
export const invalidatePageSnap = (id: string) => {
  const gen = activeGen.get(id)
  if (gen != null) abandonPageSnap(id, gen)
  activeGen.delete(id)
  snaps.delete(id)
}

export const pageSnapAge = (id: string) => {
  const snap = snaps.get(id)
  if (!snap) return Number.POSITIVE_INFINITY
  return Date.now() - snap.at
}

const lineRank = (line: string) => {
  if (/^\s*- (video|audio) /.test(line)) return -1
  if (/^\s*#|^\s*- iframe\b/.test(line)) return 0
  if (/\btreeitem\b|\blistitem\b|\boption\b|\brow\b/.test(line)) return 1
  if (/\btextbox\b|\bsearchbox\b|\bcombobox\b/.test(line)) return 2
  if (/ICP|版权|联系我们|备案/.test(line)) return 9
  return 5
}

export const clipSnapshot = (text: string, limit = SNAP_LINE_LIMIT) => {
  const lines = String(text || '').split('\n').filter((line, index, all) => line || index < all.length - 1)
  const ranked = lines
    .map((line, index) => ({ line, index, rank: lineRank(line) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
  const ordered = ranked.map((item) => item.line)
  if (ordered.length <= limit) return { text: ordered.join('\n'), truncated: false }
  const kept = ordered.slice(0, Math.max(1, limit - 1))
  const omittedTree = ranked.filter((item) => item.rank === 1).length
    - kept.filter((line) => lineRank(line) === 1).length
  const note = omittedTree > 0
    ? `省略了 ${omittedTree} 个 treeitem，用 browser_find 查`
    : `省略了 ${ordered.length - kept.length} 行，用 browser_find 查`
  return { text: [...kept, note].join('\n'), truncated: true }
}

export type SnapHit = {
  line: number
  text: string
  context: string
  ref?: string
}

export const findInSnapshot = (snapshot: string, query: string, regex = false) => {
  const needle = String(query || '').trim()
  if (!needle) return { error: '缺少 query' as const, hits: [] as SnapHit[] }
  const lines = String(snapshot || '').split('\n')
  let test: (line: string) => boolean
  if (regex) {
    try {
      const wrapped = needle.match(/^\/(.+)\/([a-z]*)$/)
      const source = wrapped ? wrapped[1] : needle
      const flags = (wrapped ? wrapped[2] : 'i').replace(/[^gimsuy]/g, '') || 'i'
      const re = new RegExp(source, flags.includes('g') ? flags : flags)
      test = (line) => {
        re.lastIndex = 0
        return re.test(line)
      }
    } catch {
      return { error: '正则写坏了' as const, hits: [] as SnapHit[] }
    }
  } else {
    const want = needle.toLowerCase()
    test = (line) => line.toLowerCase().includes(want)
  }
  const hits: SnapHit[] = []
  for (let i = 0; i < lines.length && hits.length < 8; i++) {
    if (!test(lines[i])) continue
    const start = Math.max(0, i - 2)
    const end = Math.min(lines.length, i + 3)
    const ref = lines[i].match(/\[ref=(e\d+)\]/i)?.[1]
    hits.push({
      line: i + 1,
      text: lines[i],
      context: lines.slice(start, end).join('\n'),
      ...(ref ? { ref } : {}),
    })
  }
  return { hits }
}

export const actionSnapBudgetMs = () => ACTION_SNAP_MS
