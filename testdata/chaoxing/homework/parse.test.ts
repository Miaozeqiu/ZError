import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { homeworkCaptureScript } from '../../../src/services/parser/homeworkRuntime'
import {
  enrichQuestionsFromLiveText,
  homeworkQuestionsHollow,
  parseHomeworkDocument,
  questionHasContent,
} from '../../../src/services/chaoxing/homework/parse'

const dir = dirname(fileURLToPath(import.meta.url))
const helpersSrc = readFileSync(
  resolve(dir, '../../../src/services/agent/skills/bundled/chaoxing/parsers/homework/helpers.js'),
  'utf8',
)
const parseSrc = [
  helpersSrc,
  readFileSync(
    resolve(dir, '../../../src/services/agent/skills/bundled/chaoxing/parsers/homework/parse.js'),
    'utf8',
  ),
].join('\n')

type HwApi = {
  __hwParseQuestions: (doc: Document) => Array<{
    id: string
    index: number
    type: string
    stem: string
    filled: boolean
    images?: string[]
    options: Array<{ letter: string; text: string; selected: boolean; images?: string[] }>
  }> & { total?: number; truncated?: boolean }
  __hwParseWorks: (doc: Document, href?: string) => Array<{ title: string; status: string }>
  __hwPickedOf: (box: Element) => string
  __hwPageOf: (href: string, text: string, questions: unknown[], works: unknown[]) => string
  __hwBoxes: (doc: Document) => Element[]
  __hwFindOption: (box: Element, want: string) => { el: Element; letter: string } | null
}

const load = (html: string): { api: HwApi; document: Document } => {
  const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/work/do' })
  const api = new Function(`${parseSrc}\nreturn { __hwParseQuestions, __hwParseWorks, __hwPickedOf, __hwPageOf, __hwBoxes, __hwFindOption };`)() as HwApi
  return { api, document: dom.window.document }
}

