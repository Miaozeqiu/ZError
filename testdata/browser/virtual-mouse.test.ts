import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { VIRTUAL_MOUSE_JS } from '../../src/services/browser/engine/virtualMouse'

const boot = () => {
  const dom = new JSDOM('<!doctype html><html><body><button id="go">确定</button></body></html>', {
    url: 'https://i.chaoxing.com/base',
  })
  new Function(
    'window',
    'document',
    `${VIRTUAL_MOUSE_JS}
    __zeMouseOn(document.getElementById('go'), 'click', '确定');
  `,
  )(dom.window, dom.window.document)
  return dom
}

describe('虚拟鼠标', () => {
  it('点按钮时在顶层画出指针和涟漪', () => {
    const dom = boot()
    const root = dom.window.document.getElementById('__ze_mouse_root')
    expect(root).toBeTruthy()
    expect(root?.querySelector('.ze-m')?.innerHTML).toContain('svg')
    expect(root?.querySelector('.ze-ring')?.classList.contains('is-on')).toBe(true)
    expect(root?.querySelector('.ze-chip')?.textContent).toBe('确定')
    expect(root?.querySelector('style')?.textContent).toContain('width:0')
    expect(root?.querySelector('style')?.textContent).not.toContain('inset:0')
  })

  it('藏起来后再 act 会重新显示', () => {
    const dom = boot()
    const win = dom.window as unknown as { __ZE_MOUSE__: { act: Function; cover: Function } }
    const root = dom.window.document.getElementById('__ze_mouse_root')
    win.__ZE_MOUSE__.cover(false)
    expect(root?.style.visibility).toBe('hidden')
    win.__ZE_MOUSE__.act('click', 40, 50, '播放')
    expect(root?.style.visibility).toBe('visible')
    expect(root?.querySelector('.ze-chip')?.textContent).toBe('播放')
  })
})
