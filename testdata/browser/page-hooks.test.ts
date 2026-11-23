import { afterEach, describe, expect, it } from 'vitest'
import {
  claimClickText,
  guardNavigate,
  registerClickText,
  registerNavigateGuard,
} from '../../src/services/browser/pageHooks'
import { ensurePageBase } from '../../src/services/browser/pageDom'

afterEach(() => {
  registerNavigateGuard(null); registerClickText(null)
})

describe('pageHooks', () => {
  it('无钩子时放行任意网址', () => {
    registerNavigateGuard(null)
    expect(guardNavigate('https://example.com/visit/courses')).toBe('')
  })

  it('钩子可以拒绝开页', () => {
    registerNavigateGuard((url) => (url.includes('blocked') ? '禁止打开' : null))
    expect(guardNavigate('https://example.com/ok')).toBe('')
    expect(guardNavigate('https://example.com/blocked')).toBe('禁止打开')
    registerNavigateGuard(null)
  })

  it('点文案未认领则交给引擎', async () => {
    registerClickText(async (_id, text) => (text === '认领' ? { ok: true, text, via: 'hook' } : null))
    expect(await claimClickText('b1', '认领')).toEqual({ ok: true, text: '认领', via: 'hook' })
    expect(await claimClickText('b1', '普通按钮')).toBeNull()
    registerClickText(null)
  })


})

describe('pageDom', () => {
  it('缺 href 时用 about:blank，不写死站点', () => {
    const html = ensurePageBase('<head></head><body></body>', '')
    expect(html).toContain('href="about:blank"')
    expect(html).not.toContain('chaoxing.com')
  })
})
