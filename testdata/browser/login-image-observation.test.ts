// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const source = readFileSync('src-tauri/src/browser_login_observe.js', 'utf8')
const observe = new Function(`return (${source})`)() as (url: string, rules: unknown[]) => unknown[]
const draw = vi.fn()
const png = 'data:image/png;base64,Y2FwdGNoYQ=='
let image: HTMLImageElement
beforeEach(() => {
  document.body.innerHTML = '<img id="captcha"><input type="password" id="password">'
  image = document.querySelector('img')!
  vi.spyOn(image, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 105 }, naturalHeight: { value: 42 } })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png)
  draw.mockClear()
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const read = (selector = '#captcha') => observe(location.href, [{ kind: 'image', selector }])
it.each(['png', 'jpeg', 'webp', 'gif'])('returns pixels of a bounded inline %s captcha', type => {
  image.src = `data:image/${type};base64,Y2FwdGNoYQ==`
  expect(read()).toEqual([png])
  expect(draw).toHaveBeenCalledExactlyOnceWith(image, 0, 0)
})
it('uses a loaded image src when currentSrc is empty', () => {
  image.src = '/captcha.png'
  Object.defineProperty(image, 'currentSrc', { value: '' })
  expect(read()).toEqual([png])
})
it.each([
  'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  'data:text/html;base64,PGh0bWw+',
  'data:image/png;base64,' + 'A'.repeat(400000),
  'https://untrusted.example/captcha.png',
])('does not read disallowed or oversized sources', value => {
  image.src = value
  expect(read()).toEqual([false])
  expect(draw).not.toHaveBeenCalled()
})
it('never reads form values or draws input elements', () => {
  const input = document.querySelector('input')!
  vi.spyOn(input, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const value = vi.spyOn(input, 'value', 'get').mockImplementation(() => { throw new Error('must not read credentials') })
  expect(read('#password')).toEqual([false])
  expect(value).not.toHaveBeenCalled()
  expect(draw).not.toHaveBeenCalled()
})
