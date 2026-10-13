import { JSDOM, type DOMWindow } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildLocateBoxScript } from '../../src/services/browser/engine/locate'
import { formatAriaSnapshot, SNAPSHOT_SCRIPT, type SnapFrameInfo } from '../../src/services/browser/engine/snapshot'
import type { PageRef } from '../../src/services/browser/engine/refs'

const install = (win: DOMWindow) => {
  win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const st = win.getComputedStyle(this)
    if (st.display === 'none' || st.visibility === 'hidden' || this.getAttribute('data-hidden') === '1') {
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {} } }
    }
    const left = Number(this.getAttribute('data-x') || 30)
    const top = Number(this.getAttribute('data-y') || 40)
    return { left, top, width: 120, height: 40, right: left + 120, bottom: top + 40, x: left, y: top, toJSON() { return {} } }
  }
}

const fill = (iframe: HTMLIFrameElement, html: string) => {
  const doc = iframe.contentDocument
  const view = iframe.contentWindow as DOMWindow | null
  if (!doc || !view) throw new Error('jsdom iframe 不可用')
  doc.open()
  doc.write(`<!doctype html><body>${html}</body>`)
  doc.close()
  install(view)
  return doc
}

describe('多层 iframe 快照', () => {
  it('两个视频的播放键都在，隐藏框不出现，题目页看得到，ref 能点回对应框', () => {
    const catalog = Array.from({ length: 120 }, (_, index) => `<button>目录${index}</button>`).join('')
    const dom = new JSDOM(`<!doctype html><body>${catalog}<iframe id="cards"></iframe><iframe id="cross" src="https://other.example/ad"></iframe></body>`, {
      url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1',
      runScripts: 'dangerously',
    })
    install(dom.window)
    const doc = dom.window.document
    const cards = doc.querySelector('#cards') as HTMLIFrameElement
    const cardsDoc = fill(cards, `
      <iframe id="v1" mid="m1"></iframe>
      <iframe id="v2" mid="m2"></iframe>
      <iframe id="renwu" style="display:none"></iframe>
      <iframe id="work"></iframe>
    `)
    fill(cardsDoc.querySelector('#v1') as HTMLIFrameElement, '<button title="播放">播放</button>')
    const v2 = fill(cardsDoc.querySelector('#v2') as HTMLIFrameElement, `
      <button title="播放" data-x="20">播放</button>
      <button title="播放" data-x="200">播放</button>
    `)
    fill(cardsDoc.querySelector('#renwu') as HTMLIFrameElement, '<button>幽灵</button>')
    const work = fill(cardsDoc.querySelector('#work') as HTMLIFrameElement, '<iframe id="quiz"></iframe>')
    fill(work.querySelector('#quiz') as HTMLIFrameElement, '<button>提交</button>')
    const cross = doc.querySelector('#cross') as HTMLIFrameElement
    Object.defineProperty(cross, 'contentWindow', { configurable: true, get() { throw new Error('cross-origin') } })

    const script = doc.createElement('script')
    script.textContent = `window.__zeSnap = ${SNAPSHOT_SCRIPT}`
    doc.body.appendChild(script)
    const raw = (dom.window as unknown as { __zeSnap: { refs: PageRef[]; iframes: SnapFrameInfo[] } }).__zeSnap
    const text = formatAriaSnapshot(raw.refs, raw.iframes)

    const plays = raw.refs.filter((ref) => ref.name === '播放')
    expect(plays.map((ref) => ref.locator.framePath)).toEqual(['0/0', '0/1', '0/1'])
    expect(plays.map((ref) => ref.locator.frame)).toEqual(['m1', 'm2', 'm2'])
    expect(plays[1].locator.nth).toBe(1)
    expect(plays[2].locator.nth).toBe(2)
    expect(text).toContain('[frame=0/0]')
    expect(text).toContain('[frame=0/1]')
    expect(text).toContain('提交')
    expect(text).toContain('cross-origin')
    expect(text).not.toContain('幽灵')
    expect(raw.refs.filter((ref) => String(ref.name).startsWith('目录')).length).toBeLessThanOrEqual(110)
    expect(v2.querySelectorAll('button').length).toBe(2)

    const locate = new Function('window', 'document', `return ${buildLocateBoxScript(plays[2].locator)}`)(
      dom.window,
      doc,
    ) as { ok?: boolean; x?: number }
    expect(locate.ok).toBe(true)
    // 按钮 data-x=200，再加上 cards / v2 两层 iframe 的偏移。
    expect(locate.x).toBe(320)
  })
})
