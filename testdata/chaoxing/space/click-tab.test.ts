import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { CHROME_HELPERS } from '../../../src/services/platform/chaoxing/chrome'
import { CLICK_FIND_HELPERS, clickLabelMatches } from '../../../src/services/platform/chaoxing/clickFind'
import { SAME_ORIGIN_FRAMES } from '../../../src/services/browser/eval'

const SPACE_TABS = `
  <div class="tab-item" coursetype="0">我教的课</div>
  <div class="tab-item" coursetype="1" data-id="student">我学的课</div>
  <a href="https://mooc1-1.chaoxing.com/visit/courses?del=1">已删除课程</a>
`

const findClick = (html: string, want: string) => {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://i.chaoxing.com/base',
  })
  return new Function(
    'window',
    'document',
    `${SAME_ORIGIN_FRAMES}
${CLICK_FIND_HELPERS}
    var el = __zeFindClick(${JSON.stringify(want)});
    if (!el) return null;
    return {
      text: String(el.textContent || '').replace(/\\s+/g, ''),
      id: el.getAttribute('data-id') || '',
      tag: String(el.tagName || ''),
    };
  `,
  )(dom.window, dom.window.document) as { text: string; id: string; tag: string } | null
}

const chromeName = (html: string) => {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://i.chaoxing.com/base',
  })
  return new Function(
    'document',
    `${CHROME_HELPERS}
    return Array.from(document.querySelectorAll('a, .tab-item')).map(function(el){
      return { text: String(el.textContent || '').replace(/\\s+/g, ''), name: __zeChromeName(el) };
    });
  `,
  )(dom.window.document) as { text: string; name: string }[]
}

describe('空间页签点击', () => {
  it('不把「已删除课程」当成「我学的课」', () => {
    const hit = findClick(SPACE_TABS, '我学的课')
    expect(hit?.text).toBe('我学的课')
    expect(hit?.id).toBe('student')
  })

  it('文案对不上就失败', () => {
    expect(clickLabelMatches('我学的课', '已删除课程')).toBe(false)
    expect(clickLabelMatches('我学的课', '我学的课')).toBe(true)
    expect(clickLabelMatches('我学的课', '已学的课')).toBe(true)
    expect(clickLabelMatches('章节', '章节测验')).toBe(false)
    expect(clickLabelMatches('章节', '章节')).toBe(true)
  })

  it('快照不把删除入口标成「我学的课」', () => {
    const names = chromeName(SPACE_TABS)
    expect(names.find((item) => item.text === '已删除课程')?.name).toBe('')
    expect(names.find((item) => item.text === '我学的课')?.name).toBe('我学的课')
  })

  it('visit/courses 链接不能当成「我学的课」', () => {
    const names = chromeName(`<a href="https://mooc1-1.chaoxing.com/visit/courses">外壳课程</a>`)
    expect(names.find((item) => item.text === '外壳课程')?.name).toBe('')
    const hit = findClick(
      `<a href="https://mooc1-1.chaoxing.com/visit/courses">我学的课</a><div class="tab-item" coursetype="1">我学的课</div>`,
      '我学的课',
    )
    expect(hit?.tag).toBe('DIV')
    expect(hit?.text).toBe('我学的课')
    expect(findClick(`<a href="https://mooc1-1.chaoxing.com/visit/courses">我学的课</a>`, '我学的课')).toBeNull()
  })

  it('课程侧栏「章节」不点任务列表里的章节测验', () => {
    const hit = findClick(
      `<div class="side"><a data-url="/mycourse/studentcourse?courseid=1" title="章节">章节</a></div>
       <iframe></iframe>
       <a class="activity">章节测验</a>`,
      '章节',
    )
    expect(hit?.text).toBe('章节')
    expect(hit?.text).not.toContain('测验')
  })

  it('没有 href 的 span 页签也能认出「我学的课」', () => {
    const dom = new JSDOM(
      `<!doctype html><html><body><span>我教的课</span><span>我学的课</span></body></html>`,
      { url: 'https://mooc1-1.chaoxing.com/visit/interaction?s=1' },
    )
    const names = new Function(
      'document',
      `${CHROME_HELPERS}
      return Array.from(document.querySelectorAll('span')).map(function(el){
        return { text: String(el.textContent || '').replace(/\\s+/g, ''), name: __zeChromeName(el) };
      });
    `,
    )(dom.window.document) as { text: string; name: string }[]
    expect(names.find((item) => item.text === '我学的课')?.name).toBe('我学的课')
    expect(names.find((item) => item.text === '我教的课')?.name).toBe('我教的课')
  })
})
