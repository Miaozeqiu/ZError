import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

const collectScript = () => {
  const source = readFileSync(resolve(process.cwd(), 'src-tauri/src/cef/browser.rs'), 'utf8')
  const marker = 'const COLLECT_DOM: &str = r#"'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(0)
  const from = start + marker.length
  const end = source.indexOf('"\#;', from)
  expect(end).toBeGreaterThan(from)
  return source.slice(from, end)
}

describe('COLLECT_DOM 快照字段', () => {
  it('ckplayer 页面给出 video 行和完成/当前标记', () => {
    const html = readFileSync(resolve(process.cwd(), 'testdata/browser/fixtures/ckplayer-catalog.html'), 'utf8')
    const dom = new JSDOM(html, {
      url: 'https://www.zjooc.cn/plan',
      pretendToBeVisual: true,
      runScripts: 'dangerously',
    })
    const { window } = dom
    window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 320, height: 180, top: 0, left: 0, right: 320, bottom: 180, toJSON() { return {} },
    })
    const video = window.document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 1038.04 })
    Object.defineProperty(video, 'currentTime', { value: 7.4 })
    Object.defineProperty(video, 'paused', { value: false })
    Object.defineProperty(video, 'ended', { value: false })
    Object.defineProperty(video, 'readyState', { value: 4 })
    const script = window.document.createElement('script')
    script.textContent = `try { window.__zeNodes = (${collectScript()}); } catch (e) { window.__zeErr = String((e && e.stack) || e); }`
    window.document.body.appendChild(script)
    if (window.__zeErr) throw new Error(String(window.__zeErr))
    const nodes = window.__zeNodes as Array<{ role: string; name: string; media?: string; mark?: string }>
    const videoNode = nodes.find((node) => node.role === 'video')
    expect(videoNode?.name).toContain('概述')
    expect(videoNode?.media).toMatch(/^playing 0:07\/17:18$/)
    const lines = nodes.map((node) => {
      const media = node.media ? ` ${node.media}` : ''
      const mark = node.mark ? ` [${node.mark}]` : ''
      return `- ${node.role} "${node.name}"${media}${mark}`
    })
    expect(lines.join('\n')).toMatch(/- video ".*概述.*" playing 0:07\/17:18/)
    expect(lines.some((line) => line.includes('[done]') && line.includes('概述'))).toBe(true)
    expect(lines.some((line) => line.includes('[current]') && line.includes('成衣生产'))).toBe(true)
    expect(lines.some((line) => line.includes('[locked]'))).toBe(true)
    expect(nodes.some((node) => node.role === 'textbox' && node.name === '请输入用户名/手机号')).toBe(true)
    expect(nodes.some((node) => node.role === 'textbox' && node.name === 'password')).toBe(true)
  })
})
