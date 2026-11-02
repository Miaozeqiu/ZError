import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { resultOrderHint } from '../../src/services/agent/tools/resultOrderHint'

describe('browser result order', () => {
  it('keeps displayed question numbers attached to DOM rows when stable IDs descend', () => {
    const dom = new JSDOM('<section id="q42"><h2>3. 第一条判断</h2></section><section id="q41"><h2>4. 第二条判断</h2></section>')
    const rows = Array.from(dom.window.document.querySelectorAll('section')).map(el => ({
      id: el.id,
      displayedNumber: el.querySelector('h2')!.textContent!.split('.')[0],
      text: el.textContent,
    }))
    expect(rows.map(row => [row.displayedNumber, row.id])).toEqual([['3', 'q42'], ['4', 'q41']])
    expect(resultOrderHint(rows)).toBeUndefined()

    const numericMap = Object.fromEntries(rows.map(row => [row.id.slice(1), row]))
    expect(Object.values(numericMap).map(row => row.displayedNumber)).toEqual(['4', '3'])
    const before = JSON.stringify(numericMap)
    expect(resultOrderHint(numericMap)).toContain('不要从 ID 大小推断序号')
    expect(JSON.stringify(numericMap)).toBe(before)
    dom.window.close()
  })

  it('warns for nested frame results, without treating arrays or named IDs as numeric maps', () => {
    expect(resultOrderHint([{ frameId: 'f', result: { questions: { 42: 'third', 41: 'fourth' } } }])).toContain('有序数组')
    for (const result of [null, 'text', [], [{ id: 42 }, { id: 41 }], { q42: 'third', q41: 'fourth' }, { 42: 'one row' }, { '01': 1, '02': 2 }, { '-1': 1, '-2': 2 }, { '4294967295': 1, '4294967296': 2 }]) {
      expect(resultOrderHint(result)).toBeUndefined()
    }
    expect(resultOrderHint({ 0: 'zero', 4294967294: 'last index', title: 'list' })).toBeTruthy()
  })

  it('bounds traversal and accepts cycles without changing data', () => {
    const cycle: { child?: unknown } = {}
    cycle.child = cycle
    expect(resultOrderHint(cycle)).toBeUndefined()
    let deep: unknown = { 2: 'b', 1: 'a' }
    for (let i = 0; i < 20; i++) deep = { child: deep }
    expect(resultOrderHint(deep)).toBeUndefined()
  })
})
