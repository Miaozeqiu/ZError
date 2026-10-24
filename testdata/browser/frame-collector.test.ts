import { readFileSync } from 'node:fs'
import { JSDOM, type DOMWindow } from 'jsdom'
import { describe, expect, it } from 'vitest'

// 测运行时实际使用的脚本，避免只验证另一份 TS 快照实现。
const rust = readFileSync('src-tauri/src/cef/browser.rs', 'utf8')
const collector = rust.split('const COLLECT_FRAMES: &str = r#"')[1].split('"#;')[0]
const install = (win: DOMWindow) => {
  Object.defineProperty(win.document, 'readyState', { configurable: true, get: () => 'complete' })
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.getAttribute('data-hidden') === '1'
    return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: hidden ? 0 : 100, height: hidden ? 0 : 40, toJSON() { return {} } }
  }
}
const frame = (doc: Document, html: string, hidden = false) => {
  const el = doc.createElement('iframe')
  if (hidden) el.setAttribute('data-hidden', '1')
  doc.body.appendChild(el)
  const child = el.contentDocument!
  child.open(); child.write(`<body>${html}</body>`); child.close()
  install(el.contentWindow as unknown as DOMWindow)
  return el
}
const collect = (dom: JSDOM) => new Function('window', 'document', `return ${collector}`)(dom.window, dom.window.document) as Array<{ path: string; hidden?: boolean; nodes: Array<{ name: string }> }>

describe('CEF 运行时嵌套 frame 发现', () => {
  it('大量隐藏框不挤掉后面的可见任务', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/study' })
    install(dom.window)
    for (let i = 0; i < 40; i++) frame(dom.window.document, '', true)
    frame(dom.window.document, '<button>目标任务</button>')
    expect(collect(dom).find(row => row.path === '40')?.nodes[0].name).toBe('目标任务')
    dom.window.close()
  })

  it('六层嵌套保留完整路径与目标内容', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/study' })
    install(dom.window)
    let doc = dom.window.document
    for (let i = 0; i < 6; i++) doc = frame(doc, '').contentDocument!
    doc.body.innerHTML = '<button>深层测验</button>'
    expect(collect(dom).find(row => row.path === '0/0/0/0/0/0')?.nodes[0].name).toBe('深层测验')
    dom.window.close()
  })

  it('iframe 中的密码值不会被当作输入框名称返回', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/study' })
    install(dom.window)
    frame(dom.window.document, '<input type="password" value="private-password">')
    expect(JSON.stringify(collect(dom))).not.toContain('private-password')
    dom.window.close()
  })
})
