import { describe, expect, it } from 'vitest'
import { parseToolArgs } from '../../src/services/agent/toolArgs'

describe('parseToolArgs 修坏 JSON', () => {
  it('漏了嵌套左括号：{"handle": kind": "step"…}}', () => {
    const args = parseToolArgs('{"handle": kind": "step", "label": "4.3.1缝制工序分析"}}')
    expect(args.handle).toEqual({ kind: 'step', label: '4.3.1缝制工序分析' })
  })

  it('少一个右括号也补齐', () => {
    const args = parseToolArgs('{"handle": {"kind": "control", "name": "play"}')
    expect(args.handle).toEqual({ kind: 'control', name: 'play' })
  })

  it('完全拼不回来时至少捞出顶层标量', () => {
    const args = parseToolArgs('{"kind": "step", "label": "4.3.2成衣缝制设备", "index": 2, oops')
    expect(args.kind).toBe('step')
    expect(args.label).toBe('4.3.2成衣缝制设备')
    expect(args.index).toBe(2)
  })

  it('正常 JSON 不动，嵌套字段不会漏到顶层', () => {
    const args = parseToolArgs('{"handle": {"kind": "step", "label": "a"}, "op": "click"}')
    expect(args).toEqual({ handle: { kind: 'step', label: 'a' }, op: 'click' })
    expect(args.kind).toBeUndefined()
  })
})
