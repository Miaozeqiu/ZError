import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectSiteBoundaries, compareSiteBoundaries } from '../../scripts/site-boundary-audit.mjs'

describe('客户端平台迁移边界', () => {
  it('平台临时实现清单只允许缩小', () => {
    const inventory = JSON.parse(readFileSync('docs/site-migration-inventory.json', 'utf8'))
    expect(compareSiteBoundaries(inspectSiteBoundaries(), inventory.files)).toEqual([])
    expect(inventory.families.map((family: {id:string})=>family.id)).toContain('metadata-compatibility')
  })
  it('阻止新平台文件、扩大专用实现以及通用入口新增特判', () => {
    const baseline = { 'src/services/old.ts': { signals: 1, maxLines: 10 } }
    expect(compareSiteBoundaries({ 'src/services/new.ts': {signals:1} }, baseline)).toHaveLength(1)
    expect(compareSiteBoundaries({ 'src/services/old.ts': {signals:2,maxLines:11} }, baseline)).toHaveLength(2)
    expect(compareSiteBoundaries({}, baseline)).toEqual([])
  })
})
