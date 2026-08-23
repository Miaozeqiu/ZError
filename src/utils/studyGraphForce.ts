import { flattenGraph, type StudyGraphNode } from './studyGraph'
import { retentionScore } from './studyForgetting'

export interface ForceNode {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  ring: number
  tx: number
  ty: number
  ox: number
  oy: number
  parentId: string
  depth: number
  degree: number
  mastery?: number
  importance?: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
  progress: number
  pinned: boolean
  bornAt: number
}

export interface ForceLink {
  from: string
  to: string
  extra?: boolean
}

export interface ForceGraph {
  nodes: ForceNode[]
  links: ForceLink[]
}

export const MASTERY_COLORS = [
  { fill: '#E8EEF1', stroke: '#B8C5CC' }, // 0 未评估
  { fill: '#B7D4D8', stroke: '#6FA0A8' }, // 1 未掌握
  { fill: '#5E9AA3', stroke: '#3D7A84' }, // 2 一般
  { fill: '#2F6F78', stroke: '#1F4F56' }, // 3 已掌握
] as const

/** @deprecated 图谱节点不再用重要程度着色，保留常量以免旧引用报错 */
export const IMPORTANCE_COLORS = ['#D7DCE6', '#B7C0E0', '#7B87C7', '#3D4A9F'] as const

