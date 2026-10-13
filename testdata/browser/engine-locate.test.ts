import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { clickLabelMatches, siteSelectorsForText } from '../../src/services/browser/engine/clickFind'
import { locatorScriptArg } from '../../src/services/browser/engine/types'
import {
  buildLocateBoxScript,
  isRetryableReason,
  locatorsToTry,
} from '../../src/services/browser/engine/locate'

const boot = (html: string) => {
  const dom = new JSDOM(html, { url: 'https://example.com/page' })
  const proto = dom.window.HTMLElement.prototype
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const hidden = this.getAttribute('data-hidden') === '1' || this.style.display === 'none'
    if (hidden) {
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {} } }
    }
    const left = Number(this.getAttribute('data-x') || 20)
    const top = Number(this.getAttribute('data-y') || 40)
    return { left, top, width: 80, height: 24, right: left + 80, bottom: top + 24, x: left, y: top, toJSON() { return {} } }
  }
  proto.scrollIntoView = () => {}
  const doc = dom.window.document
  doc.elementFromPoint = (x: number, y: number) => {
    const nodes = [...doc.querySelectorAll('button, a, [title], input')]
    return nodes.find((el) => {
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }) || nodes[0] || null
  }
  return dom
}

const runLocate = (dom: JSDOM, locator: Parameters<typeof buildLocateBoxScript>[0]) => (
  new Function(
    'window',
    'document',
    `return ${buildLocateBoxScript(locator)}`,
  )(dom.window, dom.window.document) as Record<string, unknown>
)

describe('站点选择器与等待语义', () => {
  it('引擎不带站点 CSS，文案只按 locator 本身', () => {
    expect(siteSelectorsForText('作业')).toEqual([])
    expect(siteSelectorsForText('章节')).toEqual([])
    expect(siteSelectorsForText('下一节')).toEqual([])
    expect(siteSelectorsForText('确定')).toEqual([])
  })

  it('CDP find 吃结构化 locator，不带脚本', () => {
    expect(locatorScriptArg({ by: 'text', value: '确定', nth: 2, frame: 'cards' })).toEqual({
      by: 'text',
      value: '确定',
      name: '',
      exact: false,
      nth: 2,
      frame: 'cards',
      framePath: '',
    })
  })

  it('文案 locator 不再先试站点 CSS', () => {
    expect(locatorsToTry({ by: 'text', value: '作业' })).toEqual([{ by: 'text', value: '作业' }])
    expect(locatorsToTry({ by: 'css', value: '#loginBtn' })).toEqual([{ by: 'css', value: '#loginBtn' }])
    expect(locatorsToTry({ by: 'text', value: '确定', nth: 2, frame: 'inner' })).toEqual([
      { by: 'text', value: '确定', nth: 2, frame: 'inner' },
    ])
  })

  it('not_found/hidden/covered 可再等，ambiguous/disabled 立刻失败', () => {
    expect(isRetryableReason('not_found')).toBe(true)
    expect(isRetryableReason('hidden')).toBe(true)
    expect(isRetryableReason('covered')).toBe(true)
    expect(isRetryableReason('unstable')).toBe(true)
    expect(isRetryableReason('ambiguous')).toBe(false)
    expect(isRetryableReason('disabled')).toBe(false)
    expect(isRetryableReason('invalid')).toBe(false)
  })

  it('通用文案精确匹配，前缀不算站点别名', () => {
    expect(clickLabelMatches('作业', '作业')).toBe(true)
    expect(clickLabelMatches('作业', '删除作业')).toBe(false)
    expect(clickLabelMatches('确定', '确定')).toBe(true)
  })
})

