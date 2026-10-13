import { describe, expect, it } from 'vitest'
import { isWaitTruthy, pageHostMatches, responseMatches } from '../../src/services/browser/engine'

describe('wait 真值', () => {
  it('普通 JS 真值', () => {
    expect(isWaitTruthy(true)).toBe(true)
    expect(isWaitTruthy(1)).toBe(true)
    expect(isWaitTruthy('ok')).toBe(true)
    expect(isWaitTruthy(false)).toBe(false)
    expect(isWaitTruthy(0)).toBe(false)
    expect(isWaitTruthy('')).toBe(false)
    expect(isWaitTruthy(null)).toBe(false)
  })

  it('带 ok 的对象跟 ok', () => {
    expect(isWaitTruthy({ ok: true })).toBe(true)
    expect(isWaitTruthy({ ok: false })).toBe(false)
    expect(isWaitTruthy({ ok: 0 })).toBe(false)
    expect(isWaitTruthy({ found: true })).toBe(true)
  })
})

describe('落地站', () => {
  it('忽略 www，认同站子域，不把记住的旧站当成打开成功', () => {
    expect(pageHostMatches('https://www.zjooc.cn/', 'https://zjooc.cn/login')).toBe(true)
    expect(pageHostMatches(
      'https://background.zjooc.cn/gxptLogin?redirect_url=https%3A%2F%2Fwww.zjooc.cn',
      'https://www.zjooc.cn/',
    )).toBe(true)
    expect(pageHostMatches('https://mooc1.chaoxing.com/mycourse/studentstudy', 'https://i.chaoxing.com/base')).toBe(true)
    expect(pageHostMatches('https://mooc1.chaoxing.com/mycourse/studentstudy', 'https://www.zjooc.cn/')).toBe(false)
    expect(pageHostMatches('', 'https://www.zjooc.cn/')).toBe(false)
  })
})

describe('response 匹配', () => {
  it('按 URL 子串，忽略大小写', () => {
    expect(responseMatches('https://api.example.com/login?x=1', '/login')).toBe(true)
    expect(responseMatches('https://API.example.com/Login', '/login')).toBe(true)
    expect(responseMatches('https://api.example.com/other', '/login')).toBe(false)
    expect(responseMatches('', '/login')).toBe(false)
    expect(responseMatches('https://x.com/a', '')).toBe(false)
  })
})
