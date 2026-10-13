import { computed, ref } from 'vue'
import {
  abstractionMenuOpen,
  BROWSER_ABSTRACTIONS,
  currentBrowserUrl,
  lastSiteCard,
  type BrowserAbstractionId,
} from './abstractions'
import chaoxingBundledGraph from '../agent/skills/bundled/chaoxing/site-graph.json'
import {
  activeFrameOf,
  hydrateSite,
  liveSiteGraphs,
  nodeFrames,
  replaceLiveSite,
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
  SiteGraphChanged,
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

const MAP_W = 560
const NODE_W = 220
const NODE_H = 56
const GAP_X = 36
const GAP_Y = 36
const PAD_Y = 24
const PAD_X = 32

const nodeHeightOf = (node: { sketch?: unknown; frame?: unknown; frames?: unknown[] }) => {
  if (node.sketch || node.frame || (node.frames && node.frames.length)) return 156
  return NODE_H
}

const colX = (col: number) => {
  if (col < 0) return PAD_X
  if (col > 0) return MAP_W - PAD_X - NODE_W
  return (MAP_W - NODE_W) / 2
}

export const sketchOf = (node?: {
  title?: string
  path?: string
  summary?: string
  sketch?: import('./siteGraphCore').SiteGraphSketch
  frame?: { name?: string; title?: string; open?: string }
  frames?: Array<{ tab?: string; title?: string; open?: string }>
} | null) => {
  if (node?.sketch) return node.sketch
  const tabs = (node?.frames || []).map((item) => item.tab).filter(Boolean) as string[]
  if (tabs.length) {
    return {
      kind: 'host-tabs' as const,
      shell: node?.frame?.name || node?.title || '外壳',
      tabs,
      pane: node?.frame?.title || tabs.join(' / '),
      caption: node?.summary || '',
    }
  }
  if (node?.frame) {
    return {
      kind: 'host-tabs' as const,
      shell: node.title || '页面',
      pane: `${node.frame.name} · ${node.frame.title}`,
      caption: node.frame.open === 'stay' ? '内容在 iframe 里，网址常不变' : '',
    }
  }
  return {
    kind: 'full' as const,
    shell: node?.title || '页面',
    caption: node?.path || '整页',
  }
}

const loopLabelsOf = (nodeId: string, edges: SiteGraphEdge[] = []) => (
  edges
    .filter((edge) => edge.from === nodeId && (edge.to === nodeId || edge.kind === 'loop'))
    .map((edge) => edge.label)
    .filter(Boolean)
)

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

type WireBox = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number; col: number }

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const EDGE = 7

const backSideOf = (from: WireBox, to: WireBox) => (
  from.col > 0 || to.col > 0 ? 1 : -1
)

const wireOf = (
  from: WireBox,
  to: WireBox,
  edge: SiteGraphEdge,
  lane = 0,
) => {
  const kind = edgeKindOf(edge)
  if (kind === 'loop') {
    const side = from.col > 0 ? 1 : -1
    const x = side < 0 ? from.x : from.x + from.w
    const y1 = from.y + 14
    const y2 = from.y + from.h - 14
    const bulge = clamp(x + side * 28, 16, MAP_W - 16)
    return {
      d: `M ${x} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${x} ${y2}`,
      lx: bulge,
      ly: from.cy,
      kind,
    }
  }
  if (kind === 'back') {
    const side = backSideOf(from, to)
    const x1 = side < 0 ? from.x - 1 : from.x + from.w + 1
    const x2 = side < 0 ? to.x - 1 : to.x + to.w + 1
    const y1 = from.cy
    const y2 = to.cy
    const gutter = clamp(
      (side < 0 ? Math.min(x1, x2) : Math.max(x1, x2)) + side * (18 + lane * 14),
      16,
      MAP_W - 16,
    )
    const r = 9
    const dir = y2 >= y1 ? 1 : -1
    return {
      d: [
        `M ${x1} ${y1}`,
        `L ${gutter - side * r} ${y1}`,
        `Q ${gutter} ${y1} ${gutter} ${y1 + dir * r}`,
        `L ${gutter} ${y2 - dir * r}`,
        `Q ${gutter} ${y2} ${gutter - side * r} ${y2}`,
        `L ${x2} ${y2}`,
      ].join(' '),
      lx: gutter,
      ly: (y1 + y2) / 2,
      kind,
    }
  }
  const x1 = from.cx
  const y1 = from.y + from.h + EDGE
  const x2 = to.cx
  const y2 = to.y - EDGE
  if (Math.abs(x1 - x2) < 8) {
    const pull = Math.max(18, Math.abs(y2 - y1) * 0.38)
    return {
      d: `M ${x1} ${y1} C ${x1} ${y1 + pull}, ${x2} ${y2 - pull}, ${x2} ${y2}`,
      lx: x1 + 15,
      ly: (y1 + y2) / 2,
      kind,
    }
  }
  const midY = y1 + (y2 - y1) * 0.48
  const r = clamp(Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2, 8, 14)
  const s = x2 >= x1 ? 1 : -1
  return {
    d: [
      `M ${x1} ${y1}`,
      `L ${x1} ${midY - r}`,
      `Q ${x1} ${midY} ${x1 + s * r} ${midY}`,
      `L ${x2 - s * r} ${midY}`,
      `Q ${x2} ${midY} ${x2} ${midY + r}`,
      `L ${x2} ${y2}`,
    ].join(' '),
    lx: (x1 + x2) / 2,
    ly: midY,
    kind,
  }
}

