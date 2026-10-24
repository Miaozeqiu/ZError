import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const rust = readFileSync('src-tauri/src/cef/browser.rs', 'utf8')
const collector = rust.split('const COLLECT_DOM: &str = r#"')[1].split('"#;')[0]

describe('实际 DOM 补充快照', () => {
  it('同名控件保留不同身份，排除隐藏控件和只有 title 的静态文本', () => {
    const dom = new JSDOM('<body><button hidden>提交</button><button>提交</button><button disabled>提交</button><h3 title="吸虫作业">吸虫作业</h3><input type="checkbox" aria-label="选项A" checked></body>')
    const win = dom.window
    const style = win.getComputedStyle.bind(win)
    win.getComputedStyle = el => style(el)
    win.HTMLElement.prototype.getBoundingClientRect = function () {
      const hidden = this.hasAttribute('hidden')
      return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: hidden ? 0 : 100, height: hidden ? 0 : 20, toJSON() {} }
    }
    const rows = new Function('window', 'document', 'NodeFilter', `return ${collector}`)(win, win.document, win.NodeFilter)
    const submits = rows.filter((row: any) => row.name === '提交')
    expect(submits).toHaveLength(2)
    expect(new Set(submits.map((row: any) => row.locator.value)).size).toBe(2)
    for (const row of submits) expect(win.document.querySelector(row.locator.value)?.textContent).toBe('提交')
    expect(submits[1].disabled).toBe(true)
    expect(rows.some((row: any) => row.name === '吸虫作业')).toBe(false)
    expect(rows.find((row: any) => row.name === '选项A')).toMatchObject({ role: 'checkbox', checked: true })
    dom.window.close()
  })
})
