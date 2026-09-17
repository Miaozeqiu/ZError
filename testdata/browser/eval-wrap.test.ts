import { describe, expect, it } from 'vitest'
import { wrapEvalExpression } from '../../src/services/browser/eval'

describe('wrapEvalExpression', () => {
  it('顶层 return 包成 IIFE', () => {
    expect(wrapEvalExpression('return { ok: true, href: location.href }')).toBe(
      '(function(){\nreturn { ok: true, href: location.href }\n})()',
    )
  })

  it('已是 IIFE 不再包一层', () => {
    const iife = '(function(){ return location.href })()'
    expect(wrapEvalExpression(iife)).toBe(iife)
  })

  it('没有 return 的表达式原样留下', () => {
    expect(wrapEvalExpression('location.href')).toBe('location.href')
  })
})
