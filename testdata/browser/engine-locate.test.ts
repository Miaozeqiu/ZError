import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { clickLabelMatches, siteSelectorsForText } from '../../src/services/browser/engine/clickFind'
import {
  buildLocateBoxScript,
  isRetryableReason,
  locatorsToTry,
} from '../../src/services/browser/engine/locate'

const boot = (html: string) => {
  const dom = new JSDOM(html, { url: 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1' })
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

const runLocate = (dom: JSDOM, locator: { by: 'css' | 'text' | 'role' | 'label'; value: string }) => (
  new Function(
    'window',
    'document',
    `return ${buildLocateBoxScript(locator)}`,
  )(dom.window, dom.window.document) as Record<string, unknown>
)

describe('站点选择器与等待语义', () => {
  it('作业 / 章节走 CSS，普通文案不硬编码', () => {
    expect(siteSelectorsForText('作业')[0]).toBe('[title="作业"]')
    expect(siteSelectorsForText('章节').some((sel) => sel.includes('pageHeader=1'))).toBe(true)
    expect(siteSelectorsForText('下一节')).toEqual([])
    expect(siteSelectorsForText('确定')).toEqual([])
  })

  it('文案 locator 先试站点 CSS 再按文本找', () => {
    const tried = locatorsToTry({ by: 'text', value: '作业' })
    expect(tried[0]).toEqual({ by: 'css', value: '[title="作业"]' })
    expect(tried.at(-1)).toEqual({ by: 'text', value: '作业' })
    expect(locatorsToTry({ by: 'css', value: '#loginBtn' })).toEqual([{ by: 'css', value: '#loginBtn' }])
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

  it('我学的课 / 已学的课 文案互通', () => {
    expect(clickLabelMatches('我学的课', '已学的课')).toBe(true)
    expect(clickLabelMatches('作业', '删除作业')).toBe(false)
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
})