export const inferImportance = (depth: number, stored?: number) => {
  const value = Number(stored)
  if (value === 1 || value === 2 || value === 3) return value
  if (depth <= 1) return 3
  if (depth === 2) return 2
  return 1
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mixColor = (a: string, b: string, t: number) => {
  const pa = hexRgb(a)
  const pb = hexRgb(b)
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

// 保持率 0–1 映射到 未掌握→一般→已掌握 的连续色带；null 为未评估灰
export const retentionColor = (retention: number | null | undefined) => {
  if (retention == null) return MASTERY_COLORS[0]
  const stops = [MASTERY_COLORS[1], MASTERY_COLORS[2], MASTERY_COLORS[3]]
  const pos = Math.max(0, Math.min(1, retention)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const t = pos - i
  return {
    fill: mixColor(stops[i].fill, stops[i + 1].fill, t),
    stroke: mixColor(stops[i].stroke, stops[i + 1].stroke, t),
  }
}

export const childrenByParent = (nodes: ForceNode[]) => {
  const map = new Map<string, ForceNode[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = map.get(node.parentId)
    if (list) list.push(node)
    else map.set(node.parentId, [node])
  }
  return map
}

export const forceRetention = (
  node: ForceNode,
  now = Date.now(),
  kids: Map<string, ForceNode[]> = new Map(),
): number | null => {
  const children = kids.get(node.id) || []
  if (children.length) {
    const scores = children.map((child) => forceRetention(child, now, kids))
    if (scores.every((score) => score == null)) return null
    return scores.reduce((sum, score) => sum + (score ?? 0), 0) / scores.length
  }
  return retentionScore(node, now)
}

export const nodeColor = (
  node: ForceNode,
  now = Date.now(),
  kids?: Map<string, ForceNode[]>,
) => retentionColor(kids ? forceRetention(node, now, kids) : retentionScore(node, now))

const TWO_PI = Math.PI * 2
export const SIZE_RATIO = 0.5
const ROOT_RADIUS = 16
const MIN_RADIUS = 2.2

export const radiusForDepth = (depth: number) =>
  Math.max(MIN_RADIUS, ROOT_RADIUS * SIZE_RATIO ** Math.max(0, depth))

const FONT_BASE = 15
const FONT_RATIO = 0.88
const MIN_FONT = 10

export const fontForDepth = (depth: number, cameraScale = 1) =>
  Math.max(MIN_FONT, FONT_BASE * FONT_RATIO ** Math.max(0, depth))
  / Math.sqrt(Math.max(0.35, cameraScale))

export const LABEL_MAX_CHARS = 16

export const labelLimitForDepth = (_depth?: number) => LABEL_MAX_CHARS

export const hitSlop = (radius: number) => Math.max(9, radius * 1.7)

export const POP_MS = 560

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const advanceAppear = (node: ForceNode, byId: Map<string, ForceNode>, now: number) => {
  if (!node.bornAt || now >= node.bornAt + POP_MS) return false
  const parent = node.parentId ? byId.get(node.parentId) : null
  const fromX = parent ? parent.x : node.ox
  const fromY = parent ? parent.y : node.oy
  if (now < node.bornAt) {
    node.x = fromX
    node.y = fromY
  } else {
    const ease = easeOutCubic((now - node.bornAt) / POP_MS)
    node.x = fromX + (node.tx - fromX) * ease
    node.y = fromY + (node.ty - fromY) * ease
  }
  node.vx = 0
  node.vy = 0
  return true
}

const leafWeight = (node: StudyGraphNode, cache: Map<string, number>): number => {
  const hit = cache.get(node.id)
  if (hit != null) return hit
  const value = node.children.length
    ? node.children.reduce((sum, child) => sum + leafWeight(child, cache), 0)
    : 1
  cache.set(node.id, value)
  return value
}

const collectSectors = (root: StudyGraphNode, weights: Map<string, number>) => {
  const sectors: { node: StudyGraphNode; depth: number; start: number; end: number }[] = []
  const walk = (node: StudyGraphNode, depth: number, start: number, end: number) => {
    sectors.push({ node, depth, start, end })
    const kids = node.children
    if (!kids.length) return
    const total = kids.reduce((sum, child) => sum + leafWeight(child, weights), 0) || kids.length
    const span = end - start
    const gap = kids.length > 1
      ? Math.min(span * 0.18 / kids.length, 0.12 * SIZE_RATIO ** depth)
      : 0
    const inner = Math.max(span * 0.72, span - gap * kids.length)
    let cursor = start + (span - inner) / 2
    for (const child of kids) {
      const slice = (inner * leafWeight(child, weights)) / total
      walk(child, depth + 1, cursor, cursor + slice)
      cursor += slice + gap
    }
  }
  walk(root, 0, -Math.PI / 2, -Math.PI / 2 + TWO_PI)
  return sectors
}

const ringsForSectors = (
  sectors: { node: StudyGraphNode; depth: number; start: number; end: number }[],
  width: number,
  height: number,
) => {
  const maxDepth = sectors.reduce((max, item) => Math.max(max, item.depth), 0)
  const rings = [0]
  for (let depth = 1; depth <= maxDepth; depth++) {
    const prevR = radiusForDepth(depth - 1)
    const currR = radiusForDepth(depth)
    const label = fontForDepth(depth) + currR * 1.2
    let need = rings[depth - 1] + prevR + currR + currR * 2.6 + label
    for (const parent of sectors) {
      if (parent.depth !== depth - 1 || !parent.node.children.length) continue
      const theta = Math.max(0.014, parent.end - parent.start)
      const pitch = currR * 3.4
      need = Math.max(need, (parent.node.children.length * pitch) / theta)
    }
    rings.push(need)
  }
  const outer = rings[maxDepth] + radiusForDepth(maxDepth) + fontForDepth(maxDepth) + 18
  const room = Math.min(width, height) * 0.46
  const grow = outer > 0 && outer < room ? room / outer : 1
  return rings.map((ring) => ring * grow)
}

const placeRadialTree = (root: StudyGraphNode, width: number, height: number) => {
  const cx = width / 2
  const cy = height / 2
  const weights = new Map<string, number>()
  leafWeight(root, weights)
  const sectors = collectSectors(root, weights)
  const rings = ringsForSectors(sectors, width, height)
  const pos = new Map<string, { x: number; y: number; depth: number; ring: number }>()
  for (const item of sectors) {
    const angle = (item.start + item.end) / 2
    const ring = rings[item.depth] || 0
    pos.set(item.node.id, {
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
      depth: item.depth,
      ring,
    })
  }
  return pos
}

export const syncForceGraph = (
  root: StudyGraphNode,
  prev: Map<string, ForceNode>,
  width: number,
  height: number,
  streaming = false,
  prevSize?: { width: number; height: number },
): ForceGraph => {
  const { nodes, links } = flattenGraph(root)
  const degree = new Map<string, number>()
  for (const link of links) {
    degree.set(link.from, (degree.get(link.from) || 0) + 1)
    degree.set(link.to, (degree.get(link.to) || 0) + 1)
  }
  const extra = new Set((root.extraLinks || []).map((edge) => `${edge.from}->${edge.to}`))
  const parentOf = new Map<string, string>()
  const walk = (node: StudyGraphNode) => {
    for (const child of node.children) {
      parentOf.set(child.id, node.id)
      walk(child)
    }
  }
  walk(root)

  const next = new Map<string, ForceNode>()
  const cx = width / 2
  const cy = height / 2
  const shiftX = prevSize && prevSize.width > 40 ? cx - prevSize.width / 2 : 0
  const shiftY = prevSize && prevSize.height > 40 ? cy - prevSize.height / 2 : 0
  const radial = placeRadialTree(root, width, height)
  const now = performance.now()
  let stagger = 0
  const prevByName = new Map<string, ForceNode>()
  if (streaming) {
    for (const item of prev.values()) {
      if (item.name && !prevByName.has(item.name)) prevByName.set(item.name, item)
    }
  }
  const incremental = streaming || nodes.some((node) => prev.has(node.id))
  nodes.forEach((node) => {
    const old = prev.get(node.id) || (streaming ? prevByName.get(node.name) : undefined)
    const placed = radial.get(node.id)
    const parent = parentOf.get(node.id)
    const parentBody = parent ? next.get(parent) || prev.get(parent) : null
    const depth = placed?.depth ?? (node.id === root.id ? 0 : (parentBody?.depth ?? 0) + 1)
    const r = radiusForDepth(depth)
    const isNew = !old
    const fromX = parentBody?.x ?? cx
    const fromY = parentBody?.y ?? cy
    const popIn = isNew && incremental
    const x = old
      ? old.x + shiftX
      : (popIn ? fromX : (placed?.x ?? cx))
    const y = old
      ? old.y + shiftY
      : (popIn ? fromY : (placed?.y ?? cy))
    next.set(node.id, {
      id: node.id,
      name: node.name,
      x,
      y,
      vx: old?.vx ?? 0,
      vy: old?.vy ?? 0,
      r,
      ring: placed?.ring ?? (depth === 0 ? 0 : 90 + (depth - 1) * 110),
      tx: placed?.x ?? cx,
      ty: placed?.y ?? cy,
      ox: old?.ox ?? fromX,
      oy: old?.oy ?? fromY,
      parentId: parent || '',
      depth,
      degree: degree.get(node.id) || 1,
      mastery: node.mastery,
      importance: inferImportance(depth, node.importance),
      forgetting_stage: node.forgetting_stage,
      last_reviewed_at: node.last_reviewed_at,
      progress: node.stats.progress,
      pinned: old?.pinned ?? false,
      bornAt: old?.bornAt ?? (popIn ? now + stagger : 0),
    })
    if (popIn) stagger += 40
  })

  return {
    nodes: [...next.values()],
    links: links.map((link) => ({
      from: link.from,
      to: link.to,
      extra: extra.has(`${link.from}->${link.to}`),
    })),
  }
}

export const stepForceGraph = (
  graph: ForceGraph,
  width: number,
  height: number,
  alpha: number,
  streaming = false,
) => {
  const { nodes, links } = graph
  if (nodes.length < 2) return
  const now = performance.now()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const hub = (node: ForceNode) => node.depth === 0 && !node.pinned
  for (const node of nodes) {
    if (!hub(node)) continue
    node.x = node.tx
    node.y = node.ty
    node.vx = 0
    node.vy = 0
  }
  const appearing = new Set<string>()
  for (const node of nodes) {
    if (node.pinned) continue
    if (advanceAppear(node, byId, now)) appearing.add(node.id)
  }
  const locked = (node: ForceNode) => node.pinned || appearing.has(node.id) || hub(node)
  if (streaming) {
    const pull = 0.16 * Math.max(alpha, 0.45)
    for (const node of nodes) {
      if (locked(node)) {
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx += (node.tx - node.x) * pull
      node.vy += (node.ty - node.y) * pull
      node.vx *= 0.76
      node.vy *= 0.76
      node.x += node.vx
      node.y += node.vy
    }
    return
  }
  const cx = width / 2
  const cy = height / 2
  const k = 72 + 520 / Math.sqrt(nodes.length)
  const charge = 1400 + nodes.length * 28
  const maxForce = 12
  const maxSpeed = 18
  const dragging = nodes.some((node) => node.pinned)
  const loose = nodes.filter((node) => !locked(node))
  let comX = 0
  let comY = 0
  if (dragging && loose.length) {
    for (const node of loose) {
      comX += node.x
      comY += node.y
    }
    comX /= loose.length
    comY /= loose.length
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.hypot(dx, dy)
      if (appearing.has(a.id) || appearing.has(b.id)) continue
      if (dist < 0.01) {
        dx = (Math.random() - 0.5) * 0.4
        dy = (Math.random() - 0.5) * 0.4
        dist = Math.hypot(dx, dy)
      }
      const force = Math.min(maxForce, (charge * alpha) / (dist * dist))
      const ux = dx / dist
      const uy = dy / dist
      if (!locked(a)) {
        a.vx -= ux * force
        a.vy -= uy * force
      }
      if (!locked(b)) {
        b.vx += ux * force
        b.vy += uy * force
      }
      const min = a.r + b.r + Math.min(a.r, b.r) * 1.3 + 3
      if (dist < min) {
        const push = (min - dist) * 0.35
        if (!locked(a)) {
          a.x -= ux * push * 0.5
          a.y -= uy * push * 0.5
        }
        if (!locked(b)) {
          b.x += ux * push * 0.5
          b.y += uy * push * 0.5
        }
      }
    }
  }

  for (const link of links) {
    const a = byId.get(link.from)
    const b = byId.get(link.to)
    if (!a || !b) continue
    if (appearing.has(a.id) || appearing.has(b.id)) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 0.01
    const rest = link.extra ? k : Math.max(28, Math.abs(a.ring - b.ring))
    const pull = ((dist - rest) / dist) * 0.045 * alpha
    if (!locked(a)) {
      a.vx += dx * pull
      a.vy += dy * pull
    }
    if (!locked(b)) {
      b.vx -= dx * pull
      b.vy -= dy * pull
    }
  }

  if (!dragging) {
    for (const node of nodes) {
      if (locked(node)) continue
      node.vx += (node.tx - node.x) * 0.085 * alpha
      node.vy += (node.ty - node.y) * 0.085 * alpha
    }
  }

  for (const node of nodes) {
    if (locked(node)) {
      node.vx = 0
      node.vy = 0
      continue
    }
    if (!dragging) {
      node.vx += (cx - node.x) * 0.004 * alpha
      node.vy += (cy - node.y) * 0.004 * alpha
    }
    node.vx = Math.max(-maxSpeed, Math.min(maxSpeed, node.vx * 0.82))
    node.vy = Math.max(-maxSpeed, Math.min(maxSpeed, node.vy * 0.82))
    node.x += node.vx
    node.y += node.vy
  }

  if (dragging && loose.length) {
    let mx = 0
    let my = 0
    let svx = 0
    let svy = 0
    for (const node of loose) {
      mx += node.x
      my += node.y
      svx += node.vx
      svy += node.vy
    }
    mx = mx / loose.length - comX
    my = my / loose.length - comY
    svx /= loose.length
    svy /= loose.length
    for (const node of loose) {
      node.x -= mx
      node.y -= my
      node.vx -= svx
      node.vy -= svy
    }
  }
}
