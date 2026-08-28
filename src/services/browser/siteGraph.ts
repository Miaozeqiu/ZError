import { computed, ref } from 'vue'
import {
  abstractionMenuOpen,
  BROWSER_ABSTRACTIONS,
  currentBrowserUrl,
  isCourseUrl,
  isHomeworkUrl,
  isLoginUrl,
  isPlayerUrl,
  type BrowserAbstractionId,
} from './abstractions'

export type SiteGraphParser = {
  id: BrowserAbstractionId
  name: string
  tool: string
}

export type SiteGraphNode = {
  id: string
  title: string
  path: string
  summary: string
  row: number
  col: number
  match: (url: string) => boolean
  parserIds: BrowserAbstractionId[]
}

export type SiteGraphEdgeKind = 'forward' | 'back' | 'loop'

export type SiteGraphEdge = {
  from: string
  to: string
  label: string
  kind?: SiteGraphEdgeKind
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

const isChaoxing = (url: string) => /chaoxing\.com/i.test(url)
const isHomeworkDoUrl = (url: string) => isHomeworkUrl(url) && /doHomeWork|dowork|do-work/i.test(url)
const isHomeworkListUrl = (url: string) => isHomeworkUrl(url) && !isHomeworkDoUrl(url)
const isCourseListUrl = (url: string) => isChaoxing(url) && /visit\/(interaction|courses)/i.test(url)
const isSpaceUrl = (url: string) => (
  isChaoxing(url)
  && /(?:^|[./])(?:i\.mooc\.chaoxing|i\.chaoxing)\.com/i.test(url)
  && !isCourseListUrl(url)
  && !isCourseUrl(url)
  && !isPlayerUrl(url)
  && !isHomeworkUrl(url)
  && !isLoginUrl(url)
)
const isCardsUrl = (url: string) => isChaoxing(url) && /\/knowledge\/cards/i.test(url)

const parserOf = (id: BrowserAbstractionId): SiteGraphParser => {
  const item = BROWSER_ABSTRACTIONS.find((row) => row.id === id)
  return {
    id,
    name: item?.name || id,
    tool: item?.tool || '',
  }
}

export const CHAOXING_SITE_GRAPH: SiteGraph = {
  id: 'chaoxing',
  name: '学习通',
  host: 'chaoxing.com',
  match: isChaoxing,
  notes: ['9010 验证码是浮层，不是独立路由，解析器是「验证码」。'],
  nodes: [
    {
      id: 'login',
      title: '登录',
      path: 'passport2.chaoxing.com',
      summary: '账号密码登录，成功后离开登录页。',
      row: 0,
      col: 0,
      match: isLoginUrl,
      parserIds: ['chaoxing-login'],
    },
    {
      id: 'space',
      title: '空间',
      path: 'i.chaoxing.com',
      summary: '登录后的个人空间。',
      row: 1,
      col: 0,
      match: isSpaceUrl,
      parserIds: [],
    },
    {
      id: 'courses',
      title: '课程列表',
      path: '/visit/interaction',
      summary: '课名在列表里，点进去进课程壳。',
      row: 2,
      col: 0,
      match: isCourseListUrl,
      parserIds: [],
    },
    {
      id: 'course',
      title: '课程',
      path: '/mycourse/studentcourse',
      summary: '课程壳：章节、作业等页签。',
      row: 3,
      col: 0,
      match: (url) => isCourseUrl(url) && !isCardsUrl(url),
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'study',
      title: '章节播放',
      path: '/mycourse/studentstudy',
      summary: '原地切节，内容在 #iframe。',
      row: 4,
      col: -1,
      match: isPlayerUrl,
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'homework-list',
      title: '作业列表',
      path: '/work · pageHeader=8',
      summary: '待做、已完成作业。',
      row: 4,
      col: 1,
      match: isHomeworkListUrl,
      parserIds: ['chaoxing-homework'],
    },
    {
      id: 'cards',
      title: '内容页',
      path: '/knowledge/cards',
      summary: '播放页里的内容 iframe，视频和讨论卡片在这里。',
      row: 5,
      col: -1,
      match: isCardsUrl,
      parserIds: ['chaoxing-study'],
    },
    {
      id: 'homework-do',
      title: '作业作答',
      path: '/work/dowork',
      summary: '题卡和网页双向同步。',
      row: 5,
      col: 1,
      match: isHomeworkDoUrl,
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

export const SITE_GRAPHS: SiteGraph[] = [CHAOXING_SITE_GRAPH]

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

export const siteGraphForUrl = (url: string) => (
  SITE_GRAPHS.find((site) => site.match(url)) || null
)

export const siteGraphNodeForUrl = (url: string, site = siteGraphForUrl(url)) => (
  site?.nodes.find((node) => node.match(url)) || null
)

export const siteGraphView = (url: string) => {
  const site = siteGraphForUrl(url)
  const current = site ? siteGraphNodeForUrl(url, site) : null
  const nodes = (site?.nodes || []).map((node) => {
    const x = colX(node.col)
    const y = rowY(node.row)
    return {
      ...node,
      current: current?.id === node.id,
      parsers: node.parserIds.map(parserOf),
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
