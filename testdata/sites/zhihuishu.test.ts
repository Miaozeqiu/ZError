import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { applyLearnedSiteGraphContent, seedBundledLearnedSites } from '../../src/services/agent/skillRuntime'
import { siteGraphForUrl, siteGraphNodeForUrl } from '../../src/services/browser/siteGraphCore'
import {
  locateSiteScript,
  parseSiteDocument,
  registerSitePackage,
  sitePackageOf,
} from '../../src/services/parser/registry'

const pack = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../src/services/agent/skills/bundled/site-learn/sites/zhihuishu.com')
const html = readFileSync(resolve(pack, 'fixtures/list.html'), 'utf8')
const href = 'https://online.zhihuishu.com/student/course'

const ensurePack = () => {
  if (sitePackageOf('zhihuishu', 'list')) return
  registerSitePackage('zhihuishu', 'list', {
    helpers: readFileSync(resolve(pack, 'parsers/list/helpers.js'), 'utf8'),
    parse: readFileSync(resolve(pack, 'parsers/list/parse.js'), 'utf8'),
    locate: readFileSync(resolve(pack, 'parsers/list/locate.js'), 'utf8'),
  })
}

describe('zhihuishu list parser', () => {
  it('图谱命中 list 包', () => {
    seedBundledLearnedSites()
    applyLearnedSiteGraphContent(readFileSync(resolve(pack, 'site-graph.json'), 'utf8'))
    expect(siteGraphForUrl(href)?.id).toBe('zhihuishu')
    expect(siteGraphNodeForUrl(href)?.parserIds).toContain('list')
  })

  it('fixture 出卡并带 work handle', () => {
    ensurePack()
    const dom = new JSDOM(html, { url: href })
    const card = parseSiteDocument('zhihuishu', 'list', dom.window.document, href)
    expect(card.ok).toBe(true)
    expect(card.page).toBe('list')
    expect(card.confidence).toBeGreaterThanOrEqual(0.6)
    expect((card as { works?: Array<{ title: string }> }).works?.map((item) => item.title)).toEqual([
      '高等数学（一）',
      '线性代数',
    ])
    expect(card.handles?.[0]).toEqual({ kind: 'work', title: '高等数学（一）' })
    expect(siteGraphNodeForUrl(href)?.parserIds).toContain('list')
  })

  it('locate 按课名点到标题中心，不新增 browser 工具', () => {
    ensurePack()
    const dom = new JSDOM(html, { url: href })
    const proto = dom.window.HTMLElement.prototype as HTMLElement & { getBoundingClientRect: () => DOMRect }
    proto.getBoundingClientRect = () => ({
      x: 20, y: 40, left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, toJSON() { return {} },
    })
    const script = locateSiteScript('zhihuishu', 'list', { kind: 'work', title: '高等数学（一）' })
    const hit = new Function('document', 'window', `return ${script};`)(dom.window.document, dom.window) as {
      found?: boolean
      text?: string
      x?: number
      y?: number
    }
    expect(hit.found).toBe(true)
    expect(hit.text).toBe('高等数学（一）')
    expect(hit.x).toBe(60)
    expect(hit.y).toBe(50)
  })
})
