import { JSDOM, type DOMWindow } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { WISDOM_MOOC_STUDY_SCRIPT, isWisdomMoocStudyUrl } from '../../src/services/platform/zhihuishu/study'

const url = 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=test'
const windows: DOMWindow[] = []
const setup = (html: string, href = url) => {
  const dom = new JSDOM(html, { url: href, runScripts: 'outside-only' })
  const win = dom.window
  windows.push(win)
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    let visible = true
    for (let el: HTMLElement | null = this; el; el = el.parentElement) {
      if (el.hidden || win.getComputedStyle(el).display === 'none') visible = false
    }
    const size = visible ? 100 : 0
    return { x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size, toJSON: () => ({}) }
  }
  win.HTMLElement.prototype.getClientRects = function () {
    const rect = this.getBoundingClientRect()
    return (rect.width ? [rect] : []) as unknown as DOMRectList
  }
  return win
}

afterEach(() => {
  windows.splice(0).forEach((win) => win.close())
})

describe('智慧慕课播放页只读解析', () => {
  it('按叶子计数，区分完成/当前；折叠目录仍能读取，但不提供隐藏行点击', () => {
    const win = setup(`<div class="chapter-content">
      <div class="chapter-item">第七章
        <div class="chapter-content-second"><i class="finish-icon"></i>7.2.1 海外收藏</div>
        <div class="chapter-content-second current">7.2.2 海外影响</div>
      </div>
      <div style="display:none"><div class="chapter-item">8.1 尚未学习</div></div>
    </div>`)
    const card = win.eval(WISDOM_MOOC_STUDY_SCRIPT)
    expect(card.progress).toEqual({ done: 1, total: 3, source: 'page-markers' })
    expect(card.current).toBe('7.2.2 海外影响')
    expect(card.next).toBe('7.2.2 海外影响')
    expect(card.handles).toHaveLength(2)
    for (const handle of card.handles) expect(win.document.querySelector(handle.selector)?.textContent?.trim()).toBe(handle.label)
  })

  it('折叠章给出真实展开按钮，当前标记按页面 current 类识别', () => {
    const win = setup(`<div class="el-collapse-item">
      <button class="el-collapse-item__header" aria-expanded="false">第一章</button>
      <div class="el-collapse-item__wrap" style="display:none"><div class="chapter-content">
        <div class="chapter-item"><div class="item-box current"><i class="finish-icon"></i>1.1 单级小节</div></div>
      </div></div></div>`)
    const card = win.eval(WISDOM_MOOC_STUDY_SCRIPT)
    expect(card.current).toBe('1.1 单级小节')
    expect(card.handles).toHaveLength(1)
    expect(card.handles[0].expandSelectors).toHaveLength(1)
    expect(win.document.querySelector(card.handles[0].expandSelectors[0])?.getAttribute('aria-expanded')).toBe('false')
    win.document.querySelector('button')!.setAttribute('aria-expanded', 'true')
    win.document.querySelector('.el-collapse-item__wrap')!.removeAttribute('style')
    expect(win.eval(WISDOM_MOOC_STUDY_SCRIPT).handles[0].expandSelectors).toEqual([])
  })

  it('随堂题消失不等于视频恢复，也不等于平台保存完成', () => {
    const win = setup('<video></video><div class="ai-class-exercise-dialog"><div class="question-title">判断题</div><button>提交作答</button></div>')
    const video = win.document.querySelector('video')!
    Object.defineProperties(video, {
      duration: { value: 100 }, currentTime: { value: 25 }, paused: { value: true }, ended: { value: false },
    })
    let card = win.eval(WISDOM_MOOC_STUDY_SCRIPT)
    expect(card.questions[0].title).toBe('判断题')
    expect(card.hint).toContain('随堂练习')
    win.document.querySelector('.ai-class-exercise-dialog')!.setAttribute('style', 'display:none')
    card = win.eval(WISDOM_MOOC_STUDY_SCRIPT)
    expect(card.questions).toHaveLength(0)
    expect(card.video.paused).toBe(true)
    expect(card.hint).toContain('暂停')
    expect(card.progress.done).toBe(0)
  })

  it('媒体结束不会替目录补写完成；解析本身不修改页面', () => {
    const win = setup('<div class="chapter-content"><div class="chapter-item active">最后一节</div></div><video></video>')
    const video = win.document.querySelector('video')!
    Object.defineProperties(video, { duration: { value: 100 }, currentTime: { value: 100 }, ended: { value: true } })
    const before = win.document.body.innerHTML
    const card = win.eval(WISDOM_MOOC_STUDY_SCRIPT)
    expect(card.video.ended).toBe(true)
    expect(card.progress.done).toBe(0)
    expect(card.hint).toContain('刷新页面复核')
    expect(win.document.body.innerHTML).toBe(before)
  })

  it('限定精确站点/路径，不能套用学习通或同名恶意域名', () => {
    expect(isWisdomMoocStudyUrl(url)).toBe(true)
    for (const href of ['ftp://wisdom-mooc.zhihuishu.com/study/index', 'https://wisdom-mooc.zhihuishu.com.evil.test/study/index', 'https://wisdom-mooc.zhihuishu.com/study/analysis', 'https://mooc1.chaoxing.com/study/index']) {
      expect(isWisdomMoocStudyUrl(href)).toBe(false)
      expect(setup('<div class="chapter-content-second">同名组件</div>', href).eval(WISDOM_MOOC_STUDY_SCRIPT)).toBeNull()
    }
  })

})
