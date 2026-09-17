import { ref } from 'vue'
import {
  bindChaoxingSiteGraph,
  getChaoxingSiteGraphSeed,
  reloadLearnedSiteGraphs,
  seedChaoxingSiteGraph,
} from '../agent/skillRuntime'

export type SiteGraphParserId = string

export type SiteGraphEdgeKind = 'forward' | 'back' | 'loop'

export type SiteGraphEdge = {
  from: string
  to: string
  label: string
  kind?: SiteGraphEdgeKind
}

export type SiteGraphFrame = {
  /** 框名，如 #frame_content / studentcourse */
  name: string
  /** 框里是什么 */
  title: string
  /** top=完整页可顶层打开；stay=嵌套文档，留在框里 */
  open: 'top' | 'stay'
  /** host=外壳含框；page=这张就是框里的页 */
  kind?: 'host' | 'page'
  /** 同一 iframe 里的页签，如 我教的课 / 我学的课 */
  id?: string
  tab?: string
  patterns?: string[]
}

/** 可序列化节点：patterns 为 URL 正则（命中任一即匹配）。 */
export type SiteGraphNodeData = {
  id: string
  title: string
  path: string
  summary: string
  /** 页内结构：入口、iframe、不要挂什么解析器 */
  structure?: string
  /** 页内框：host=外壳套着 iframe。同一框多个页签用 frames */
  frame?: SiteGraphFrame
  frames?: SiteGraphFrame[]
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

const PLATFORM_ROLES = new Set(['login', 'study', 'homework', 'captcha'])

const normalizeParserId = (raw: string): SiteGraphParserId | null => {
  const id = String(raw || '').trim().replace(/\\/g, '/')
  if (!id) return null
  if (PLATFORM_ROLES.has(id)) return id
  if (id === 'chaoxing-homework' || id.endsWith('-homework')) return 'homework'
  if (id === 'chaoxing-study' || id.endsWith('-study')) return 'study'
  if (id === 'chaoxing-login' || id.endsWith('-login')) return 'login'
  if (id === 'chaoxing-captcha' || id.endsWith('-captcha')) return 'captcha'
  const name = id.replace(/^parsers\//, '').split('/').filter(Boolean)[0] || ''
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) return null
  return name
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

const urlParts = (url: string) => {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      route: `${parsed.origin}${parsed.pathname}`,
    }
  } catch {
    return { host: '', route: url }
  }
}

/** 带主机名的规则只认真实 host / 路径，不认 refer= 查询串里的别的站 */
const hostishPattern = (pattern: string) => (
  /[a-z0-9-]+\.[a-z0-9.-]+/i.test(String(pattern || '').replace(/\\/g, ''))
)

export const testNodePattern = (pattern: string, url: string) => {
  const parts = urlParts(url)
  if (hostishPattern(pattern)) {
    return testPattern(pattern, parts.host) || testPattern(pattern, parts.route)
  }
  return testPattern(pattern, url)
}

const nodeMatches = (node: SiteGraphNodeData, url: string) =>
  (node.patterns || []).some((pattern) => testNodePattern(pattern, url))

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
  liveSiteGraphs.value = next.id === 'chaoxing' ? [next, ...rest] : [...rest, next]
})

void reloadLearnedSiteGraphs()

const sanitizePatterns = (patterns: unknown) => {
  if (!Array.isArray(patterns)) return [] as string[]
  return patterns.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
}

export const nodeFrames = (node?: { frame?: SiteGraphFrame; frames?: SiteGraphFrame[] } | null) => {
  if (!node) return [] as SiteGraphFrame[]
  if (Array.isArray(node.frames) && node.frames.length) return node.frames
  return node.frame ? [node.frame] : []
}

export const activeFrameOf = (
  node: { frame?: SiteGraphFrame; frames?: SiteGraphFrame[] } | null | undefined,
  url: string,
) => {
  const frames = nodeFrames(node)
  if (!frames.length) return null
  const href = String(url || '')
  if (!href) return null
  const hit = frames.find((item) => (item.patterns || []).some((pattern) => testPattern(pattern, href)))
  return hit || null
}

