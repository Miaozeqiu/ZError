import { describe, expect, it, vi } from 'vitest'
import { createWebsiteRepository, validateWebsiteSnapshot, type WebsiteRepositoryDocument, type WebsiteSnapshot } from '../../src/services/agent/websiteRepositoryCore'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const main = (body = 'Official') => `---\nname: chaoxing\ndescription: 学习通操作\n---\n# ${body}\n`
const snapshot = (revision = 'a'.repeat(40), body = 'Official'): WebsiteSnapshot => ({ revision, checkedAt: 1_000,
  files: { 'SKILL.md': main(body), 'references/study.md': 'Study', 'site-graph.json': JSON.stringify({ id: 'chaoxing', host: 'chaoxing.com', hostPattern: 'chaoxing\\.com', nodes: [], edges: [] }) } })
const harness = (stored: WebsiteRepositoryDocument | null = null) => {
  let disk = clone(stored)
  const save = vi.fn(async (next: WebsiteRepositoryDocument) => { disk = clone(next) })
  const download = vi.fn(async () => snapshot('b'.repeat(40), 'Updated'))
  const load = vi.fn(async () => clone(disk))
  const create = (legacy?: () => Promise<Record<string, string>>) => createWebsiteRepository({ fallback: snapshot(), load, save, download, legacy, now: () => 2_000 })
  return { create, save, download, load, disk: () => disk }
}

