import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { CLICK_SPACE_TAB, READ_SPACE_LIST, isSpaceListTopUrl } from '../../../src/services/browser/engine/spaceTab'

const boot = () => {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <a href="https://mooc1-1.chaoxing.com/visit/courses">外壳课程</a>
      <iframe id="frame_content"></iframe>
    </body></html>`,
    { url: 'https://i.chaoxing.com/base' },
  )
  const frame = dom.window.document.querySelector('iframe') as HTMLIFrameElement
  Object.defineProperty(frame, 'src', {
    writable: true,
    configurable: true,
    value: 'https://mooc1-1.chaoxing.com/visit/interaction?s=abc',
  })
  frame.contentDocument!.body.innerHTML = `
    <div class="box clearfix">
      <div class="content">
        <div class="main">
          <div class="course-tab">
            <div class="tab-item" coursetype="0">我教的课</div>
            <div class="tab-item" coursetype="1">我学的课</div>
          </div>
        </div>
      </div>
    </div>
  `
  return { dom, frame }
}

describe('空间页签', () => {
  it('点 iframe 里的 .tab-item[coursetype=1]，不改框地址，不顶层跳转', () => {
    const { dom, frame } = boot()
    let clicked = ''
    frame.contentDocument!.querySelectorAll('.tab-item').forEach((el) => {
      el.addEventListener('click', () => {
        clicked = String(el.getAttribute('coursetype') || '')
      })
    })
    const srcBefore = frame.src
    const topBefore = dom.window.location.href
    const result = new Function('document', `return ${CLICK_SPACE_TAB('student')}`)(dom.window.document) as {
      ok?: boolean
      clicked?: boolean
      type?: string
      from?: string
    }
    expect(result.ok).toBe(true)
    expect(result.clicked).toBe(true)
    expect(result.type).toBe('1')
    expect(result.from).toBe('iframe')
    expect(clicked).toBe('1')
    expect(frame.src).toBe(srcBefore)
    expect(dom.window.location.href).toBe(topBefore)
  })

  it('不点外壳容器，只点真正的 .tab-item', () => {
    const { dom, frame } = boot()
    const hits: string[] = []
    frame.contentDocument!.querySelectorAll('.box, .content, .main, .course-tab, .tab-item').forEach((el) => {
      el.addEventListener('click', (event) => {
        if (event.target === el) hits.push(String(el.className || ''))
      })
    })
    const result = new Function('document', `return ${CLICK_SPACE_TAB('student')}`)(dom.window.document) as {
      ok?: boolean
      type?: string
    }
    expect(result.ok).toBe(true)
    expect(result.type).toBe('1')
    expect(hits.some((cls) => /\btab-item\b/.test(cls))).toBe(true)
    expect(hits.some((cls) => cls === 'box clearfix' || cls === 'course-tab')).toBe(false)
  })

  it('顶层 visit/courses 仍禁止 navigate', () => {
    expect(isSpaceListTopUrl('https://mooc1-1.chaoxing.com/visit/courses?s=1')).toBe(true)
    expect(isSpaceListTopUrl('https://i.chaoxing.com/base')).toBe(false)
  })

  it('页签看 iframe 里的 .tab-item.current，不看外壳 src', () => {
    const { dom, frame } = boot()
    const student = frame.contentDocument!.querySelector('.tab-item[coursetype="1"]') as HTMLElement
    student.classList.add('current')
    const result = new Function('document', `return ${READ_SPACE_LIST}`)(dom.window.document) as {
      tab?: string
      via?: string
    }
    expect(result.tab).toBe('我学的课')
    expect(result.via).toBe('doc')
    expect(frame.src).toContain('visit/interaction')
  })

  it('框里没有当前页签时，不把残留 src 当成我教的课', () => {
    const { dom, frame } = boot()
    const result = new Function('document', `return ${READ_SPACE_LIST}`)(dom.window.document) as {
      tab?: string
      ok?: boolean
    }
    expect(result.tab).toBe('')
    expect(result.ok).toBe(false)
    expect(frame.src).toContain('visit/interaction')
  })
})
