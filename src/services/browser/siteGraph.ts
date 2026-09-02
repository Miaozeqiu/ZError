import { computed, ref } from 'vue'
import {
  abstractionMenuOpen,
  BROWSER_ABSTRACTIONS,
  currentBrowserUrl,
  type BrowserAbstractionId,
} from './abstractions'
import {
  hydrateSite,
  liveSiteGraphs,
  siteGraphForUrl,
  siteGraphNodeForUrl,
  type SiteGraphData,
  type SiteGraphEdge,
  type SiteGraphEdgeKind,
  type SiteGraphParserId,
} from './siteGraphCore'

export {
  applySiteGraphPatch,
  liveSiteGraphs,
  SITE_GRAPHS,
  siteGraphForUrl,
  siteGraphNodeForUrl,
  siteGraphNodeId,
  siteGraphParserIds,
} from './siteGraphCore'
export type {
  SiteGraph,
  SiteGraphData,
  SiteGraphEdge,
  SiteGraphEdgeKind,
  SiteGraphNode,
  SiteGraphNodeData,
  SiteGraphPatchResult,
  SiteGraphParserId,
} from './siteGraphCore'

export type SiteGraphParser = {
  id: BrowserAbstractionId
  name: string
  tool: string
}

/** @deprecated 种子在 Skill 的 site-graph.json；请改那个文件。 */
export const DEFAULT_CHAOXING_SITE_GRAPH = liveSiteGraphs.value[0] || {
  id: 'chaoxing',
  name: '学习通',
  host: 'chaoxing.com',
  hostPattern: 'chaoxing\\.com',
  notes: [],
  nodes: [],
  edges: [],
}
export const CHAOXING_SITE_GRAPH = hydrateSite(DEFAULT_CHAOXING_SITE_GRAPH)

const parserOf = (id: BrowserAbstractionId | SiteGraphParserId): SiteGraphParser => {
  const item = BROWSER_ABSTRACTIONS.find((row) => row.id === id)
  return {
    id: id as BrowserAbstractionId,
    name: item?.name || id,
    tool: item?.tool || '',
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

const siteGraphViewFromSite = (
  site: ReturnType<typeof hydrateSite> | null,
  current: ReturnType<typeof siteGraphNodeForUrl>,
  unknown = false,
) => {
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
    unknown,
  }
}

export const siteGraphView = (url: string) => {
  void liveSiteGraphs.value
  const site = siteGraphForUrl(url)
  const current = site ? siteGraphNodeForUrl(url, site) : null
  return siteGraphViewFromSite(site, current, Boolean(url) && !site)
}

export const siteGraphViewFromData = (data: SiteGraphData | null) => {
  if (!data?.id || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return siteGraphViewFromSite(null, null, false)
  }
  try {
    return siteGraphViewFromSite(hydrateSite(data), null, false)
  } catch {
    return siteGraphViewFromSite(null, null, false)
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