const sanitizeFrame = (raw: unknown, prev?: SiteGraphFrame): SiteGraphFrame | undefined => {
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : prev
  if (!src) return undefined
  const name = String(src.name || src.tab || '').trim().slice(0, 36)
  const title = String(src.title || '').trim().slice(0, 48)
  const tab = String(src.tab || '').trim().slice(0, 16)
  if (!name && !title && !tab) return undefined
  const patterns = sanitizePatterns(src.patterns)
  return {
    name: name || tab || 'iframe',
    title: title || name || tab,
    open: src.open === 'stay' ? 'stay' : 'top',
    kind: src.kind === 'page' ? 'page' : 'host',
    ...(src.id ? { id: String(src.id).trim().slice(0, 24) } : {}),
    ...(tab ? { tab } : {}),
    ...(patterns.length ? { patterns } : {}),
  }
}

const sanitizeFrames = (raw: unknown, prev?: SiteGraphFrame[], prevOne?: SiteGraphFrame) => {
  const list = Array.isArray(raw) ? raw : Array.isArray(prev) && prev.length ? prev : prevOne ? [prevOne] : []
  return list
    .map((item) => sanitizeFrame(item))
    .filter((item): item is SiteGraphFrame => Boolean(item))
    .slice(0, 6)
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
  if (!site && action !== 'reset' && action !== 'list' && action !== 'upsert_site') {
    return { ok: false, error: '找不到站点图谱。可先 list，或 upsert_site 建新站点。' }
  }

  if (action === 'list') {
    if (!liveSiteGraphs.value.length) return { ok: false, error: '还没有任何站点图谱' }
    return {
      ok: true,
      sites: liveSiteGraphs.value.map((item) => cloneGraph(item)),
      site: cloneGraph(site || liveSiteGraphs.value[0]),
      hint: 'sites 是内存里全部站点。学习通用 chaoxing；其它站点用 upsert_site 再建节点。',
    }
  }

  if (action === 'get') {
    const target = site || liveSiteGraphs.value[0]
    if (!target) return { ok: false, error: '还没有任何站点图谱' }
    return {
      ok: true,
      site: cloneGraph(target),
      hint: '这是当前图谱。用 upsert_node / upsert_edge 改内存；要留下就写回对应 Skill 的 site-graph.json。',
    }
  }

  if (action === 'upsert_site') {
    let urlHost = ''
    try {
      urlHost = opts?.url ? new URL(opts.url).hostname.replace(/^www\./i, '').toLowerCase() : ''
    } catch {
      urlHost = ''
    }
    const hostRaw = String(args.host || args.siteId || urlHost).trim().replace(/^www\./i, '').toLowerCase()
    const siteId = String(args.siteId || hostRaw).trim().slice(0, 40)
    if (!siteId) return { ok: false, error: 'upsert_site 需要 siteId 或 host' }
    const existing = findLiveSite(siteId)
    const host = String(args.host || existing?.host || hostRaw).trim().replace(/^www\./i, '').toLowerCase() || siteId
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hostPattern = String(args.hostPattern || existing?.hostPattern || escaped).trim() || escaped
    const name = String(args.name || existing?.name || host).trim().slice(0, 40) || host
    const next: SiteGraphData = {
      id: siteId,
      name,
      host,
      hostPattern,
      notes: existing?.notes ? [...existing.notes] : [],
      nodes: existing?.nodes ? existing.nodes.map((node) => ({ ...node, patterns: [...(node.patterns || [])], parserIds: [...(node.parserIds || [])] })) : [],
      edges: existing?.edges ? existing.edges.map((edge) => ({ ...edge })) : [],
    }
    replaceLiveSite(next)
    return {
      ok: true,
      site: cloneGraph(findLiveSite(siteId)!),
      hint: existing ? `已更新站点 ${siteId}。` : `已新建站点 ${siteId}。接着 upsert_node，再写回 site-learn 的 sites/${host}/site-graph.json。`,
    }
  }

  if (action === 'reset') {
    const id = String(args.siteId || site?.id || 'chaoxing').trim() || 'chaoxing'
    if (id === 'chaoxing') {
      replaceLiveSite(getChaoxingSiteGraphSeed())
      return { ok: true, site: cloneGraph(findLiveSite('chaoxing')!), hint: '已从 Skill 的 site-graph.json 重新加载。' }
    }
    return { ok: false, error: `站点 ${id} 没有内置种子。从 site-learn 的 sites/<host>/site-graph.json 再写入即可。` }
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
    const prev = site.nodes.find((node) => node.id === id)
    const title = String(args.title || prev?.title || '').trim().slice(0, 24) || id
    const path = String(args.path || prev?.path || '').trim().slice(0, 80) || title
    const summary = String(args.summary || prev?.summary || '').trim().slice(0, 200) || title
      const structure = String(args.structure ?? prev?.structure ?? '').trim().slice(0, 280)
    const patterns = sanitizePatterns(args.patterns)
    if (!patterns.length) {
      return { ok: false, error: 'upsert_node 需要 patterns：URL 正则数组，用于识别当前页', site: cloneGraph(site) }
    }
    const row = Number.isFinite(Number(args.row)) ? Math.max(0, Math.min(12, Math.floor(Number(args.row)))) : 0
    const col = Number.isFinite(Number(args.col)) ? Math.max(-1, Math.min(1, Math.floor(Number(args.col)))) : 0
    const parserIds = sanitizeParserIds(args.parserIds ?? prev?.parserIds)
    const frame = sanitizeFrame(args.frame, prev?.frame)
    const frames = sanitizeFrames(args.frames, prev?.frames, frame)
    const next: SiteGraphNodeData = {
      id, title, path, summary, row, col, patterns, parserIds,
      ...(structure ? { structure } : {}),
      ...(frame ? { frame } : {}),
      ...(frames.length ? { frames } : {}),
    }
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
    error: 'action 必须是 list/get / upsert_site / upsert_node / remove_node / upsert_edge / remove_edge / set_notes / reset',
  }
}

