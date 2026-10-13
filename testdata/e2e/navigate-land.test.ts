import { describe, expect, it } from 'vitest'
import { pageHostMatches, pageHostOf } from '../../src/services/browser/engine/wait'

describe('导航落地', () => {
  it('eval 失败时仍可用 state 上的同站子域判定打开成功', () => {
    const fromEval = ''
    const fromState = 'https://background.zjooc.cn/gxptLogin?redirect_url=https%3A%2F%2Fwww.zjooc.cn'
    const landed = fromEval || fromState
    const target = 'https://www.zjooc.cn/'
    expect(pageHostMatches(landed, target)).toBe(true)
    expect(pageHostOf(landed)).not.toBe(pageHostOf(target))
  })
})