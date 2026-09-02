import { ref } from 'vue'
import {
  bindChaoxingSiteGraph,
  getChaoxingSiteGraphSeed,
  seedChaoxingSiteGraph,
} from '../agent/skillRuntime'
import type { PlatformRole } from '../platform/types'

export type SiteGraphParserId = PlatformRole

export type SiteGraphEdgeKind = 'forward' | 'back' | 'loop'

export type SiteGraphEdge = {
  from: string
  to: string
  label: string
  kind?: SiteGraphEdgeKind
}

/** 可序列化节点：patterns 为 URL 正则（命中任一即匹配）。 */
export type SiteGraphNodeData = {
  id: string
  title: string
  path: string
  summary: string
  row: number
  col: number
  patterns: string[]
  parserIds: SiteGraphParserId[]
}

export type SiteGraphData = {
  id: string
  name: string
  host: string
  /** 站点级 URL 正则 */
  hostPattern: string
  notes?: string[]
  nodes: SiteGraphNodeData[]
  edges: SiteGraphEdge[]
}

export type SiteGraphNode = SiteGraphNodeData & {
  match: (url: string) => boolean
}

export type SiteGraph = {
  id: string
  name: string
  host: string
  match: (url: string) => boolean
  notes?: string[]
  nodes: SiteGraphNode[]
  edges: SiteGraphEdge[]
}

const PARSER_IDS = new Set<SiteGraphParserId>(['login', 'study', 'homework', 'captcha'])

const normalizeParserId = (raw: string): SiteGraphParserId | null => {
  const id = String(raw || '').trim()
  if (!id) return null
  if (PARSER_IDS.has(id as SiteGraphParserId)) return id as SiteGraphParserId
  if (id === 'chaoxing-homework' || id.endsWith('-homework')) return 'homework'
  if (id === 'chaoxing-study' || id.endsWith('-study')) return 'study'
  if (id === 'chaoxing-login' || id.endsWith('-login')) return 'login'
  if (id === 'chaoxing-captcha' || id.endsWith('-captcha')) return 'captcha'
  return null
}

const sanitizeParserIds = (ids: unknown): SiteGraphParserId[] => {
  if (!Array.isArray(ids)) return []
  return ids
    .map((item) => normalizeParserId(String(item || '')))
    .filter((id): id is SiteGraphParserId => Boolean(id))
}

export const testPattern = (pattern: string, url: string) => {
  const raw = String(pattern || '').trim()
  if (!raw) return false
  try {
    return new RegExp(raw, 'i').test(url)
  } catch {
    return url.toLowerCase().includes(raw.toLowerCase())
  }
}

const nodeMatches = (node: SiteGraphNodeData, url: string) =>
  (node.patterns || []).some((pattern) => testPattern(pattern, url))

export const hydrateSite = (data: SiteGraphData): SiteGraph => ({
  id: data.id,
  name: data.name,
  host: data.host,
  notes: data.notes ? [...data.notes] : undefined,
  match: (url) => testPattern(data.hostPattern, url),
  nodes: data.nodes.map((node) => ({
    ...node,
    patterns: [...(node.patterns || [])],
    parserIds: [...(node.parserIds || [])],
    match: (url) => nodeMatches(node, url),
  })),
  edges: data.edges.map((edge) => ({ ...edge })),
})

export const cloneGraph = (data: SiteGraphData): SiteGraphData => (
  JSON.parse(JSON.stringify(data)) as SiteGraphData
)

/** 运行时图谱：先读 Skill 的 site-graph.json，Agent 可再改内存。 */
export const liveSiteGraphs = ref<SiteGraphData[]>([cloneGraph(seedChaoxingSiteGraph())])
export const SITE_GRAPHS = liveSiteGraphs

bindChaoxingSiteGraph((data) => {
  const next = cloneGraph(data)
  const rest = liveSiteGraphs.value.filter((item) => item.id !== next.id)
  liveSiteGraphs.value = [next, ...rest]
})

const sanitizePatterns = (patterns: unknown) => {
  if (!Array.isArray(patterns)) return [] as string[]
  return patterns.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
}

const findLiveSite = (siteId?: string, url?: string) => {
  const id = String(siteId || '').trim()
  if (id) return liveSiteGraphs.value.find((site) => site.id === id) || null
  const href = String(url || '')
  if (href) return liveSiteGraphs.value.find((site) => testPattern(site.hostPattern, href)) || null
  return liveSiteGraphs.value[0] || null
}

const bumpGraphs = () => {
  liveSiteGraphs.value = liveSiteGraphs.value.map((site) => cloneGraph(site))
}

const replaceLiveSite = (data: SiteGraphData) => {
  const next = cloneGraph(data)
  liveSiteGraphs.value = liveSiteGraphs.value.map((item) => (item.id === next.id ? next : item))
  if (!liveSiteGraphs.value.some((item) => item.id === next.id)) {
    liveSiteGraphs.value = [...liveSiteGraphs.value, next]
  }
  bumpGraphs()
}

export type SiteGraphPatchResult = {
  ok: boolean
  error?: string
  site?: SiteGraphData
  hint?: string
}