describe('定位脚本', () => {
  it('按 CSS 返回顶层坐标', () => {
    const dom = boot('<button id="go" title="章节">章节</button>')
    const hit = runLocate(dom, { by: 'css', value: '#go' })
    expect(hit.ok).toBe(true)
    expect(hit.x).toBe(60)
    expect(hit.y).toBe(52)
    expect(hit.space).toBe('page')
    expect(hit.text).toMatch(/章节/)
  })

  it('按文案找到按钮', () => {
    const dom = boot('<button>下一节</button>')
    const hit = runLocate(dom, { by: 'text', value: '下一节' })
    expect(hit.ok).toBe(true)
    expect(hit.text).toContain('下一节')
  })

  it('不可见 → hidden 且可重试', () => {
    const dom = boot('<button id="go" data-hidden="1">章节</button>')
    const hit = runLocate(dom, { by: 'css', value: '#go' })
    expect(hit.ok).toBe(false)
    expect(hit.reason).toBe('hidden')
    expect(hit.retry).toBe(true)
  })

  it('禁用 → disabled 且不可重试', () => {
    const dom = boot('<button id="go" disabled>提交</button>')
    const hit = runLocate(dom, { by: 'css', value: '#go' })
    expect(hit.ok).toBe(false)
    expect(hit.reason).toBe('disabled')
    expect(hit.retry).toBe(false)
  })

  it('两个同文案按钮 → ambiguous', () => {
    const dom = boot('<button data-x="10">确定</button><button data-x="200">确定</button>')
    const hit = runLocate(dom, { by: 'text', value: '确定' })
    expect(hit.ok).toBe(false)
    expect(hit.reason).toBe('ambiguous')
    expect(hit.retry).toBe(false)
  })

  it('找不到 → not_found 且可重试', () => {
    const dom = boot('<button>取消</button>')
    const hit = runLocate(dom, { by: 'text', value: '确定' })
    expect(hit.ok).toBe(false)
    expect(hit.reason).toBe('not_found')
    expect(hit.retry).toBe(true)
  })

  it('nth 从 1 消歧同文案', () => {
    const dom = boot('<button data-x="10">确定</button><button data-x="200" id="second">确定</button>')
    const first = runLocate(dom, { by: 'text', value: '确定', nth: 1 })
    const second = runLocate(dom, { by: 'text', value: '确定', nth: 2 })
    const miss = runLocate(dom, { by: 'text', value: '确定', nth: 3 })
    expect(first.ok).toBe(true)
    expect(first.x).toBe(50)
    expect(second.ok).toBe(true)
    expect(second.x).toBe(240)
    expect(miss.ok).toBe(false)
    expect(miss.reason).toBe('not_found')
  })

  it('exact 不吃前缀', () => {
    const dom = boot('<button>确定提交</button>')
    const fuzzy = runLocate(dom, { by: 'text', value: '确定' })
    const exact = runLocate(dom, { by: 'text', value: '确定', exact: true })
    expect(fuzzy.ok).toBe(true)
    expect(exact.ok).toBe(false)
    expect(exact.reason).toBe('not_found')
  })

  it('frame 只在指定 iframe 里找', () => {
    const dom = boot('<button>顶层</button><iframe id="inner" data-x="0" data-y="0"></iframe>')
    const iframe = dom.window.document.querySelector('iframe') as HTMLIFrameElement | null
    const idoc = iframe?.contentDocument
    if (!idoc || !iframe?.contentWindow) throw new Error('jsdom iframe 不可用')
    idoc.open()
    idoc.write('<button data-x="80" data-y="80">框内</button>')
    idoc.close()
    const proto = iframe.contentWindow.HTMLElement.prototype
    proto.getBoundingClientRect = function (this: HTMLElement) {
      const left = Number(this.getAttribute('data-x') || 80)
      const top = Number(this.getAttribute('data-y') || 80)
      return { left, top, width: 80, height: 24, right: left + 80, bottom: top + 24, x: left, y: top, toJSON() { return {} } }
    }
    proto.scrollIntoView = () => {}
    idoc.elementFromPoint = () => idoc.querySelector('button')
    const inner = runLocate(dom, { by: 'text', value: '框内', frame: 'inner' })
    const miss = runLocate(dom, { by: 'text', value: '顶层', frame: 'inner' })
    expect(inner.ok).toBe(true)
    expect(String(inner.text || '')).toContain('框内')
    expect(miss.ok).toBe(false)
    expect(miss.reason).toBe('not_found')
  })
})
