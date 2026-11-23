import { describe, expect, it, vi } from 'vitest'
import { createWebsiteRepository, type StoredWebsiteRepositoryDocument, type WebsiteSnapshot } from '../../src/services/agent/websiteRepositoryCore'

const main = (body = '# 云端经验') => `---\nname: chaoxing\ndescription: 学习通操作\n---\n${body}\n`
const graph = (nodes: unknown[] = [], edges: unknown[] = []) => JSON.stringify({
  id: 'chaoxing', host: 'chaoxing.com', hostPattern: 'chaoxing\\.com', nodes, edges,
})
const node = (id: string, fields = {}) => ({ id, title: id, summary: '', path: '/', row: 0, col: 0, patterns: [], ...fields })
const snapshot = (revision = 'a'.repeat(40), body = '# 云端经验'): WebsiteSnapshot => ({
  revision, checkedAt: 1000,
  files: { 'SKILL.md': main(body), 'references/study.md': '云端参考', 'site-graph.json': graph() },
})
const harness = (stored: StoredWebsiteRepositoryDocument | null = null) => {
  let disk = structuredClone(stored)
  const save = vi.fn(async (next: StoredWebsiteRepositoryDocument) => { disk = structuredClone(next) })
  const download = vi.fn(async () => snapshot('b'.repeat(40), '# 更新后的云端经验'))
  const load = vi.fn(async () => structuredClone(disk))
  const create = (legacy?: () => Promise<Record<string, string>>) => createWebsiteRepository({ fallback: snapshot(), load, save, download, legacy })
  return { create, save, download, load, disk: () => disk }
}

describe('cloud website experience and local additions', () => {
  it('always reads the latest cloud content plus local notes, including after restart', async () => {
    const h = harness(), repo = h.create()
    const original = await repo.read('SKILL.md')
    await repo.write('SKILL.md', original.content + '\n本地步骤', original.version)
    expect(repo.inspect().supplement).toBe('本地步骤')
    await repo.refresh()
    const current = await h.create().read('SKILL.md')
    expect(current.content).toBe(main('# 更新后的云端经验\n\n## 本地补充经验\n\n本地步骤'))
    expect(current.supplement).toBe('本地步骤')
    await repo.reset('SKILL.md')
    expect((await repo.read('SKILL.md')).content).toBe(main('# 更新后的云端经验'))
  })

  it('migrates the last working edits using their original base and resumes cloud sync', async () => {
    const oldBase = main('# 旧云端经验\n\n原有步骤')
    const stored = {
      version: 1 as const, generation: 3, upstream: snapshot('a'.repeat(40), '# 最新云端经验'), migrated: true,
      fork: { files: { 'SKILL.md': oldBase + '\n旧的本机步骤', 'references/new.md': '本机参考' }, bases: { 'SKILL.md': oldBase, 'references/new.md': null } },
      selection: { id: 'old', snapshot: snapshot('c'.repeat(40), '# 曾选中的旧版本') },
      history: [],
    }
    const h = harness(stored), repo = h.create()
    expect((await repo.read('SKILL.md')).content).toBe(main('# 最新云端经验\n\n## 本地补充经验\n\n旧的本机步骤\n\n### new\n\n本机参考'))
    expect((await repo.read('references/new.md')).content).toBeNull()
    expect(h.disk()).toMatchObject({ version: 3, supplement: '旧的本机步骤\n\n### new\n\n本机参考' })
    expect(h.disk()).not.toHaveProperty('selection')
    await h.create().ready()
    expect(h.save).toHaveBeenCalledOnce()
    await repo.refresh()
    expect((await repo.read('SKILL.md')).content).toContain('# 更新后的云端经验')
  })

  it('moves v2 notes from reference files into the single local note', async () => {
    const h = harness({ version: 2, generation: 3, upstream: snapshot(), migrated: true,
      supplements: { 'SKILL.md': '本地步骤', 'references/study.md': '参考补充' } })
    const repo = h.create()
    expect((await repo.read('SKILL.md')).supplement).toBe('本地步骤\n\n### study\n\n参考补充')
    expect((await repo.read('references/study.md')).content).toBe('云端参考')
    expect(h.disk()).toMatchObject({ version: 3 })
    expect(h.disk()).not.toHaveProperty('supplements')
  })

  it('keeps Markdown fences intact and displays matching cloud and local notes only once', async () => {
    const h = harness(), repo = h.create()
    const note = '~~~js\nfirst()\n\nsecond()\n~~~'
    await repo.writeSupplement(note, '')
    expect((await repo.read('SKILL.md')).content).toContain(note)
    h.download.mockResolvedValue(snapshot('b'.repeat(40), '# 云端\n\n' + note))
    await repo.refresh()
    expect((await repo.read('SKILL.md')).content).toBe(main('# 云端\n\n' + note))
    expect((await repo.read('SKILL.md')).supplement).toBe(note)
    const current = await repo.read('SKILL.md')
    await repo.write('SKILL.md', current.content + '\n另一条补充', current.version)
    expect((await repo.read('SKILL.md')).supplement).toBe(note + '\n\n另一条补充')
  })

  it('adds local graph nodes and fields while taking unrelated changes from cloud', async () => {
    const initial = snapshot()
    initial.files['site-graph.json'] = graph([node('cloud')])
    const h = harness({ version: 3, generation: 0, upstream: initial, supplement: '' }), repo = h.create()
    await repo.write('site-graph.json', graph([node('cloud', { summary: '本机记录' }), node('local')], [{ from: 'cloud', to: 'local', label: '进入' }]))
    const updated = snapshot('b'.repeat(40))
    updated.files['site-graph.json'] = graph([node('cloud', { title: '新标题' }), node('new')])
    h.download.mockResolvedValue(updated)
    await repo.refresh()
    expect(JSON.parse((await repo.read('site-graph.json')).content!)).toMatchObject({
      nodes: [node('cloud', { title: '新标题', summary: '本机记录' }), node('new'), node('local')],
      edges: [{ from: 'cloud', to: 'local', label: '进入' }],
    })
  })

  it('accepts local editor saves during cloud updates and rejects concurrent local edits and stale agent writes', async () => {
    const h = harness(), repo = h.create()
    let finish!: (value: WebsiteSnapshot) => void
    h.download.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const original = await repo.read('SKILL.md')
    const refresh = repo.refresh()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await repo.writeSupplement('同步期间保存的补充', '')
    finish(snapshot('b'.repeat(40), '# 新云端经验'))
    await refresh
    await expect(repo.write('SKILL.md', original.content + '\n过期写入', original.version)).rejects.toThrow('重新读取')
    await expect(repo.writeSupplement('另一份草稿', '')).rejects.toThrow('别处修改')
    await expect(repo.write('references/study.md', '本地参考')).rejects.toThrow('只读')
    const read = await repo.read('SKILL.md')
    expect(read.content).toContain('# 新云端经验')
    expect(read.supplement).toBe('同步期间保存的补充')
  })

  it('preserves the whole cache when download, validation or storage fails', async () => {
    const h = harness(), repo = h.create()
    await repo.ready()
    const before = repo.inspect()
    h.download.mockRejectedValueOnce(new Error('offline'))
    await expect(repo.refresh()).rejects.toThrow('offline')
    h.download.mockResolvedValueOnce({ ...snapshot(), files: { 'SKILL.md': main() } })
    await expect(repo.refresh()).rejects.toThrow('完整入口或图谱')
    h.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(repo.writeSupplement('保存失败', '')).rejects.toThrow('disk full')
    expect(repo.inspect()).toEqual(before)
    await expect(repo.write('../secret', 'x')).rejects.toThrow('文件路径')
  })

  it('does not reimport old local files once their migrated notes are cleared', async () => {
    const h = harness(), legacy = vi.fn(async () => ({ 'SKILL.md': main('本机旧记录') }))
    const repo = h.create(legacy)
    expect((await repo.read('SKILL.md')).supplement).toBe('本机旧记录')
    await repo.reset()
    expect((await h.create(legacy).read('SKILL.md')).content).toBe(main())
    expect(legacy).toHaveBeenCalledOnce()
  })
})

