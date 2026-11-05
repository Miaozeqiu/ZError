/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See public/licenses/vscode-scm-graph.txt.
 * Swimlane layout and geometry adapted from VS Code scmHistory.ts.
 */
export const GRAPH_LOCAL = '#006bb9', GRAPH_REMOTE = '#8d3fb2'
export const GRAPH_BRANCH_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF'] as const
const WIDTH = 11, HEIGHT = 22
export type HistoryGraphItem = { key: string; parents: string[]; timestamp: number; current: boolean; color: string; mainline?: boolean }
type Lane = { id: string; color: string }
export type HistoryGraphRow = { width: number; x: number; color: string; current: boolean; merge: boolean; paths: { d: string; color: string }[] }

/** Children precede parents; the remote mainline wins between independent heads. */
export const orderHistoryGraph = <T extends HistoryGraphItem>(items: T[]): T[] => {
  const byId = new Map(items.map(item => [item.key, item])), children = new Map(items.map(item => [item.key, 0]))
  const mainlineParents = new Set(items.filter(item => item.mainline).flatMap(item => item.parents))
  const mainlineHeads = new Set(items.filter(item => item.mainline && !mainlineParents.has(item.key)).map(item => item.key))
  for (const item of items) for (const parent of new Set(item.parents)) if (byId.has(parent) && parent !== item.key) children.set(parent, children.get(parent)! + 1)
  const candidates = items.filter(item => !children.get(item.key)), result: T[] = []
  while (candidates.length) {
    candidates.sort((a, b) => Number(mainlineHeads.has(b.key)) - Number(mainlineHeads.has(a.key)) || Number(b.current) - Number(a.current) || b.timestamp - a.timestamp)
    const next = candidates.shift()!
    result.push(next)
    for (const parent of new Set(next.parents)) if (parent !== next.key && children.has(parent)) {
      const count = children.get(parent)! - 1; children.set(parent, count)
      if (!count) candidates.push(byId.get(parent)!)
    }
  }
  // Corrupt cycles must not make records disappear or hang the settings UI.
  const emitted = new Set(result.map(item => item.key))
  return [...result, ...items.filter(item => !emitted.has(item.key))]
}

export const layoutHistoryGraph = (items: HistoryGraphItem[]): Map<string, HistoryGraphRow> => {
  const visible = new Set(items.map(item => item.key)), rows = new Map<string, HistoryGraphRow>()
  const byId = new Map(items.map(item => [item.key, item]))
  const hasMainline = items.some(item => item.mainline)
  let previous: (Lane | null)[] = hasMainline ? [null] : [], colorIndex = 0
  const branchColor = () => GRAPH_BRANCH_COLORS[colorIndex++ % GRAPH_BRANCH_COLORS.length]
  const x = (column: number) => WIDTH * (column + 1)
  for (const item of items) {
    // Keep active columns stable when another branch ends. Compacting here
    // disconnects the next row and can draw a line through an unrelated node.
    const input = previous, output = input.map(lane => lane && { ...lane })
    const matches = input.flatMap((lane, index) => lane?.id === item.key ? [index] : [])
    const minimum = hasMainline && !item.mainline ? 1 : 0
    const empty = input.findIndex((lane, index) => !lane && index >= minimum)
    const column = item.mainline ? 0 : matches[0] ?? (empty >= 0 ? empty : Math.max(minimum, input.length))
    const nodeColor = hasMainline ? item.mainline ? GRAPH_LOCAL : input[matches[0]]?.color || branchColor() : item.color
    const paths: HistoryGraphRow['paths'] = []
    const path = (d: string, color: string) => paths.push({ d, color })
    const connect = (from: number, top: number, to: number, bottom: number, color: string) => {
      if (from === to) path(`M ${x(from)} ${top} V ${bottom}`, color)
      else {
        // Same 11px quarter circles and horizontal runs as VS Code SCM Graph.
        // The tangent at a row boundary is vertical, so consecutive rows join cleanly.
        const direction = to > from ? 1 : -1
        if (top === 0) path(`M ${x(from)} 0 A 11 11 0 0 ${direction > 0 ? 0 : 1} ${x(from) + direction * WIDTH} 11 H ${x(to)}`, color)
        else path(`M ${x(from)} 11 H ${x(to) - direction * WIDTH} A 11 11 0 0 ${direction > 0 ? 1 : 0} ${x(to)} 22`, color)
      }
    }
    for (const [index, lane] of input.entries()) {
      if (!lane) continue
      if (lane.id === item.key) {
        // Every incoming lane joins at the actual parent node, including
        // duplicate destinations created by branches with a common ancestor.
        connect(index, 0, column, HEIGHT / 2, lane.color)
        output[index] = null
      } else connect(index, 0, index, HEIGHT, lane.color)
    }
    const parents = [...new Set(item.parents)].filter(parent => parent !== item.key)
    for (const [index, parent] of parents.entries()) {
      const parentOnMainline = byId.get(parent)?.mainline
      const color = index === 0 ? nodeColor : parentOnMainline ? GRAPH_LOCAL : hasMainline ? branchColor() : byId.get(parent)?.color || GRAPH_REMOTE
      if (!visible.has(parent)) {
        // An unavailable/filtered ancestor ends near this node. It must not
        // reach a row boundary and look connected to the following record.
        path(`M ${x(column)} 11 V 18`, color)
        continue
      }
      let target = item.mainline && index === 0 ? 0 : column
      if (index > 0 || output[target]) {
        target = Math.max(column + 1, hasMainline ? 1 : 0)
        while (output[target]) target++
      }
      output[target] = { id: parent, color }
      connect(column, HEIGHT / 2, target, HEIGHT, color)
    }
    while (output.length && !output.at(-1)) output.pop()
    const width = WIDTH * (Math.max(input.length, output.length, column + 1) + 1)
    rows.set(item.key, { width, x: x(column), color: nodeColor, current: item.current, merge: parents.length > 1, paths })
    previous = output
    visible.delete(item.key)
  }
  return rows
}
