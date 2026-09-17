import { computed, ref } from 'vue'
import {
  abstractionMenuOpen,
  BROWSER_ABSTRACTIONS,
  currentBrowserUrl,
  type BrowserAbstractionId,
} from './abstractions'
import {
  activeFrameOf,
  hydrateSite,
  liveSiteGraphs,
  nodeFrames,
  siteGraphForUrl,
  siteGraphNodeForUrl,
  type SiteGraphData,
  type SiteGraphEdge,
  type SiteGraphEdgeKind,
  type SiteGraphParserId,
} from './siteGraphCore'

export {
  activeFrameOf,
  applySiteGraphPatch,
  liveSiteGraphs,
  nodeFrames,
  SITE_GRAPHS,
  siteGraphForUrl,
  siteGraphNodeForUrl,
  siteGraphNodeId,
  siteGraphParserIds,
  siteGraphUrlFromFrames,
} from './siteGraphCore'
export type {
  SiteGraph,
  SiteGraphData,
  SiteGraphEdge,
  SiteGraphEdgeKind,
  SiteGraphFrame,
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

const MAP_W = 444
const NODE_W = 172
const NODE_H = 40
const GAP_X = 36
const GAP_Y = 28
const PAD_Y = 20
const PAD_X = 32

const colX = (col: number) => {
  if (col < 0) return PAD_X
  if (col > 0) return MAP_W - PAD_X - NODE_W
  return (MAP_W - NODE_W) / 2
}

const loopLabelsOf = (nodeId: string, edges: SiteGraphEdge[] = []) => (
  edges
    .filter((edge) => edge.from === nodeId && (edge.to === nodeId || edge.kind === 'loop'))
    .map((edge) => edge.label)
    .filter(Boolean)
)

const nodeHeight = () => NODE_H

export const graphCardsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlapX > 0 && overlapY > 0
}

