import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { READ_CATALOG_SLIM } from '../../../src/services/chaoxing/study/cdpScripts'

const runSlim = (html: string) => {
  const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/mycourse/studentcourse?courseid=1' })
  return new Function('window', 'document', 'location', `return ${READ_CATALOG_SLIM()};`)(
    dom.window,
    dom.window.document,
    dom.window.location,
  ) as {
    html?: string
    text?: string
    catalogLi?: number
    chapters?: Array<{ title: string; unfinished?: boolean; chapterId?: string; kind?: string }>
  }
}

describe('READ_CATALOG_SLIM', () => {
  it('只抽目录节点，不拷整页 HTML', () => {
    const got = runSlim(`<!DOCTYPE html><html><body>
      <div class="jobCompleteness">已完成任务点：3 / 10</div>
      <div id="coursetree">
        <div class="posCatalog_select firstLayer" id="cur100">
          <span class="posCatalog_title">第一章</span>
        </div>
        <div class="posCatalog_select posCatalog_active" id="cur2001">
          <span class="posCatalog_name" title="1.1 函数"><em class="posCatalog_sbar">1.1</em> 函数</span>
          <span class="orangeNew">2</span>
        </div>
        <div class="posCatalog_select" id="cur2002">
          <span class="posCatalog_name" title="1.2 极限">1.2 极限</span>
        </div>
      </div>
    </body></html>`)
    expect(got.html).toBe('')
    expect(got.catalogLi).toBeGreaterThan(0)
    expect(got.chapters?.some((item) => item.title.includes('函数') && item.unfinished)).toBe(true)
    expect(got.chapters?.find((item) => item.title.includes('函数'))?.chapterId).toBe('2001')
  })
})