export const siteGraphForUrl = (url: string) => {
  const data = liveSiteGraphs.value.find((site) => testPattern(site.hostPattern, url)) || null
  return data ? hydrateSite(data) : null
}

export const siteGraphNodeForUrl = (url: string, site = siteGraphForUrl(url)) => {
  if (!site) return null
  const parts = urlParts(url)
  let best: SiteGraphNode | null = null
  let bestScore = -1
  for (const node of site.nodes) {
    const hits = (node.patterns || []).filter((pattern) => testNodePattern(pattern, url))
    if (!hits.length) continue
    const hostHit = hits.some((pattern) => (
      hostishPattern(pattern)
      && (testPattern(pattern, parts.host) || testPattern(pattern, parts.route))
    ))
    const score = Math.max(...hits.map((pattern) => pattern.length)) + hits.length + (hostHit ? 1000 : 0)
    if (score > bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

export const siteGraphNodeId = (url: string) => siteGraphNodeForUrl(url)?.id || ''

export const siteGraphParserIds = (url: string) => siteGraphNodeForUrl(url)?.parserIds || []

const GRAPH_RANK: Record<string, number> = {
  'homework-do': 80,
  study: 60,
  course: 50,
  space: 10,
  login: 5,
}

/** 外壳 URL 不变时，用内容 iframe 的地址认当前节点或页签。 */
export const siteGraphUrlFromFrames = (topUrl: string, frameSrcs: string[] = []) => {
  const topNode = siteGraphNodeForUrl(topUrl)
  // 播放页 / 独立作答页顶层已定：不要被嵌套 iframe（章节测验 doHomeWork）抢成别的节点
  if (topNode?.id === 'study' || topNode?.id === 'homework-do' || /studentstudy/i.test(topUrl)) {
    for (const src of frameSrcs) {
      const href = String(src || '').trim()
      if (!href) continue
      const panes = nodeFrames(topNode)
      if (panes.some((pane) => (pane.patterns || []).some((pattern) => testPattern(pattern, href)))) {
        return href
      }
    }
    return topUrl
  }
  for (const src of frameSrcs) {
    const href = String(src || '').trim()
    if (!href) continue
    const panes = nodeFrames(topNode)
    if (panes.some((pane) => (pane.patterns || []).some((pattern) => testPattern(pattern, href)))) {
      return href
    }
  }
  let bestUrl = topUrl
  let bestRank = GRAPH_RANK[topNode?.id || ''] || 0
  for (const src of frameSrcs) {
    const href = String(src || '').trim()
    if (!href) continue
    const rank = GRAPH_RANK[siteGraphNodeForUrl(href)?.id || ''] || 0
    if (rank > bestRank) {
      bestUrl = href
      bestRank = rank
    }
  }
  return bestUrl
}
