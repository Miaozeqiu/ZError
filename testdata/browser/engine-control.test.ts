import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildControlScript } from '../../src/services/browser/engine/control'
import { normalizeCookieInput } from '../../src/services/browser/protocol'

const boot = (html: string) => {
  const dom = new JSDOM(html, { url: 'https://example.com/form' })
  const proto = dom.window.HTMLElement.prototype
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return { left: 20, top: 40, width: 80, height: 24, right: 100, bottom: 64, x: 20, y: 40, toJSON() { return {} } }
  }
  proto.scrollIntoView = () => {}
  const doc = dom.window.document
  doc.elementFromPoint = () => doc.querySelector('input, select, button, label')
  return dom
}

const run = (dom: JSDOM, script: string) => (
  new Function('window', 'document', `return ${script}`)(dom.window, dom.window.document) as Record<string, unknown>
)

describe('normalizeCookieInput', () => {
  it('丢掉没有 name 的项', () => {
    expect(normalizeCookieInput({ value: 'x' })).toBeNull()
  })

  it('只接受标准 sameSite', () => {
    expect(normalizeCookieInput({ name: 'a', value: '1', sameSite: 'Lax' })?.sameSite).toBe('Lax')
    expect(normalizeCookieInput({ name: 'a', value: '1', sameSite: 'weird' })?.sameSite).toBeUndefined()
  })
})

describe('控件脚本', () => {
  it('勾选未选中的 checkbox', () => {
    const dom = boot('<label><input id="ok" type="checkbox"> 同意</label>')
    const hit = run(dom, buildControlScript({ by: 'css', value: '#ok' }, 'check'))
    expect(hit.ok).toBe(true)
    expect(hit.checked).toBe(true)
    expect((dom.window.document.getElementById('ok') as HTMLInputElement).checked).toBe(true)
  })

  it('已勾选再 check 也成功', () => {
    const dom = boot('<input id="ok" type="checkbox" checked>')
    const hit = run(dom, buildControlScript({ by: 'css', value: '#ok' }, 'check'))
    expect(hit.ok).toBe(true)
    expect(hit.checked).toBe(true)
  })

  it('取消勾选', () => {
    const dom = boot('<input id="ok" type="checkbox" checked>')
    const hit = run(dom, buildControlScript({ by: 'css', value: '#ok' }, 'uncheck'))
    expect(hit.ok).toBe(true)
    expect(hit.checked).toBe(false)
  })

  it('按文案或 value 选下拉项', () => {
    const dom = boot('<select id="city"><option value="sh">上海</option><option value="bj">北京</option></select>')
    const byLabel = run(dom, buildControlScript({ by: 'css', value: '#city' }, 'select', '北京'))
    expect(byLabel.ok).toBe(true)
    expect(byLabel.value).toBe('bj')
    const byValue = run(dom, buildControlScript({ by: 'css', value: '#city' }, 'select', 'sh'))
    expect(byValue.ok).toBe(true)
    expect(byValue.text).toContain('上海')
  })

  it('选项不存在则失败', () => {
    const dom = boot('<select id="city"><option value="sh">上海</option></select>')
    const hit = run(dom, buildControlScript({ by: 'css', value: '#city' }, 'select', '广州'))
    expect(hit.ok).toBe(false)
    expect(String(hit.error || '')).toContain('没有这个选项')
  })
})