const planWires = (
  byId: Map<string, WireBox>,
  edges: SiteGraphEdge[],
  currentId = '',
) => {
  const rows = edges.filter((edge) => edgeKindOf(edge) !== 'loop' && edge.from !== edge.to)
  const backs = rows.filter((edge) => edgeKindOf(edge) === 'back')
  const laneOf = new Map<string, number>()
  const left: SiteGraphEdge[] = []
  const right: SiteGraphEdge[] = []
  for (const edge of backs) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    ;(backSideOf(from, to) < 0 ? left : right).push(edge)
  }
  const assign = (list: SiteGraphEdge[]) => {
    [...list]
      .sort((a, b) => (byId.get(a.from)?.y || 0) - (byId.get(b.from)?.y || 0))
      .forEach((edge, idx) => laneOf.set(`${edge.from}>${edge.to}>${edge.label}`, idx))
  }
  assign(left)
  assign(right)
  return rows.flatMap((edge) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    const lane = laneOf.get(`${edge.from}>${edge.to}>${edge.label}`) || 0
    return [{
      ...edge,
      ...wireOf(from, to, edge, lane),
      active: currentId === from.id || currentId === to.id,
    }]
  })
}

export const siteGraphMenuOpen = ref(false)
export const liveCourseTab = ref('')
export const liveCourseTabVia = ref('')
export const liveSpaceTab = ref('')
/** 活页顶层 / iframe 认出来的地址。图谱用它，不要只信地址栏。 */
export const liveGraphHref = ref('')
let courseTabCourseId = ''

const courseIdOfHref = (url: string) => (
  (String(url || '').match(/[?&](?:courseid|courseId)=(\d+)/i) || [])[1] || ''
)

export const resetCourseTab = () => {
  liveCourseTab.value = ''
  liveCourseTabVia.value = ''
  liveSpaceTab.value = ''
  liveGraphHref.value = ''
  courseTabCourseId = ''
  lastSiteCard.value = null
}

export const noteCourseTab = (tab: string, via = 'note', url = '') => {
  const next = String(tab || '').trim()
  if (!next) return
  liveCourseTab.value = next
  liveCourseTabVia.value = via
  const id = courseIdOfHref(url)
  if (id) courseTabCourseId = id
}

/** 课程壳当前侧栏页签。探到的侧栏/iframe 优先，不要信滞后的 pageHeader=0。 */
export const courseTabOf = (
  url: string,
  node?: { id?: string; frame?: { tab?: string }; frames?: Array<{ tab?: string; patterns?: string[] }> } | null,
) => {
  const href = String(url || '')
  if (node && node.id && node.id !== 'course') return ''
  if (/studentcourse/i.test(href)) return '章节'
  if (/\/work\/(?:list|index|view)/i.test(href)) return '作业'
  if (/stuActiveList|\/active\/stu/i.test(href)) return '任务'
  const header = (href.match(/[?&]pageHeader=(\d+)/i) || [])[1] || ''
  if (header === '1') return '章节'
  if (header === '8') return '作业'
  const cardTab = lastSiteCard.value?.role === 'course' ? String(lastSiteCard.value.current || '') : ''
  if (cardTab === '章节' || cardTab === '任务' || cardTab === '作业') return cardTab
  const courseId = courseIdOfHref(href)
  const probed = liveCourseTabVia.value === 'probe'
    && liveCourseTab.value
    && (!courseTabCourseId || !courseId || courseTabCourseId === courseId)
    ? liveCourseTab.value
    : ''
  if (probed) return probed
  if (header === '0') return '任务'
  const hit = node ? activeFrameOf(node, href) : null
  return hit?.tab || '任务'
}

