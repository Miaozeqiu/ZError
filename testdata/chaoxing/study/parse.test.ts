import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { LOCATE_CHAPTER } from '../../../src/services/chaoxing/study/cdpScripts'
import { scanStudyDocument } from '../../../src/services/chaoxing/study/parsePage'
import { studyParseApi, studyParseSource } from '../../../src/services/chaoxing/host/studyHost'

const dir = dirname(fileURLToPath(import.meta.url))

describe('study catalog parse', () => {
  it('宿主目录脚本仍能扫章节', () => {
    const source = studyParseSource()
    expect(source).toContain('function __zeScanOne')
    expect(source).toContain('function collectSteps')
  })

  it('player-tree.html 本地能读到未完成节', () => {
    const html = readFileSync(resolve(dir, 'player-tree.html'), 'utf8')
    const href = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=102'
    const dom = new JSDOM(html, { url: href })
    const snap = scanStudyDocument(dom.window.document, href)
    expect(snap?.page).toBe('player')
    expect(snap?.chapters?.some((item) => item.title.includes('极限的定义') && item.unfinished)).toBe(true)
    expect(snap?.unfinished?.some((title) => title.includes('极限的定义'))).toBe(true)
  })

  it('helpers 和 locate 用同一套 __cxFindChapterEl', () => {
    const html = readFileSync(resolve(dir, 'player-tree.html'), 'utf8')
    const dom = new JSDOM(html)
    const proto = dom.window.HTMLElement.prototype as HTMLElement & {
      getBoundingClientRect: () => DOMRect
    }
    proto.getBoundingClientRect = () => ({
      x: 10, y: 10, left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, toJSON() { return {} },
    })
    const el = studyParseApi().__cxFindChapterEl(dom.window.document, '极限的定义')
    expect(el?.textContent).toContain('极限的定义')
    const hit = new Function('document', 'window', `return ${LOCATE_CHAPTER('极限的定义')};`)(
      dom.window.document,
      dom.window,
    ) as { found?: boolean; text?: string }
    expect(hit.found).toBe(true)
    expect(hit.text).toContain('极限的定义')
  })
})
