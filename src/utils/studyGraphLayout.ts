import { flattenGraph, type StudyGraphNode } from './studyGraph'

export interface NetworkLayoutNode {
  id: string
  name: string
  x: number
  y: number
  r: number
  depth: number
  mastery?: number
  progress: number
}

export interface NetworkLayoutLink {
  from: string
  to: string
  extra?: boolean
}

export interface NetworkLayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const TWO_PI = Math.PI * 2

const sizeScale = (count: number) => Math.max(0.42, Math.min(1, 1.12 - Math.max(0, count - 10) * 0.014))

const nodeRadiusFor = (depth: number, scale: number) => {
  if (depth <= 0) return Math.max(22, 38 * scale)
  if (depth === 1) return Math.max(14, 24 * scale)
  return Math.max(10, 17 * scale)
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

const collectByDepth = (root: StudyGraphNode) => {
  const byDepth = new Map<number, number>()
  const walk = (node: StudyGraphNode, depth: number) => {
    byDepth.set(depth, (byDepth.get(depth) || 0) + 1)
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  return byDepth
}

const ringRadii = (root: StudyGraphNode, scale: number) => {
  const counts = collectByDepth(root)
  const rings = [0]
  let depth = 1
  while (counts.has(depth)) {
    const r = nodeRadiusFor(depth, scale)
    const prevR = nodeRadiusFor(depth - 1, scale)
    const gap = Math.max(36, 72 * scale)
    const fromParent = rings[depth - 1] + prevR + r + gap
    const around = (counts.get(depth)! * (r * 2 + Math.max(28, 52 * scale))) / TWO_PI
    rings.push(Math.max(fromParent, around))
    depth += 1
  }
  return rings
}

const boundsOf = (nodes: { x: number; y: number; r: number }[]): NetworkLayoutBounds => {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const pad = node.r + 28
    minX = Math.min(minX, node.x - pad)
    minY = Math.min(minY, node.y - pad)
    maxX = Math.max(maxX, node.x + pad)
    maxY = Math.max(maxY, node.y + pad)
  }
  return { minX, minY, maxX, maxY }
}

export const layoutStudyNetwork = (
  root: StudyGraphNode,
  width: number,
  height: number,
): { nodes: NetworkLayoutNode[]; links: NetworkLayoutLink[]; bounds: NetworkLayoutBounds } => {
  const { nodes: flat, links } = flattenGraph(root)
  const scale = sizeScale(flat.length)
  const rings = ringRadii(root, scale)
  const weights = new Map<string, number>()
  leafWeight(root, weights)
  const parentOf = new Map<string, string>()
  const walkParent = (node: StudyGraphNode) => {
    for (const child of node.children) {
      parentOf.set(child.id, node.id)
      walkParent(child)
    }
  }
  walkParent(root)

  const world = Math.max(
    width,
    height,
    ((rings[rings.length - 1] || 0) + nodeRadiusFor(rings.length - 1, scale) + 80) * 2,
  )
  const cx = world / 2
  const cy = world / 2
  const pos = new Map<string, { x: number; y: number; r: number; depth: number; ring: number }>()

  const place = (node: StudyGraphNode, depth: number, start: number, end: number) => {
    const angle = (start + end) / 2
    const ring = rings[depth] || 0
    pos.set(node.id, {
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
      r: nodeRadiusFor(depth, scale),
      depth,
      ring,
    })
    const kids = node.children
    if (!kids.length) return
    const total = kids.reduce((sum, child) => sum + leafWeight(child, weights), 0) || kids.length
    let cursor = start
    for (const child of kids) {
      const slice = ((end - start) * leafWeight(child, weights)) / total
      place(child, depth + 1, cursor, cursor + slice)
      cursor += slice
    }
  }
  place(root, 0, -Math.PI / 2, -Math.PI / 2 + TWO_PI)

  const entries = [...pos.entries()]
  const gap = Math.max(16, 28 * scale)
  const steps = Math.min(72, 28 + flat.length)
  for (let iter = 0; iter < steps; iter++) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i][1]
        const b = entries[j][1]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 0.01
        const min = a.r + b.r + gap
        if (dist >= min) continue
        const push = (min - dist) * 0.48
        const ux = dx / dist
        const uy = dy / dist
        if (entries[i][0] !== root.id) {
          a.x -= ux * push * 0.5
          a.y -= uy * push * 0.5
        }
        if (entries[j][0] !== root.id) {
          b.x += ux * push * 0.5
          b.y += uy * push * 0.5
        }
      }
    }
    for (const node of flat) {
      if (node.id === root.id) continue
      const current = pos.get(node.id)
      const parent = pos.get(parentOf.get(node.id) || '')
      if (!current || !parent) continue
      const dx = current.x - parent.x
      const dy = current.y - parent.y
      const dist = Math.hypot(dx, dy) || 0.01
      const target = Math.max(current.r + parent.r + gap + 12, Math.abs(current.ring - parent.ring))
      const diff = dist - target
      current.x -= (dx / dist) * diff * 0.06
      current.y -= (dy / dist) * diff * 0.06
    }
    const rootPos = pos.get(root.id)
    if (rootPos) {
      rootPos.x = cx
      rootPos.y = cy
    }
  }

  const nodes = flat.map((node) => {
    const point = pos.get(node.id)!
    return {
      id: node.id,
      name: node.name,
      x: point.x,
      y: point.y,
      r: point.r,
      depth: point.depth,
      mastery: node.mastery,
      progress: node.stats.progress,
    }
  })
  const extra = new Set((root.extraLinks || []).map((edge) => `${edge.from}->${edge.to}`))
  return {
    nodes,
    links: links.map((link) => ({
      from: link.from,
      to: link.to,
      extra: extra.has(`${link.from}->${link.to}`),
    })),
    bounds: boundsOf(nodes),
  }
}

export const curvePath = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const bend = Math.min(36, len * 0.18)
  return `M ${x1} ${y1} Q ${mx - (dy / len) * bend} ${my + (dx / len) * bend} ${x2} ${y2}`
}