export const applySiteGraphPatch = (
  args: Record<string, unknown>,
  opts?: { url?: string },
): SiteGraphPatchResult => {
  const action = String(args.action || '').trim()
  const site = findLiveSite(String(args.siteId || ''), opts?.url)
  if (!site && action !== 'reset' && action !== 'list') {
    return { ok: false, error: '找不到站点图谱。可先 list，或传 siteId=chaoxing。' }
  }

  if (action === 'list' || action === 'get') {
    const target = site || liveSiteGraphs.value[0]
    if (!target) return { ok: false, error: '还没有任何站点图谱' }
    return {
      ok: true,
      site: cloneGraph(target),
      hint: '这是当前图谱。用 upsert_node / upsert_edge 改内存；要持久化请编辑 Skill 的 site-graph.json。reset 从该文件恢复。',
    }
  }

  if (action === 'reset') {
    const id = String(args.siteId || site?.id || 'chaoxing').trim() || 'chaoxing'
    if (id !== 'chaoxing') {
      return { ok: false, error: '目前只内置 chaoxing，可 reset siteId=chaoxing' }
    }
    replaceLiveSite(getChaoxingSiteGraphSeed())
    return { ok: true, site: cloneGraph(findLiveSite('chaoxing')!), hint: '已从 Skill 的 site-graph.json 重新加载。' }
  }

  if (!site) return { ok: false, error: '找不到站点图谱' }

  if (action === 'set_notes') {
    const notes = Array.isArray(args.notes)
      ? args.notes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : String(args.note || '').trim()
        ? [String(args.note).trim().slice(0, 160)]
        : []
    site.notes = notes
    bumpGraphs()
    return { ok: true, site: cloneGraph(site), hint: '已更新备注。' }
  }

  if (action === 'upsert_node') {
    const id = String(args.id || '').trim().slice(0, 40)
    if (!id) return { ok: false, error: 'upsert_node 需要 id', site: cloneGraph(site) }
    const title = String(args.title || '').trim().slice(0, 24) || id
    const path = String(args.path || '').trim().slice(0, 80) || title
    const summary = String(args.summary || '').trim().slice(0, 120) || title
    const patterns = sanitizePatterns(args.patterns)
    if (!patterns.length) {
      return { ok: false, error: 'upsert_node 需要 patterns：URL 正则数组，用于识别当前页', site: cloneGraph(site) }
    }
    const row = Number.isFinite(Number(args.row)) ? Math.max(0, Math.min(12, Math.floor(Number(args.row)))) : 0
    const col = Number.isFinite(Number(args.col)) ? Math.max(-1, Math.min(1, Math.floor(Number(args.col)))) : 0
    const parserIds = sanitizeParserIds(args.parserIds)
    const next: SiteGraphNodeData = { id, title, path, summary, row, col, patterns, parserIds }
    const index = site.nodes.findIndex((node) => node.id === id)
    if (index >= 0) site.nodes[index] = next
    else site.nodes.push(next)
    bumpGraphs()
    return { ok: true, site: cloneGraph(findLiveSite(site.id)!), hint: `已写入节点「${title}」。` }
  }

  if (action === 'remove_node') {
    const id = String(args.id || '').trim()
    if (!id) return { ok: false, error: 'remove_node 需要 id', site: cloneGraph(site) }
    site.nodes = site.nodes.filter((node) => node.id !== id)
    site.edges = site.edges.filter((edge) => edge.from !== id && edge.to !== id)
    bumpGraphs()
    return { ok: true, site: cloneGraph(findLiveSite(site.id)!), hint: `已删除节点 ${id}。` }
  }

  if (action === 'upsert_edge') {
    const from = String(args.from || '').trim()
    const to = String(args.to || '').trim()
    const label = String(args.label || '').trim().slice(0, 24) || '跳转'
    if (!from || !to) return { ok: false, error: 'upsert_edge 需要 from / to', site: cloneGraph(site) }
    if (!site.nodes.some((node) => node.id === from) || !site.nodes.some((node) => node.id === to)) {
      return { ok: false, error: 'from/to 必须是已有节点 id', site: cloneGraph(site) }
    }
    const kindRaw = String(args.kind || '').trim()
    const kind = kindRaw === 'back' || kindRaw === 'loop' ? kindRaw : undefined
    const index = site.edges.findIndex((edge) => edge.from === from && edge.to === to && edge.label === label)
    const next: SiteGraphEdge = { from, to, label, ...(kind ? { kind } : {}) }
    if (index >= 0) site.edges[index] = next
    else site.edges.push(next)
    bumpGraphs()
    return { ok: true, site: cloneGraph(findLiveSite(site.id)!), hint: `已写入边 ${from} → ${to}。` }
  }

  if (action === 'remove_edge') {
    const from = String(args.from || '').trim()
    const to = String(args.to || '').trim()
    const label = String(args.label || '').trim()
    if (!from || !to) return { ok: false, error: 'remove_edge 需要 from / to', site: cloneGraph(site) }
    site.edges = site.edges.filter((edge) => !(
      edge.from === from
      && edge.to === to
      && (!label || edge.label === label)
    ))
    bumpGraphs()
    return { ok: true, site: cloneGraph(findLiveSite(site.id)!), hint: `已删除边 ${from} → ${to}。` }
  }

  return {
    ok: false,
    error: 'action 必须是 list/get / upsert_node / remove_node / upsert_edge / remove_edge / set_notes / reset',
  }
}

export const siteGraphForUrl = (url: string) => {
  const data = liveSiteGraphs.value.find((site) => testPattern(site.hostPattern, url)) || null
  return data ? hydrateSite(data) : null
}

export const siteGraphNodeForUrl = (url: string, site = siteGraphForUrl(url)) => {
  if (!site) return null
  let best: SiteGraphNode | null = null
  let bestScore = -1
  for (const node of site.nodes) {
    const hits = (node.patterns || []).filter((pattern) => testPattern(pattern, url))
    if (!hits.length) continue
    const score = Math.max(...hits.map((pattern) => pattern.length)) + hits.length
    if (score > bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

export const siteGraphNodeId = (url: string) => siteGraphNodeForUrl(url)?.id || ''

export const siteGraphParserIds = (url: string) => siteGraphNodeForUrl(url)?.parserIds || []
