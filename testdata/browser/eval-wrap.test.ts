import { describe, expect, it } from 'vitest'
import { SAME_ORIGIN_FRAMES, wrapEvalExpression } from '../../src/services/browser/eval'
import { READ_PAGE_DOM } from '../../src/services/browser/pageDom'

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

  it('单表达式包一层保证可返回', () => {
    expect(wrapEvalExpression('location.href')).toBe('(function(){ return (location.href); })()')
  })

  it('嵌套 return 仍把整段表达式返回，避免 all=true 拿到 null', () => {
    const script = "JSON.stringify([1].map(function(v){return v;}))"
    const wrapped = wrapEvalExpression(script)
    expect(wrapped).toContain('return (JSON.stringify')
    expect(wrapped).not.toContain('\nJSON.stringify')
  })

  it('顶层 const 包成函数体', () => {
    expect(wrapEvalExpression('const x = 1; return x')).toContain('(function(){')
    expect(wrapEvalExpression('const x = 1; return x')).not.toContain('return (const')
  })
})

describe('通用读页与框身份', () => {
  it('READ_PAGE_DOM 只带 url/title/html', () => {
    expect(READ_PAGE_DOM()).not.toMatch(/questionLi|catalogLi|workLi/)
    expect(READ_PAGE_DOM()).toMatch(/outerHTML/)
  })

  it('同源遍历带上框身份', () => {
    expect(SAME_ORIGIN_FRAMES).toMatch(/function __zeFrameOk/)
    expect(SAME_ORIGIN_FRAMES).toMatch(/data-mid/)
  })
})
