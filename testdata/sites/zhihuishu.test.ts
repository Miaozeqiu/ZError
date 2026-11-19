import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyLearnedSiteGraphContent } from '../../src/services/agent/skillRuntime'
import { siteGraphForUrl, siteGraphNodeForUrl } from '../../src/services/browser/siteGraphCore'

const pack = resolve(fileURLToPath(new URL('.', import.meta.url)), './fixtures')
const href = 'https://online.zhihuishu.com/student/course'

describe('zhihuishu 图谱', () => {
  it('网址落到 list 节点', () => {
    applyLearnedSiteGraphContent(readFileSync(resolve(pack, 'zhihuishu-graph.json'), 'utf8'))
    expect(siteGraphForUrl(href)?.id).toBe('zhihuishu')
    expect(siteGraphNodeForUrl(href)?.parserIds).toContain('list')
  })
})