describe('homework parse fixtures', () => {
  it('list.html 只认作业名和未交', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'list.html'), 'utf8'))
    const works = api.__hwParseWorks(document, 'https://mooc2-ans.chaoxing.com/mooc2/work/list')
    expect(works.map((item) => item.title)).toEqual([
      '高等数学第一章作业',
      '章节测验',
      '线性代数作业',
    ])
    expect(works.find((item) => item.title === '高等数学第一章作业')?.status).toBe('待做')
    expect(works.find((item) => item.title === '章节测验')?.status).toBe('已完成')
    expect(works.some((item) => item.title === '作业' || item.title === '章节')).toBe(false)
    expect(api.__hwParseQuestions(document)).toHaveLength(0)
  })

  it('do.html 题号用盒序，选中态与 inspect/stash 同源', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'do.html'), 'utf8'))
    const questions = api.__hwParseQuestions(document)
    expect(questions).toHaveLength(4)
    expect(questions.map((item) => item.index)).toEqual([1, 2, 3, 4])
    expect(questions.map((item) => item.id)).toEqual(['q-101', 'q-102', 'q-103', 'q-104'])
    expect(questions[0].stem).toContain('极限的定义')
    expect(questions[0].stem).not.toMatch(/^3/)
    expect(questions[0].type).toBe('single')
    expect(questions[0].options[0].selected).toBe(true)
    expect(questions[1].type).toBe('multi')
    expect(questions[1].options.filter((item) => item.selected).map((item) => item.letter)).toEqual(['B'])
    expect(questions[2].type).toBe('judge')
    expect(questions[2].options.map((item) => item.letter)).toEqual(['A', 'B'])
    expect(questions[3].type).toBe('blank')
    expect(questions[3].filled).toBe(true)
    const boxes = api.__hwBoxes(document)
    expect(api.__hwPickedOf(boxes[0])).toBe('A')
    expect(api.__hwPickedOf(boxes[1])).toBe('B')
    expect(api.__hwPageOf('https://mooc1.chaoxing.com/work/do', '', questions, [])).toBe('do')
  })

  it('view.html 认成已交页', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'view.html'), 'utf8'))
    const questions = api.__hwParseQuestions(document)
    const text = document.body.textContent || ''
    expect(api.__hwPageOf('https://mooc1.chaoxing.com/work/view', text, questions, [])).toBe('view')
    expect(questions[0].options[0].selected).toBe(true)
  })

  it('formula.html 保留 chaoxing 公式图和选项 LaTeX', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'formula.html'), 'utf8'))
    const questions = api.__hwParseQuestions(document)
    expect(questions).toHaveLength(3)
    expect(questions[0].images?.some((src) => /ananas\.chaoxing\.com/.test(src || ''))).toBe(true)
    expect(questions[0].options.map((item) => item.text)).toEqual(['∞', '0'])
    expect(questions[1].stem).toContain('下列极限不等于1的是')
    expect(questions[1].options[0].text).toContain('x^2')
    expect(questions[1].options[0].images?.some((src) => /ananas\/latex/.test(src || ''))).toBe(true)
    expect(questions[1].options[1].text).toBe('极限不存在')
    expect(questions[2].images?.some((src) => /chaoxing\.com/.test(src || ''))).toBe(true)
    expect(questions[2].options[0].text).toBe('∞')
    expect(questions[2].options[0].images?.some((src) => /chaoxing\.com/.test(src || ''))).toBe(true)
    expect(questions[2].options[1].images?.some((src) => /ananas\/latex/.test(src || ''))).toBe(true)
  })

  it('chapter-quiz.html 有题且不是列表', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'chapter-quiz.html'), 'utf8'))
    const questions = api.__hwParseQuestions(document)
    const works = api.__hwParseWorks(document, 'https://mooc1.chaoxing.com/mycourse/studentstudy')
    expect(questions).toHaveLength(1)
    expect(questions[0].stem).toContain('章节测验题干')
    expect(works).toHaveLength(0)
    expect(api.__hwPageOf('https://mooc1.chaoxing.com/mycourse/studentstudy', '', questions, works)).toBe('do')
  })

  it('空题干空选项不算有内容，直播正文能补选项字', () => {
    const hollow = [{
      id: '1',
      index: 1,
      type: 'single',
      typeName: '单选题',
      stem: '(      )',
      options: [
        { letter: 'A', text: '', selected: false },
        { letter: 'B', text: '', selected: false },
        { letter: 'C', text: '', selected: false },
        { letter: 'D', text: '', selected: false },
      ],
    }]
    expect(homeworkQuestionsHollow(hollow)).toBe(true)
    expect(questionHasContent(hollow[0])).toBe(false)
    const filled = enrichQuestionsFromLiveText(hollow, [
      { i: 1, t: '1. (单选题) ( ) A ∞ B 0 C 1 D n' },
    ])
    expect(filled[0].options.map((item) => item.text)).toEqual(['∞', '0', '1', 'n'])
    expect(questionHasContent(filled[0])).toBe(true)
  })

  it('作业包 capture 由 runtime 拼 helpers，不走 page()', () => {
    const script = homeworkCaptureScript()
    expect(script).toContain('function capture')
    expect(script).toContain('__hwBoxes')
    expect(parseSrc).toContain('__hwSkipImgSrc')
    expect(parseSrc).toContain('__hwRichText')
    expect(parseSrc).toContain('__hwImgSrc')
  })

  it('本地 parseHomeworkDocument 不依赖注入页面', () => {
    const html = readFileSync(resolve(dir, 'formula.html'), 'utf8')
    const href = 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?workId=1'
    const dom = new JSDOM(html, { url: href })
    const parsed = parseHomeworkDocument(dom.window.document, href)
    expect(parsed.questions).toHaveLength(3)
    expect(parsed.page).toBe('do')
    expect(parsed.questions[0].images?.some((src) => /ananas/.test(src || ''))).toBe(true)
    expect(parsed.questions[2].options[0].text).toBe('∞')
  })

  it('studentstudy 目录页不当作业列表', () => {
    const href = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'
    const html = `<html><body>
      <a href="/work/xxx">4.4 第二换元积分法</a>
      <div>已完成</div>
      <ul class="bottomList"><li><a href="/foo">1.1 函数（一）</a></li></ul>
    </body></html>`
    const { api, document } = load(html)
    // load() forces work/do url — reparse with studentstudy
    const works = api.__hwParseWorks(document, href)
    expect(works).toEqual([])
    expect(api.__hwPageOf(href, '章节详情 目录', [], [])).toBe('other')
  })

  it('章节测验 Zy_ulTop 图选项能解析出 A-D', () => {
    const html = readFileSync(resolve(dir, 'chapter-quiz-zy.html'), 'utf8')
    const href = 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew'
    const dom = new JSDOM(html, { url: href })
    const api = new Function(`${parseSrc}\nreturn { __hwParseQuestions };`)() as HwApi
    const questions = api.__hwParseQuestions(dom.window.document)
    expect(questions.length).toBeGreaterThanOrEqual(1)
    expect(questions[0].options.map((o) => o.letter)).toEqual(['A', 'B', 'C', 'D'])
    expect(questions[0].options.filter((o) => o.images?.length || o.image || o.text).length).toBeGreaterThanOrEqual(3)
  })

  it('locate 和 parse 共用 helpers：第 1 题 A 能再次找到', () => {
    const { api, document } = load(readFileSync(resolve(dir, 'do.html'), 'utf8'))
    const boxes = api.__hwBoxes(document)
    const questions = api.__hwParseQuestions(document)
    expect(questions[0].options[0].letter).toBe('A')
    const hit = api.__hwFindOption(boxes[0], 'A')
    expect(hit?.letter).toBe('A')
    expect(hit?.el).toBeTruthy()
    expect(api.__hwFindOption(boxes[1], 'B')?.letter).toBe('B')
  })

  it('章节测验 locate 也能按字母找到选项', () => {
    const html = readFileSync(resolve(dir, 'chapter-quiz-zy.html'), 'utf8')
    const { api, document } = load(html)
    const boxes = api.__hwBoxes(document)
    expect(boxes.length).toBeGreaterThanOrEqual(1)
    expect(api.__hwFindOption(boxes[0], 'A')?.letter).toBe('A')
    expect(api.__hwFindOption(boxes[0], 'D')?.letter).toBe('D')
  })
})
