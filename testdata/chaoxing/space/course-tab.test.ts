import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { courseTabFromHref } from '../../../src/services/platform/chaoxing/courseTab'
import { courseTabOf, noteCourseTab, resetCourseTab } from '../../../src/services/browser/siteGraph'
import { evalLocalApi, joinParts } from '../../../src/services/chaoxing/host/pageScript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/services/chaoxing/host/course')
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../course/shell.html')
const COURSE = 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=257080147&pageHeader=0'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html></html>')
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser
})

describe('课程壳解析器', () => {
  beforeEach(() => {
    resetCourseTab()
  })

  it('pageHeader=0 本身不是章节', () => {
    expect(courseTabFromHref(COURSE)).toBe('')
    expect(courseTabOf(COURSE)).toBe('任务')
    expect(courseTabOf('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=1')).toBe('章节')
  })

  it('解析卡出章节后，顶层还停在 pageHeader=0 也显示章节', () => {
    noteCourseTab('章节', 'probe', COURSE)
    expect(courseTabOf(COURSE)).toBe('章节')
  })

  it('侧栏选中章节时出课程卡，不要把章节测验当页签', () => {
    const api = evalLocalApi<{ parse: (doc: Document, href: string) => { ok: boolean; role: string; current: string; handles: Array<{ name?: string }> } }>(
      joinParts(readFileSync(resolve(root, 'helpers.js'), 'utf8'), readFileSync(resolve(root, 'parse.js'), 'utf8')),
      ['parse'],
    )
    const dom = new JSDOM(readFileSync(fixture, 'utf8'), { url: COURSE })
    const card = api.parse(dom.window.document, COURSE)
    expect(card.ok).toBe(true)
    expect(card.role).toBe('course')
    expect(card.current).toBe('章节')
    expect(card.handles?.map((item) => 'name' in item ? item.name : '')).toEqual([
      'task-tab',
      'chapter-tab',
      'homework-tab',
    ])
  })

  it('中间框地址是目录时，也认成章节', () => {
    expect(courseTabFromHref('https://mooc1.chaoxing.com/mycourse/studentcourse?courseid=1')).toBe('章节')
    expect(courseTabFromHref('https://mooc1.chaoxing.com/mooc2/active/stuActiveList?courseId=1')).toBe('任务')
    expect(courseTabFromHref('https://mooc1.chaoxing.com/mooc2/work/list?courseId=1')).toBe('作业')
  })
})
