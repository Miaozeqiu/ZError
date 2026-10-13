import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const HOOK = readFileSync(resolve(dir, '../../src-tauri/js/ze-tick.js'), 'utf8').replace(/__ZE_BINDING__/g, '__zeTest')

type Payload = Record<string, unknown>

const boot = (html: string) => {
  const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?x=1', runScripts: 'outside-only' })
  const win = dom.window as unknown as Window & Record<string, unknown>
  const got: Payload[] = []
  win.__zeTest = (raw: string) => { got.push(JSON.parse(raw)) }
  const proto = dom.window.HTMLElement.prototype
  proto.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: 320, height: 180, right: 320, bottom: 180, toJSON() { return {} },
  })
  dom.window.eval(HOOK)
  return { dom, win, got }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ze-tick 钩子', () => {
  it('挂上 video 后立刻推一次，duration 无效时用 window.duration', () => {
    const { dom, win, got } = boot('<video id="v"></video>')
    win.duration = 95
    const video = dom.window.document.getElementById('v') as HTMLVideoElement
    Object.defineProperty(video, 'currentTime', { value: 12, configurable: true })
    video.dispatchEvent(new dom.window.Event('play'))
    const last = got.at(-1)!
    expect(last.kind).toBe('video')
    expect(last.current).toBe(12)
    expect(last.duration).toBe(95)
    expect(last.visible).toBe(true)
    expect(last.hasVideo).toBe(true)
  })

  it('timeupdate 每条 video 各自节流，硬事件不节流', () => {
    const { dom, win, got } = boot('<video id="a"></video><video id="b"></video>')
    const a = dom.window.document.getElementById('a') as HTMLVideoElement
    const b = dom.window.document.getElementById('b') as HTMLVideoElement
    got.length = 0
    // 钩子在 jsdom 自己的 realm 里读 Date.now，vi 假时钟管不到，直接拨它的表
    const clock = { t: Date.now() + 1100 }
    ;(win.Date as unknown as { now: () => number }).now = () => clock.t
    a.dispatchEvent(new dom.window.Event('timeupdate'))
    a.dispatchEvent(new dom.window.Event('timeupdate'))
    b.dispatchEvent(new dom.window.Event('timeupdate'))
    expect(got).toHaveLength(2)
    a.dispatchEvent(new dom.window.Event('pause'))
    expect(got).toHaveLength(3)
    expect(got.at(-1)!.paused).toBe(true)
  })

  it('作业点选只推一条 changed，一次点选冒出的多个事件合并', async () => {
    vi.useFakeTimers()
    const { dom, got } = boot('<div class="questionLi"><label class="answerBg"><input type="radio"> A</label></div><p id="x">旁白</p>')
    got.length = 0
    const radio = dom.window.document.querySelector('input') as HTMLInputElement
    radio.checked = true
    radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    dom.window.document.querySelector('.answerBg')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(5)
    expect(got).toHaveLength(1)
    expect(got[0].kind).toBe('hw')
    expect(got[0].changed).toBe(true)
    expect(got[0].states).toEqual([{ index: 1, selected: 'A', filled: true }])
    dom.window.document.getElementById('x')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(5)
    expect(got).toHaveLength(1)
  })

  it('重复注入没有副作用，页上只多一个不可枚举守卫', () => {
    const { dom, win, got } = boot('<video id="v"></video>')
    const before = got.length
    dom.window.eval(HOOK)
    expect(got.length).toBe(before)
    const doc = dom.window.document as Document & Record<string, unknown>
    expect(Object.keys(win)).not.toContain('__zeTesti')
    expect(Object.keys(doc)).not.toContain('__zeTesti')
    expect(doc.__zeTesti).toBe(1)
    const video = dom.window.document.getElementById('v') as HTMLVideoElement & Record<string, unknown>
    expect(Object.keys(video).filter((key) => key.startsWith('__ze'))).toEqual([])
  })

  it('document-start 注入（<html> 还没建）时，后来建的 video 也能挂上', async () => {
    vi.useFakeTimers()
    const dom = new JSDOM('', { url: 'https://mooc1.chaoxing.com/ananas/modules/video/index.html', runScripts: 'outside-only' })
    const win = dom.window as unknown as Window & Record<string, unknown>
    const got: Payload[] = []
    win.__zeTest = (raw: string) => { got.push(JSON.parse(raw)) }
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, width: 320, height: 180, right: 320, bottom: 180, toJSON() { return {} },
    })
    const doc = dom.window.document
    doc.documentElement.remove()
    expect(doc.documentElement).toBeNull()
    dom.window.eval(HOOK)
    await vi.advanceTimersByTimeAsync(120)
    const html = doc.createElement('html')
    html.appendChild(doc.createElement('body'))
    doc.appendChild(html)
    await vi.advanceTimersByTimeAsync(120)
    doc.body.appendChild(doc.createElement('video'))
    await vi.advanceTimersByTimeAsync(300)
    expect(got.some((item) => item.kind === 'video')).toBe(true)
  })

  it('document.open()/write 重建内容后，旧观察器失效也能靠慢扫绑上 video', async () => {
    vi.useFakeTimers()
    const { dom, got } = boot('<div id="blank"></div>')
    got.length = 0
    const doc = dom.window.document
    doc.open()
    doc.write('<html><body><video id="v"></video></body></html>')
    doc.close()
    await vi.advanceTimersByTimeAsync(1600)
    expect(got.some((item) => item.kind === 'video')).toBe(true)
  })

  it('后来插入的 video 也会被挂上', async () => {
    vi.useFakeTimers()
    const { dom, got } = boot('<div id="host"></div>')
    got.length = 0
    const video = dom.window.document.createElement('video')
    dom.window.document.getElementById('host')!.appendChild(video)
    await vi.advanceTimersByTimeAsync(260)
    expect(got.some((item) => item.kind === 'video')).toBe(true)
  })
})