describe('local website repository without git', () => {
  it('restores archived local content and returns to the original work after restart', async () => {
    const h = harness(), repo = h.create()
    await repo.write('SKILL.md', main('First'))
    const first = repo.versionSelection().currentId
    await repo.write('references/study.md', 'Second')
    const working = repo.versionSelection().workingId
    await repo.selectVersion(first)
    expect(await repo.read('references/study.md')).toMatchObject({ content: 'Study', readonly: true })
    expect(repo.versionSelection()).toMatchObject({ currentId: first, workingId: working, pinned: true })
    await expect(repo.write('SKILL.md', main('Blocked'))).rejects.toThrow('工作版本')
    await repo.refresh()
    expect(h.download).not.toHaveBeenCalled()
    const restarted = h.create()
    expect(await restarted.read('references/study.md')).toMatchObject({ content: 'Study', readonly: true })
    await restarted.selectVersion(null)
    expect(await restarted.read('references/study.md')).toMatchObject({ content: 'Second', readonly: false })
    expect(restarted.versionSelection()).toMatchObject({ currentId: working, pinned: false })
  })

  it('keeps a selected snapshot through an in-flight update and leaves it intact on save failure', async () => {
    const h = harness(), repo = h.create()
    const earlier = snapshot('c'.repeat(40), 'Earlier')
    let finish!: (value: WebsiteSnapshot) => void
    h.download.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const refresh = repo.refresh()
    await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce())
    await repo.selectVersion(earlier.revision, earlier)
    finish(snapshot('b'.repeat(40), 'Newer'))
    await refresh
    expect(await repo.read('SKILL.md')).toMatchObject({ content: main('Earlier'), readonly: true })
    expect(repo.inspect().upstream.revision).toBe('a'.repeat(40))
    h.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(repo.selectVersion(null)).rejects.toThrow('disk full')
    expect(repo.versionSelection().currentId).toBe(earlier.revision)
    await expect(repo.selectVersion('d'.repeat(40), earlier)).rejects.toThrow('不一致')
  })

  it('durably records ordered local revisions and keeps them after reset and restart', async () => {
    const h = harness(), repo = h.create()
    await repo.write('SKILL.md', main('First'))
    const first = repo.inspect().history![0]
    expect(first).toMatchObject({ parent: 'a'.repeat(40), kind: 'write', paths: ['SKILL.md'], createdAt: 2000 })
    expect(first.id).toMatch(/^[a-f0-9]{64}$/)
    await repo.write('references/study.md', 'Second')
    expect(repo.inspect().history![1].parent).toBe(first.id)
    await repo.reset()
    const restarted = h.create(); await restarted.ready()
    expect(restarted.inspect().history!.map(commit => commit.kind)).toEqual(['write', 'write', 'reset'])
    expect(restarted.inspect().fork).toBeUndefined()
    expect(JSON.stringify(restarted.inspect().history)).not.toContain('Second')
    expect(restarted.inspect().history![2].paths).toEqual(['SKILL.md', 'references/study.md'])
  })

  it('checkpoints old forks once without inventing earlier commits', async () => {
    const h = harness({ version: 1, generation: 3, upstream: snapshot(), migrated: true,
      fork: { id: 'existing', parentRevision: 'c'.repeat(40), updatedAt: 1234, files: { 'SKILL.md': main('Old') }, bases: { 'SKILL.md': main() }, conflicts: [] } })
    const repo = h.create(); await repo.ready()
    expect(repo.inspect().history).toHaveLength(1)
    expect(repo.inspect().history![0]).toMatchObject({ kind: 'migrate', createdAt: 1234, parent: 'c'.repeat(40) })
    expect(repo.inspect().generation).toBe(3)
    const restarted = h.create(); await restarted.ready()
    expect(restarted.inspect().history).toEqual(repo.inspect().history)
    expect(h.save).toHaveBeenCalledOnce()
  })

  it('does not create phantom commits for failed, stale, unchanged writes or unchanged checks', async () => {
    const h = harness(), repo = h.create()
    await repo.write('SKILL.md', main())
    expect(repo.inspect().history).toBeUndefined()
    const before = await repo.read('SKILL.md')
    await repo.write('SKILL.md', main('Saved'))
    h.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(repo.write('references/study.md', 'Not saved')).rejects.toThrow('disk full')
    await expect(repo.write('SKILL.md', main('Stale'), before.version)).rejects.toThrow('重新读取')
    h.download.mockResolvedValue(snapshot())
    await repo.refresh()
    expect(repo.inspect().history).toHaveLength(1)
    expect(h.disk()!.history).toHaveLength(1)
  })

  it('records conflict decisions even when keeping the same local text', async () => {
    const h = harness(), repo = h.create()
    await repo.write('SKILL.md', main('Local'))
    await repo.refresh()
    await repo.resolve('SKILL.md', 'local')
    expect(repo.inspect().history!.map(commit => commit.kind)).toEqual(['write', 'update', 'resolve-local'])
    expect(repo.inspect().history![2].paths).toEqual(['SKILL.md'])
    expect((await repo.read('SKILL.md')).content).toBe(main('Local'))
  })

  it('bounds history and rejects corrupt stored records without overwriting them', async () => {
    const h = harness(), repo = h.create()
    for (let i = 0; i < 202; i++) await repo.write('references/study.md', String(i))
    expect(repo.inspect().history).toHaveLength(200)
    expect(repo.inspect().historyTruncated).toBe(true)
    const stored = repo.inspect(); stored.history![0].paths = ['../secret']
    const corrupt = harness(stored)
    await expect(corrupt.create().ready()).rejects.toThrow('历史无效')
    expect(corrupt.save).not.toHaveBeenCalled()
  })
  it('binds read versions to the website even when two packages share a commit', async () => {
    const first = harness().create()
    const fallback = snapshot()
    const other = { ...fallback, files: { ...fallback.files, 'SKILL.md': main().replace('name: chaoxing', 'name: example'),
      'site-graph.json': JSON.stringify({ id: 'example', host: 'example.com', hostPattern: 'example\\.com', nodes: [], edges: [] }) } }
    const second = createWebsiteRepository({ fallback: other, load: async () => null, save: async () => undefined, download: async () => other })
    const version = (await first.read('SKILL.md')).version
    expect((await second.read('SKILL.md')).version).not.toBe(version)
    await expect(second.write('references/study.md', 'foreign edit', version)).rejects.toThrow('重新读取')
  })
  it('reads a cache without creating a fork; first edit forks and survives restart, keeping the upstream intact', async () => {
    const h = harness(); const repo = h.create()
    const read = await repo.read('SKILL.md')
    expect(read.content).toBe(main())
    expect(repo.inspect().fork).toBeUndefined()
    await repo.write('SKILL.md', main('Local'), read.version)
    expect(repo.inspect().fork).toMatchObject({ parentRevision: 'a'.repeat(40), files: { 'SKILL.md': main('Local') } })
    expect(repo.inspect().upstream.files['SKILL.md']).toBe(main())
    expect((await h.create().read('SKILL.md')).content).toBe(main('Local'))
    expect(h.download).not.toHaveBeenCalled()
  })

  it('preserves local content on conflicting upstream updates, while applying untouched files', async () => {
    const h = harness(); const repo = h.create()
    await repo.write('SKILL.md', main('Local'))
    h.download.mockResolvedValue({ ...snapshot('b'.repeat(40), 'Updated'), files: { ...snapshot('b'.repeat(40), 'Updated').files, 'references/study.md': 'New study' } })
    await repo.refresh()
    expect((await repo.read('SKILL.md')).content).toBe(main('Local'))
    expect((await repo.read('references/study.md')).content).toBe('New study')
    expect(repo.inspect().fork?.conflicts).toEqual(['SKILL.md'])
    await repo.resolve('SKILL.md', 'local')
    expect(repo.inspect().fork?.conflicts).toEqual([])
    expect(repo.inspect().fork?.bases['SKILL.md']).toBe(main('Updated'))
    h.download.mockResolvedValue(snapshot('c'.repeat(40), 'Another official update'))
    await repo.refresh()
    await repo.resolve('SKILL.md', 'upstream')
    expect((await repo.read('SKILL.md')).content).toBe(main('Another official update'))
    expect(repo.inspect().fork?.files).toEqual({})
  })

  it('keeps edits made while a download is in flight and rejects stale writes', async () => {
    const h = harness(); const repo = h.create()
    await repo.ready()
    let finish!: (value: WebsiteSnapshot) => void
    h.download.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const refresh = repo.refresh()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const old = await repo.read('SKILL.md')
    await repo.write('SKILL.md', main('During download'), old.version)
    finish(snapshot('b'.repeat(40), 'Remote update'))
    await refresh
    expect((await repo.read('SKILL.md')).content).toBe(main('During download'))
    expect(repo.inspect().fork?.conflicts).toEqual(['SKILL.md'])
    await expect(repo.write('SKILL.md', main('Stale overwrite'), old.version)).rejects.toThrow('重新读取')
  })

  it('serializes edits and never publishes a failed durable save', async () => {
    const h = harness(); const repo = h.create()
    const old = await repo.read('SKILL.md')
    const results = await Promise.allSettled([repo.write('SKILL.md', main('First'), old.version), repo.write('SKILL.md', main('Second'), old.version)])
    expect(results.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
    const before = repo.inspect()
    h.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(repo.write('SKILL.md', main('Unsaved'))).rejects.toThrow('disk full')
    expect(repo.inspect()).toEqual(before)
    expect((await h.create().read('SKILL.md')).content).toBe(main('First'))
  })

  it('preserves the whole cache when network, file validation, or cache storage fails', async () => {
    const h = harness(); const repo = h.create(); await repo.ready()
    const before = repo.inspect()
    h.download.mockRejectedValueOnce(new Error('offline'))
    await expect(repo.refresh()).rejects.toThrow('offline')
    h.download.mockResolvedValueOnce({ ...snapshot(), files: { 'SKILL.md': main() } })
    await expect(repo.refresh()).rejects.toThrow('完整入口或图谱')
    h.save.mockRejectedValueOnce(new Error('write failed'))
    await expect(repo.refresh()).rejects.toThrow('write failed')
    expect(repo.inspect()).toEqual(before)
  })

  it('migrates old edits only once and reset restores the latest upstream without reimporting them', async () => {
    const h = harness(); const legacy = vi.fn(async () => ({ 'SKILL.md': main('Old local edits') }))
    const repo = h.create(legacy)
    expect((await repo.read('SKILL.md')).content).toBe(main('Old local edits'))
    await repo.refresh(); await repo.reset()
    expect((await repo.read('SKILL.md')).content).toBe(main('Updated'))
    const restarted = h.create(legacy)
    expect((await restarted.read('SKILL.md')).content).toBe(main('Updated'))
    expect(legacy).toHaveBeenCalledOnce()
  })

  it('does not treat identical content or an unchanged cache check as a new edit', async () => {
    const h = harness(); const repo = h.create()
    const before = await repo.read('SKILL.md')
    await repo.write('SKILL.md', before.content!, before.version)
    expect(repo.inspect().fork).toBeUndefined()
    h.download.mockResolvedValue({ ...snapshot(), checkedAt: 9_000 })
    await repo.refresh()
    expect((await repo.read('SKILL.md')).version).toBe(before.version)
  })

  it('fails closed on unread or corrupt existing storage; rejects paths and executable resources', async () => {
    const h = harness(); h.load.mockRejectedValueOnce(new Error('storage locked'))
    await expect(h.create().write('SKILL.md', main('Overwrite'))).rejects.toThrow('locked')
    expect(h.save).not.toHaveBeenCalled()
    for (const path of ['../SKILL.md', '/SKILL.md', 'references/../SKILL.md', 'scripts/run.js', 'references/x.js', '__proto__']) {
      await expect(h.create().write(path, 'x')).rejects.toThrow('路径')
    }
    expect(() => validateWebsiteSnapshot({ ...snapshot(), files: { ...snapshot().files, 'references/script.js': 'bad' } })).toThrow('不支持')
    expect(() => validateWebsiteSnapshot({ ...snapshot(), files: { ...snapshot().files, 'SKILL.md': main().replace('name: chaoxing', 'name: other') } })).toThrow('目录一致')
  })
})