const siteGraphViewFromSite = (
  site: ReturnType<typeof hydrateSite> | null,
  current: ReturnType<typeof siteGraphNodeForUrl>,
  unknown = false,
  url = '',
) => {
  const rowSet = [...new Set((site?.nodes || []).map((node) => node.row))].sort((a, b) => a - b)
  const activeTab = current?.id === 'course'
    ? courseTabOf(url, current)
    : current?.id === 'space'
      ? (liveSpaceTab.value || activeFrameOf(current, url)?.tab || '')
      : ''
  const active = (current?.id === 'course' || current?.id === 'space') && activeTab
    ? (nodeFrames(current).find((item) => item.tab === activeTab) || activeFrameOf(current, url))
    : activeFrameOf(current, url)
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
      const h = nodeHeightOf(node)
      if (!single && x > PAD_X && x + NODE_W > MAP_W - PAD_X) {
        cursorY += lineH + GAP_Y
        x = PAD_X
        lineH = 0
      }
      const panes = nodeFrames(node).map((item) => ({
        ...item,
        on: Boolean(current?.id === node.id && (
          activeTab
            ? item.tab === activeTab
            : active && (active.id || active.tab) === (item.id || item.tab)
        )),
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
  const wires = planWires(byId, site?.edges || [], current?.id || '')
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

const graphHrefOf = (url: string) => {
  const topId = siteGraphNodeForUrl(url)?.id || ''
  if (topId === 'study' || topId === 'homework-do' || topId === 'login') return url
  return liveGraphHref.value || url
}

export const siteGraphView = (url: string) => {
  void liveSiteGraphs.value
  void liveCourseTab.value
  void liveSpaceTab.value
  void liveGraphHref.value
  void lastSiteCard.value
  const href = graphHrefOf(url)
  const site = siteGraphForUrl(href)
  const current = site ? siteGraphNodeForUrl(href, site) : null
  return siteGraphViewFromSite(site, current, Boolean(url) && !site, href)
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
  const wires = planWires(byId, view.wires, view.nodes.find((node) => (node as { current?: boolean }).current)?.id || '')
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
  const pane = current?.id === 'course'
    ? (nodeFrames(current).find((item) => item.tab === courseTabOf(url, current)) || activeFrameOf(current, url))
    : activeFrameOf(current, url)
  const page = current?.id === 'course' && pane?.tab === '章节'
    ? '章节目录'
    : current?.id === 'course' && pane?.tab
      ? `${current.title} · ${pane.tab}`
      : (current?.title || null)
  return {
    site: view.site.name,
    siteId: view.site.id,
    page,
    path: current?.path || null,
    summary: current?.summary || '',
    structure: current?.structure || current?.summary || '',
    tab: pane?.tab || '',
    playable: current?.id === 'study',
    frame: (() => {
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
    sketch: current ? sketchOf(current) : undefined,
    note: (view.site.notes || []).filter(Boolean).join(' '),
    editable: true,
  }
}

export const siteGraphAgentContext = (url: string) => {
  const snap = siteGraphAgentSnap(url)
  if (!snap) return ''
  const bits = [`${snap.site}${snap.page ? ` · ${snap.page}` : ''}`]
  if (snap.tab) bits.push(`tab=${snap.tab}`)
  if (snap.playable) bits.push('playable')
  if (snap.page === '章节目录' || (snap.tab === '章节' && !snap.playable)) bits.push('目录不是播放页')
  return bits.join(' · ')
}

export const siteGraphButtonLabel = computed(() => {
  const href = currentBrowserUrl.value
  const view = siteGraphView(href)
  if (view.current?.id === 'course') {
    const tab = courseTabOf(href, view.current)
    return tab ? `图谱 · 课程 · ${tab}` : '图谱 · 课程'
  }
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

if (import.meta.hot) {
  replaceLiveSite(chaoxingBundledGraph as SiteGraphData)
  import.meta.hot.accept('../agent/skills/bundled/chaoxing/site-graph.json', (mod) => {
    const data = (mod as { default?: SiteGraphData } | undefined)?.default
    if (data?.id) replaceLiveSite(data)
  })
}