const separateNodes = <T extends { x: number; y: number; w: number; h: number; cy: number }>(nodes: T[]) => {
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  let moved = true
  for (let guard = 0; moved && guard < 48; guard += 1) {
    moved = false
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]
        const b = ordered[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapX <= 0 || overlapY <= -GAP_Y) continue
        b.y += overlapY + GAP_Y
        b.cy = b.y + b.h / 2
        moved = true
      }
    }
  }
  return nodes
}

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
    const side = from.col > 0 ? 1 : -1
    const x = side < 0 ? from.x : from.x + from.w
    const y1 = from.y + 12
    const y2 = from.y + from.h - 12
    const bulge = side < 0
      ? Math.max(14, x - 26)
      : Math.min(MAP_W - 14, x + 26)
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
  url = '',
) => {
  const rowSet = [...new Set((site?.nodes || []).map((node) => node.row))].sort((a, b) => a - b)
  const active = current ? activeFrameOf(current, url) : null
  const placed: Array<{
    id: string
    col: number
    x: number
    y: number
    w: number
    h: number
    cx: number
    cy: number
    current: boolean
    frames: ReturnType<typeof nodeFrames>
    parsers: SiteGraphParser[]
    jumps: { label: string; to: string; toTitle: string }[]
    loops: string[]
    [key: string]: unknown
  }> = []
  let cursorY = PAD_Y
  for (const row of rowSet) {
    const items = (site?.nodes || [])
      .filter((node) => node.row === row)
      .sort((a, b) => a.col - b.col)
    const single = items.length === 1
    let x = single ? colX(items[0].col) : PAD_X
    let lineH = 0
    for (const node of items) {
      const h = nodeHeight()
      if (!single && x > PAD_X && x + NODE_W > MAP_W - PAD_X) {
        cursorY += lineH + GAP_Y
        x = PAD_X
        lineH = 0
      }
      const panes = nodeFrames(node).map((item) => ({
        ...item,
        on: Boolean(current?.id === node.id && active && (active.id || active.tab) === (item.id || item.tab)),
      }))
      placed.push({
        ...node,
        current: current?.id === node.id,
        frames: panes,
        parsers: node.parserIds.map(parserOf),
        jumps: (site?.edges || [])
          .filter((edge) => edge.from === node.id && edge.to !== node.id && edge.kind !== 'loop')
          .map((edge) => ({
            label: edge.label,
            to: edge.to,
            toTitle: site?.nodes.find((item) => item.id === edge.to)?.title || edge.to,
          })),
        loops: loopLabelsOf(node.id, site?.edges || []),
        x,
        y: cursorY,
        w: NODE_W,
        h,
        cx: x + NODE_W / 2,
        cy: cursorY + h / 2,
      })
      if (!single) x += NODE_W + GAP_X
      lineH = Math.max(lineH, h)
    }
    cursorY += lineH + GAP_Y
  }
  const nodes = separateNodes(placed)
  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.h), PAD_Y)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const wires = (site?.edges || []).flatMap((edge) => {
    if (edgeKindOf(edge) === 'loop' || edge.from === edge.to) return []
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
  return {
    site,
    current,
    nodes,
    wires,
    width: MAP_W,
    height: bottom + PAD_Y,
    unknown,
  }
}

export const siteGraphView = (url: string) => {
  void liveSiteGraphs.value
  const site = siteGraphForUrl(url)
  const current = site ? siteGraphNodeForUrl(url, site) : null
  return siteGraphViewFromSite(site, current, Boolean(url) && !site, url)
}

export const applyMeasuredGraphHeights = <T extends {
  nodes: Array<{ id: string; x: number; y: number; w: number; h: number; cx: number; cy: number; col: number }>
  wires: Array<{ from: string; to: string; label: string; kind?: SiteGraphEdgeKind; active?: boolean; d?: string; lx?: number; ly?: number }>
  height: number
}>(view: T, heights: Record<string, number>): T => {
  if (!view.nodes.length) return view
  const nodes = view.nodes.map((node) => ({
    ...node,
    h: Math.max(node.h, Math.ceil(heights[node.id] || node.h)),
  }))
  const groups: typeof nodes[] = []
  for (const node of [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = groups[groups.length - 1]
    if (row && Math.abs(row[0].y - node.y) < 8) row.push(node)
    else groups.push([node])
  }
  let cursorY = PAD_Y
  for (const row of groups) {
    const tallest = Math.max(...row.map((node) => node.h))
    for (const node of row) {
      node.y = cursorY
      node.cy = cursorY + node.h / 2
    }
    cursorY += tallest + GAP_Y
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const wires = view.wires.map((wire) => {
    const from = byId.get(wire.from)
    const to = byId.get(wire.to)
    if (!from || !to) return wire
    return { ...wire, ...wireOf(from, to, wire) }
  })
  return {
    ...view,
    nodes,
    wires,
    height: cursorY - GAP_Y + PAD_Y,
  }
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
    summary: current?.summary || '',
    structure: current?.structure || current?.summary || '',
    tab: activeFrameOf(current, url)?.tab || '',
    frame: (() => {
      const pane = activeFrameOf(current, url)
      const host = current?.frame?.name
      if (!pane && !host) return ''
      const where = pane?.tab || pane?.title || host || ''
      const stay = (pane?.open || current?.frame?.open) === 'stay'
      return `${host || 'iframe'} · ${where}${stay ? ' · 留在框里' : ''}`
    })(),
    parsers: (current?.parsers || []).map((parser) => ({
      name: parserName(parser.name),
      tool: parser.tool,
    })),
    jumps: (current?.jumps || []).map((jump) => ({
      label: jump.label,
      to: jump.toTitle,
    })),
    stays: current?.loops || [],
    note: (view.site.notes || []).filter(Boolean).join(' '),
    editable: true,
  }
}

export const siteGraphAgentContext = (url: string) => {
  const snap = siteGraphAgentSnap(url)
  if (!snap) return ''
  const bits = [`【网站图谱】${snap.site}`]
  bits[0] += snap.page ? ` · 当前在「${snap.page}」` : ' · 当前页未匹配已知路由'
  if (snap.path) bits.push(snap.path)
  if (snap.structure) bits.push(`结构：${snap.structure}`)
  if (snap.frame) bits.push(`iframe：${snap.frame}`)
  if (snap.tab) bits.push(`页签：${snap.tab}`)
  if (snap.parsers.length) {
    bits.push(`可挂解析器：${snap.parsers.map((item) => `${item.name}（${item.tool}）`).join('、')}`)
  } else if (snap.page) {
    bits.push('本页不挂解析器')
  }
  if (snap.stays.length) {
    bits.push(`本页：${snap.stays.join('、')}`)
  }
  if (snap.jumps.length) {
    bits.push(`边：${snap.jumps.map((item) => `${item.label} → ${item.to}`).join('；')}`)
  }
  if (snap.note) bits.push(snap.note)
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
