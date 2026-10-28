// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const source = readFileSync(resolve('src-tauri/src/cef/browser.rs'), 'utf8')
const extract = (start: string) => new Function(`return (${source.slice(source.indexOf(start)).match(/"functionDeclaration":\s*r#"([\s\S]*?)"#/)[1]})`)()
const hit = extract('pub(crate) async fn click_landed_elsewhere(')
const visible = extract('pub(crate) async fn visible_control_backend(')
const box = { left: 620.01, top: 526.75, width: 287.46, height: 26 }
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
describe('actual DOM hit testing in target CSS space', () => {
  it('accepts nested text spans inside the target without relying on parentId or DPR', () => {
    document.body.innerHTML = '<label><span><p>选项文字</p></span></label>'
    const target = document.querySelector('label')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(box as DOMRect)
    const point = vi.fn().mockReturnValue(document.querySelector('p'))
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: point })
    expect(hit.call(target)).toBeNull()
    expect(point).toHaveBeenCalledWith(763.74, 539.75)
  })
  it('rejects an unrelated overlay even if its box is within the target', () => {
    document.body.innerHTML = '<button>目标</button><div>遮罩</div>'
    const target = document.querySelector('button')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(box as DOMRect)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.querySelector('div') })
    expect(hit.call(target)).toContain('遮挡')
  })
  it('retargets hidden input and decorative inner spans to the visible checkbox label', () => {
    document.body.innerHTML = '<label><span class="inner"></span><input type="checkbox" style="opacity:0;width:0;height:0"></label>'
    const label = document.querySelector('label')!
    expect(visible.call(document.querySelector('input'))).toBe(label)
    expect(visible.call(document.querySelector('.inner'))).toBe(label)
    document.body.innerHTML = '<label for="a">选项</label><input id="a" type="radio">'
    const associated = document.querySelector('label')!
    vi.spyOn(associated, 'getBoundingClientRect').mockReturnValue(box as DOMRect)
    expect(visible.call(document.querySelector('input'))).toBe(associated)
  })
  it('delegates explicit checkbox wrappers, while retaining generic navigation/question targets', () => {
    document.body.innerHTML = '<div class="option" role="checkbox"><label><input type="checkbox">选项</label></div>'
    expect(visible.call(document.querySelector('.option'))).toBe(document.querySelector('label'))
    document.body.innerHTML = '<div class="chapter"><label><input type="checkbox">任务点</label></div>'
    expect(visible.call(document.querySelector('.chapter'))).toBe(document.querySelector('.chapter'))
    document.body.innerHTML = '<div class="question"><label><input type="checkbox">A</label><label><input type="checkbox">B</label></div>'
    expect(visible.call(document.querySelector('.question'))).toBe(document.querySelector('.question'))
  })
})
