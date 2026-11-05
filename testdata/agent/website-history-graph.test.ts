import { describe, expect, it } from 'vitest'
import { GRAPH_LOCAL, GRAPH_REMOTE, GRAPH_BRANCH_COLORS, layoutHistoryGraph, orderHistoryGraph, type HistoryGraphItem } from '../../src/utils/ui/websiteHistoryGraph'
const node = (key: string, parents: string[], current = false, timestamp = 1, color = GRAPH_LOCAL): HistoryGraphItem => ({ key, parents, current, timestamp, color })
describe('SCM history graph ancestry', () => {
  it('places current work ahead of its parents even when the upstream timestamp is newer', () => {
    expect(orderHistoryGraph([node('base', [], false, 9), node('local', ['base'], true, 1)]).map(item => item.key)).toEqual(['local', 'base'])
  })
  it('connects adjacent rows at their boundaries and changes color at the remote reference', () => {
    const graph = layoutHistoryGraph([node('local', ['base'], true), node('base', ['root'], false, 1, GRAPH_REMOTE), node('root', [], false, 1, GRAPH_REMOTE)])
    expect(graph.get('local')!.paths).toContainEqual({ d: 'M 11 11 V 22', color: GRAPH_LOCAL })
    expect(graph.get('base')!.paths).toContainEqual({ d: 'M 11 0 V 11', color: GRAPH_LOCAL })
    expect(graph.get('base')!.paths).toContainEqual({ d: 'M 11 11 V 22', color: GRAPH_REMOTE })
    expect(graph.get('root')!.paths.some(path => path.d.endsWith('V 22'))).toBe(false)
  })
  it('keeps fork lanes separate and joins them at the actual shared parent', () => {
    const graph = layoutHistoryGraph([node('local', ['base'], true), node('remote', ['base'], false, 2, GRAPH_REMOTE), node('base', [], false, 1, GRAPH_REMOTE)])
    expect(graph.get('local')!.x).toBe(11)
    expect(graph.get('remote')!.x).toBe(22)
    expect(graph.get('remote')!.paths).toContainEqual({ d: 'M 11 0 V 22', color: GRAPH_LOCAL })
    expect(graph.get('base')!.paths.some(path => path.d === 'M 22 0 A 11 11 0 0 1 11 11 H 11')).toBe(true)
    expect(graph.get('local')!.width).toBe(22)
    expect(graph.get('base')!.width).toBe(33)
  })
  it('does not invent an edge to an unrelated next record when an older base is unavailable', () => {
    const graph = layoutHistoryGraph([node('local', ['bundled:1'], true), node('remote', [], false, 1, GRAPH_REMOTE)])
    expect(graph.get('remote')!.paths).toEqual([])
    expect(graph.get('remote')!.x).toBe(11)
  })
  it('keeps the upstream lane continuous when the local migration ends at an unavailable bundled version', () => {
    const graph = layoutHistoryGraph([
      node('update', ['migration', 'newRemote'], true),
      node('newRemote', ['oldRemote'], false, 5, GRAPH_REMOTE),
      node('oldRemote', ['root'], false, 4, GRAPH_REMOTE),
      node('migration', ['bundled:1'], false, 3),
      node('root', [], false, 2, GRAPH_REMOTE),
    ])
    expect(graph.get('update')!.paths).toContainEqual({ d: 'M 11 11 H 11 A 11 11 0 0 1 22 22', color: GRAPH_REMOTE })
    for (const key of ['newRemote', 'oldRemote', 'migration']) {
      expect(graph.get(key)!.paths).toContainEqual({ d: key === 'migration' ? 'M 22 0 V 22' : 'M 22 11 V 22', color: GRAPH_REMOTE })
    }
    expect(graph.get('root')!.x).toBe(22)
    expect(graph.get('root')!.paths).toContainEqual({ d: 'M 22 0 V 11', color: GRAPH_REMOTE })
    expect(graph.get('migration')!.paths).toContainEqual({ d: 'M 11 11 V 18', color: GRAPH_LOCAL })
  })
  it('draws every incoming branch into a shared ancestor before its outgoing edge', () => {
    const graph = layoutHistoryGraph([
      node('merge', ['left', 'right'], true), node('left', ['base']),
      node('right', ['base'], false, 1, GRAPH_REMOTE), node('base', ['root'], false, 1, GRAPH_REMOTE),
      node('root', [], false, 1, GRAPH_REMOTE),
    ])
    expect(graph.get('base')!.paths).toContainEqual({ d: 'M 22 0 A 11 11 0 0 1 11 11 H 11', color: GRAPH_REMOTE })
    expect(graph.get('base')!.paths).toContainEqual({ d: 'M 11 0 V 11', color: GRAPH_LOCAL })
    expect(graph.get('base')!.paths).toContainEqual({ d: 'M 11 11 V 22', color: GRAPH_REMOTE })
  })
  it('anchors the remote first-parent chain on the left and the local fork on the right', () => {
    const items = [
      node('local', ['migration', 'base'], true, 8),
      { ...node('remote', ['base'], false, 9, GRAPH_REMOTE), mainline: true },
      { ...node('base', ['root'], false, 6, GRAPH_REMOTE), mainline: true },
      node('migration', ['bundled:1'], false, 5),
      { ...node('root', [], false, 1, GRAPH_REMOTE), mainline: true },
    ]
    const ordered = orderHistoryGraph(items), graph = layoutHistoryGraph(ordered)
    expect(ordered[0].key).toBe('remote')
    for (const key of ['remote', 'base', 'root']) expect(graph.get(key)!.x).toBe(11)
    for (const key of ['local', 'migration']) expect(graph.get(key)!.x).toBe(22)
    expect(graph.get('local')!.paths).toContainEqual({ d: 'M 11 0 V 22', color: GRAPH_LOCAL })
    expect(graph.get('local')!.paths).toContainEqual({ d: 'M 22 11 H 22 A 11 11 0 0 1 33 22', color: GRAPH_LOCAL })
    expect(graph.get('migration')!.paths).toContainEqual({ d: 'M 22 11 V 18', color: GRAPH_BRANCH_COLORS[0] })
  })
  it('keeps a local child above the remote mainline parent it is based on', () => {
    const ordered = orderHistoryGraph([node('local', ['base'], true), { ...node('base', [], false, 9, GRAPH_REMOTE), mainline: true }])
    expect(ordered.map(item => item.key)).toEqual(['local', 'base'])
    const graph = layoutHistoryGraph(ordered)
    expect(graph.get('local')!.x).toBe(22)
    expect(graph.get('base')!.x).toBe(11)
  })
  it('keeps distinct side-branch colors until they join the mainline at a shared ancestor', () => {
    const items = [
      { ...node('head', ['base', 'left', 'right'], true, 9), mainline: true },
      node('left', ['base'], false, 8), node('right', ['base'], false, 7),
      { ...node('base', [], false, 1), mainline: true },
    ]
    const graph = layoutHistoryGraph(orderHistoryGraph(items))
    expect(graph.get('head')!.color).toBe(GRAPH_LOCAL)
    expect(graph.get('left')!.color).toBe(GRAPH_BRANCH_COLORS[0])
    expect(graph.get('right')!.color).toBe(GRAPH_BRANCH_COLORS[1])
    expect(graph.get('head')!.paths.filter(path => path.d.includes('A 11 11'))).toHaveLength(2)
    expect(graph.get('base')!.x).toBe(11)
    expect(graph.get('base')!.paths.some(path => path.d.includes(' C '))).toBe(false)
  })
  it('orders newer side commits before older mainline ancestors without breaking topology', () => {
    const items = [
      { ...node('head', ['base'], false, 9), mainline: true },
      { ...node('base', ['root'], false, 8), mainline: true },
      node('local', ['base', 'migration'], true, 7), node('migration', [], false, 6),
      { ...node('root', [], false, 1), mainline: true },
    ]
    expect(orderHistoryGraph(items).map(item => item.key)).toEqual(['head', 'local', 'base', 'migration', 'root'])
  })
  it('handles merge nodes and corrupt cycles without losing records', () => {
    const items = [node('merge', ['a', 'b'], true), node('a', []), node('b', [], false, 1, GRAPH_REMOTE)]
    expect(layoutHistoryGraph(items).get('merge')!.merge).toBe(true)
    expect(orderHistoryGraph([node('x', ['y']), node('y', ['x'])])).toHaveLength(2)
  })
})
