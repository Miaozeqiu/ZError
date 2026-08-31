import { computed, ref } from 'vue'
import {
  abstractionMenuOpen,
  BROWSER_ABSTRACTIONS,
  currentBrowserUrl,
  type BrowserAbstractionId,
} from './abstractions'

export type SiteGraphParser = {
  id: BrowserAbstractionId
  name: string
  tool: string
}

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
  parserIds: BrowserAbstractionId[]
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

const PARSER_IDS = new Set(BROWSER_ABSTRACTIONS.map((item) => item.id))

const testPattern = (pattern: string, url: string) => {
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

const hydrateSite = (data: SiteGraphData): SiteGraph => ({
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

const cloneGraph = (data: SiteGraphData): SiteGraphData => JSON.parse(JSON.stringify(data)) as SiteGraphData

/** 种子图谱：可改，不是最终定稿。 */
export const DEFAULT_CHAOXING_SITE_GRAPH: SiteGraphData = {
  id: 'chaoxing',
  name: '学习通',
  host: 'chaoxing.com',
  hostPattern: 'chaoxing\\.com',
  notes: [],
  nodes: [
    {
      id: 'login',
      title: '登录',
      path: 'passport2.chaoxing.com',
      summary: '账号密码登录，成功后离开登录页。',
      row: 0,
      col: 0,
      patterns: ['passport2\\.chaoxing\\.com'],
      parserIds: ['chaoxing-login'],
    },
    {
      id: 'space',
      title: '空间',
      path: 'i.chaoxing.com',
      summary: '登录后的个人空间。',
      row: 1,
      col: 0,
      patterns: ['(?:i\\.mooc\\.chaoxing|i\\.chaoxing)\\.com'],
      parserIds: [],
    },
    {
      id: 'courses',
      title: '课程列表',
      path: '/visit/interaction',
      summary: '课名在列表里，点进去进课程壳。',
      row: 2,
      col: 0,
      patterns: ['visit\\/(interaction|courses)'],
      parserIds: [],
    },
    {
      id: 'course',
      title: '课程',
      path: '/mycourse/stu',
      summary: '课程壳：章节、作业等页签。',
      row: 3,
      col: 0,
      patterns: ['\\/mycourse\\/stu(?!dentstudy)(?![^#]*[?&]pageHeader=8(?:&|$))', 'stucoursemiddle', 'studentcourse'],
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'study',
      title: '章节播放',
      path: '/mycourse/studentstudy',
      summary: '原地切节，内容在 #iframe。',
      row: 4,
      col: -1,
      patterns: ['studentstudy'],
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'homework-list',
      title: '作业列表',
      path: '/work · pageHeader=8',
      summary: '待做、已完成作业。',
      row: 4,
      col: 1,
      patterns: ['[?&]pageHeader=8(?:&|$)', '\\/work\\/(?:list|index|view)(?:[/?#]|$)', 'mooc2-ans\\.chaoxing\\.com\\/[^?\\s]*\\/work(?:\\/|\\?|$)'],
      parserIds: ['chaoxing-homework'],
    },
    {
      id: 'cards',
      title: '内容页',
      path: '/knowledge/cards',
      summary: '播放页里的内容 iframe，视频和讨论卡片在这里。',
      row: 5,
      col: -1,
      patterns: ['\\/knowledge\\/cards'],
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'homework-do',
      title: '作业作答',
      path: '/work/dowork',
      summary: '题卡和网页双向同步。',
      row: 5,
      col: 1,
      patterns: ['doHomeWork', '\\/work\\/do(?:work)?(?:[/?#]|$)', 'dowork', 'do-work'],
      parserIds: ['chaoxing-homework'],
    },
  ],
  edges: [
    { from: 'login', to: 'space', label: '登录成功' },
    { from: 'space', to: 'courses', label: '打开课程' },
    { from: 'courses', to: 'course', label: '点课名' },
    { from: 'course', to: 'study', label: '点章节' },
    { from: 'course', to: 'homework-list', label: '点作业' },
    { from: 'study', to: 'course', label: '回课程', kind: 'back' },
    { from: 'study', to: 'cards', label: '内容 iframe' },
    { from: 'study', to: 'study', label: '切节', kind: 'loop' },
    { from: 'homework-list', to: 'homework-do', label: '打开一份' },
    { from: 'homework-do', to: 'homework-list', label: '返回', kind: 'back' },
  ],
}

/** 运行时图谱：Agent 可改，不是定死模板。 */
export const liveSiteGraphs = ref<SiteGraphData[]>([cloneGraph(DEFAULT_CHAOXING_SITE_GRAPH)])

/** @deprecated 兼容旧引用；请用 liveSiteGraphs / DEFAULT_CHAOXING_SITE_GRAPH */
export const CHAOXING_SITE_GRAPH = hydrateSite(DEFAULT_CHAOXING_SITE_GRAPH)
export const SITE_GRAPHS = liveSiteGraphs

const parserOf = (id: BrowserAbstractionId): SiteGraphParser => {
  const item = BROWSER_ABSTRACTIONS.find((row) => row.id === id)
  return {
    id,
    name: item?.name || id,
    tool: item?.tool || '',
  }
}

const sanitizeParserIds = (ids: unknown): BrowserAbstractionId[] => {
  if (!Array.isArray(ids)) return []
  return ids
    .map((item) => String(item || '').trim())
    .filter((id): id is BrowserAbstractionId => PARSER_IDS.has(id as BrowserAbstractionId))
}

const sanitizePatterns = (patterns: unknown) => {
  if (!Array.isArray(patterns)) return [] as string[]
  return patterns.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
}

const findLiveSite = (siteId?: string, url?: string) => {
  const id = String(siteId || '').trim()
  if (id) return liveSiteGraphs.value.find((site) => site.id === id) || null
  const href = String(url || currentBrowserUrl.value || '')
  if (href) return liveSiteGraphs.value.find((site) => testPattern(site.hostPattern, href)) || null
  return liveSiteGraphs.value[0] || null
}

const bumpGraphs = () => {
  liveSiteGraphs.value = liveSiteGraphs.value.map((site) => cloneGraph(site))
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
      hint: '这是当前可改的图谱。用 upsert_node / upsert_edge / set_notes / remove_* 修改，reset 恢复种子。',
    }
  }

  if (action === 'reset') {
    const id = String(args.siteId || site?.id || 'chaoxing').trim() || 'chaoxing'
    if (id === 'chaoxing') {
      liveSiteGraphs.value = liveSiteGraphs.value.map((item) => (
        item.id === 'chaoxing' ? cloneGraph(DEFAULT_CHAOXING_SITE_GRAPH) : item
      ))
      if (!liveSiteGraphs.value.some((item) => item.id === 'chaoxing')) {
        liveSiteGraphs.value = [...liveSiteGraphs.value, cloneGraph(DEFAULT_CHAOXING_SITE_GRAPH)]
      }
      bumpGraphs()
      return { ok: true, site: cloneGraph(findLiveSite('chaoxing')!), hint: '已恢复学习通种子图谱。' }
    }
    return { ok: false, error: '目前只内置 chaoxing 种子，可 reset siteId=chaoxing' }
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

const MAP_W = 296
const NODE_W = 118
const NODE_H = 60
const GAP_Y = 40
const PAD_Y = 18
const PAD_X = 16

const colX = (col: number) => {
  if (col < 0) return PAD_X
  if (col > 0) return MAP_W - PAD_X - NODE_W
  return (MAP_W - NODE_W) / 2
}

const rowY = (row: number) => PAD_Y + row * (NODE_H + GAP_Y)

const edgeKindOf = (edge: SiteGraphEdge): SiteGraphEdgeKind => {
  if (edge.kind) return edge.kind
  if (edge.from === edge.to) return 'loop'
  return 'forward'
}

const wireOf = (
  from: { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number; col: number },
  to: { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number; col: number },
  edge: SiteGraphEdge,
) => {
  const kind = edgeKindOf(edge)
  if (kind === 'loop') {
    const side = from.col > 0 ? -1 : 1
    const x = side < 0 ? from.x : from.x + from.w
    const y1 = from.y + 12
    const y2 = from.y + from.h - 12
    const bulge = x + side * 20
    return {
      d: `M ${x} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${x} ${y2}`,
      lx: bulge,
      ly: from.cy,
      kind,
    }
  }
  if (kind === 'back') {
    const sameCol = from.col === to.col
    const side = sameCol
      ? (from.col > 0 ? -1 : 1)
      : (Math.min(from.col, to.col) < 0 ? -1 : 1)
    const x1 = side < 0 ? from.x : from.x + from.w
    const x2 = side < 0 ? to.x : to.x + to.w
    const mid = side < 0
      ? Math.max(18, Math.min(x1, x2) - 14)
      : Math.min(MAP_W - 18, Math.max(x1, x2) + 14)
    return {
      d: `M ${x1} ${from.cy} C ${mid} ${from.cy}, ${mid} ${to.cy}, ${x2} ${to.cy}`,
      lx: mid,
      ly: (from.cy + to.cy) / 2,
      kind,
    }
  }
  const x1 = from.cx
  const y1 = from.y + from.h
  const x2 = to.cx
  const y2 = to.y
  if (Math.abs(x1 - x2) < 2) {
    return {
      d: `M ${x1} ${y1} L ${x2} ${y2}`,
      lx: x1 + 16,
      ly: (y1 + y2) / 2,
      kind,
    }
  }
  const midY = (y1 + y2) / 2
  return {
    d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
    lx: (x1 + x2) / 2,
    ly: midY,
    kind,
  }
}

export const siteGraphMenuOpen = ref(false)

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
    // 更长的命中正则通常更具体（如 pageHeader=8 / studentstudy）
    const score = Math.max(...hits.map((pattern) => pattern.length)) + hits.length
    if (score > bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

export const siteGraphView = (url: string) => {
  // 依赖 liveSiteGraphs，改图后面板会刷新
  void liveSiteGraphs.value
  const site = siteGraphForUrl(url)
  const current = site ? siteGraphNodeForUrl(url, site) : null
  const nodes = (site?.nodes || []).map((node) => {
    const x = colX(node.col)
    const y = rowY(node.row)
    return {
      ...node,
      current: current?.id === node.id,
      parsers: node.parserIds.map(parserOf),
      jumps: (site?.edges || [])
        .filter((edge) => edge.from === node.id)
        .map((edge) => ({
          label: edge.label,
          to: edge.to,
          toTitle: site?.nodes.find((item) => item.id === edge.to)?.title || edge.to,
        })),
      x,
      y,
      w: NODE_W,
      h: NODE_H,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const wires = (site?.edges || []).flatMap((edge) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    const wire = wireOf(from, to, edge)
    return [{
      ...edge,
      ...wire,
      active: current?.id === from.id || current?.id === to.id,
    }]
  })
  const lastRow = nodes.reduce((max, node) => Math.max(max, node.row), 0)
  return {
    site,
    current,
    nodes,
    wires,
    width: MAP_W,
    height: PAD_Y * 2 + (lastRow + 1) * NODE_H + lastRow * GAP_Y,
    unknown: Boolean(url) && !site,
  }
}

const parserName = (name: string) => name.replace(/^学习通/, '')

export const siteGraphAgentSnap = (url: string) => {
  const view = siteGraphView(url)
  if (!view.site) return null
  const current = view.nodes.find((node) => node.current) || null
  return {
    site: view.site.name,
    siteId: view.site.id,
    page: current?.title || null,
    path: current?.path || null,
    parsers: (current?.parsers || []).map((parser) => ({
      name: parserName(parser.name),
      tool: parser.tool,
    })),
    jumps: (current?.jumps || []).map((jump) => ({
      label: jump.label,
      to: jump.toTitle,
    })),
    note: view.site.notes?.[0] || '',
    editable: true,
  }
}

export const siteGraphAgentContext = (url: string) => {
  const snap = siteGraphAgentSnap(url)
  if (!snap) return ''
  const bits = [`【网站图谱】${snap.site}`]
  bits[0] += snap.page ? ` · 当前在「${snap.page}」` : ' · 当前页未匹配已知路由'
  if (snap.path) bits.push(snap.path)
  if (snap.parsers.length) {
    bits.push(`可挂解析器：${snap.parsers.map((item) => `${item.name}（${item.tool}）`).join('、')}`)
  }
  if (snap.jumps.length) {
    bits.push(`可跳转：${snap.jumps.map((item) => `${item.label} → ${item.to}`).join('；')}`)
  }
  if (snap.note) bits.push(snap.note)
  bits.push('图谱可改：发现新路由或不准时用 browser_site_graph 增改节点/边')
  return bits.join('。')
}

export const siteGraphButtonLabel = computed(() => {
  const view = siteGraphView(currentBrowserUrl.value)
  if (view.current) return `图谱 · ${view.current.title}`
  if (view.site) return `图谱 · ${view.site.name}`
  return '图谱'
})

export const toggleSiteGraphMenu = () => {
  const next = !siteGraphMenuOpen.value
  siteGraphMenuOpen.value = next
  if (next) abstractionMenuOpen.value = false
}

export const toggleAbstractionMenu = () => {
  const next = !abstractionMenuOpen.value
  abstractionMenuOpen.value = next
  if (next) siteGraphMenuOpen.value = false
}