it('旧缓存缺少运行包时禁用旧工具并恢复同步，保留本地笔记且不改写原缓存', async () => {
  const cached: StoredWebsiteRepositoryDocument = { version:3, generation:7, migrated:true, supplement:'本地学习注记', upstream:{
    ...snapshot(), etag:'stale-etag', tools:[{type:'function',function:{name:'old_tool'}}], scriptManifest:'old scripts',
  } }
  const original=structuredClone(cached)
  const h=harness(cached), repo=h.create()
  await repo.ready()
  expect((await repo.read('SKILL.md')).content).toContain('本地学习注记')
  expect(repo.inspect().upstream).toMatchObject({revision:'unloaded:1',checkedAt:0})
  expect(repo.inspect().upstream.tools).toBeUndefined()
  expect(repo.inspect().upstream.etag).toBeUndefined()
  expect(repo.inspect().upstream.scriptManifest).toBeUndefined()
  expect(h.disk()).toEqual(original)
  await repo.refresh()
  expect(h.download).toHaveBeenCalledWith(expect.objectContaining({revision:'unloaded:1'}))
  expect((await repo.read('SKILL.md')).content).toContain('更新后的云端经验')
  expect(repo.inspect().supplement).toBe('本地学习注记')
})

it('自定义来源的旧缓存也保留地址和笔记，离线时不暴露旧工具', async () => {
  const cached: StoredWebsiteRepositoryDocument={version:3,generation:8,migrated:true,supplement:'个人笔记',upstream:snapshot(),customSource:{
    url:'http://127.0.0.1:8817/experience.json',snapshot:{...snapshot(),tools:[{type:'function',function:{name:'old_custom_tool'}}]},
  }}
  const h=harness(cached),repo=h.create()
  await repo.ready()
  expect(repo.inspect().customSource).toMatchObject({url:cached.customSource!.url,snapshot:{revision:'unloaded:1',checkedAt:0}})
  expect(repo.inspect().customSource!.snapshot.tools).toBeUndefined()
  expect((await repo.read('SKILL.md')).content).toContain('个人笔记')
  expect(h.disk()).toEqual(cached)
})
