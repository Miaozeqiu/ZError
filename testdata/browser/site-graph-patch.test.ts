import { afterEach, describe, expect, it } from 'vitest'
import { applySiteGraphPatch, liveSiteGraphs } from '../../src/services/browser/siteGraphCore'
import {
  presentSiteGraphPatch,
  serializeSiteGraph,
  siteGraphSkillTarget,
  siteGraphWriteBlocked,
} from '../../src/services/browser/siteGraphSave'

const TEST_ID = 'zerror-test-graph'

afterEach(() => {
  liveSiteGraphs.value = liveSiteGraphs.value.filter((site) => site.id !== TEST_ID)
})

describe('siteGraphWriteBlocked', () => {
  it('拦住整文件写图谱', () => {
    expect(siteGraphWriteBlocked('sites/zjooc.cn/site-graph.json')).toMatch(/browser_site_graph/)
    expect(siteGraphWriteBlocked('site-graph.json')).toMatch(/browser_site_graph/)
    expect(siteGraphWriteBlocked('sites/zjooc.cn/SKILL.md')).toBe('')
  })
})

describe('siteGraphSkillTarget', () => {
  it('学习通写 chaoxing，其它站写 site-learn', () => {
    expect(siteGraphSkillTarget({ id: 'chaoxing', host: 'chaoxing.com' })).toEqual({
      skillId: 'chaoxing',
      path: 'site-graph.json',
    })
    expect(siteGraphSkillTarget({ id: 'zjooc', host: 'zjooc.cn' })).toEqual({
      skillId: 'site-learn',
      path: 'sites/zjooc.cn/site-graph.json',
    })
  })
})

describe('applySiteGraphPatch 增量', () => {
  it('upsert 节点只标 persist，不要靠模型写整文件', () => {
    const created = applySiteGraphPatch({
      action: 'upsert_site',
      siteId: TEST_ID,
      host: 'example.test',
      name: '测站',
    })
    expect(created.ok).toBe(true)
    expect(created.persist).toBe(true)
    expect(created.changed).toEqual({ kind: 'site', id: TEST_ID })

    const node = applySiteGraphPatch({
      action: 'upsert_node',
      siteId: TEST_ID,
      id: 'login',
      title: '登录',
      patterns: ['example\\.test/login'],
    })
    expect(node.ok).toBe(true)
    expect(node.persist).toBe(true)
    expect(node.changed).toEqual({ kind: 'node', id: 'login' })
    expect(node.site?.nodes.map((item) => item.id)).toContain('login')

    const shown = presentSiteGraphPatch(node, {
      action: 'upsert_node',
      saved: { skillId: 'site-learn', path: 'sites/example.test/site-graph.json' },
    })
    expect(JSON.stringify(shown)).not.toMatch(/example\\.test\/login/)
    expect(shown).toMatchObject({
      ok: true,
      saved: true,
      path: 'sites/example.test/site-graph.json',
      changed: { kind: 'node', id: 'login' },
    })
    expect(shown.hint).toMatch(/不要再整文件/)
  })

  it('save 把当前内存标成待落盘', () => {
    applySiteGraphPatch({ action: 'upsert_site', siteId: TEST_ID, host: 'example.test' })
    const saved = applySiteGraphPatch({ action: 'save', siteId: TEST_ID })
    expect(saved.ok).toBe(true)
    expect(saved.persist).toBe(true)
  })
})

describe('serializeSiteGraph', () => {
  it('只留下可落盘字段', () => {
    applySiteGraphPatch({ action: 'upsert_site', siteId: TEST_ID, host: 'example.test', name: '测站' })
    applySiteGraphPatch({
      action: 'upsert_node',
      siteId: TEST_ID,
      id: 'home',
      title: '首页',
      patterns: ['example\\.test'],
    })
    const site = liveSiteGraphs.value.find((item) => item.id === TEST_ID)
    expect(site).toBeTruthy()
    const raw = serializeSiteGraph(site!)
    expect(raw).toMatchObject({
      id: TEST_ID,
      host: 'example.test',
      nodes: [{ id: 'home', title: '首页' }],
    })
    expect(JSON.stringify(raw)).not.toMatch(/"match"/)
  })
})
