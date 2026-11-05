import { beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ value: null as any, saves: vi.fn(), download: vi.fn(), discover: vi.fn() }))
const historyDownload = vi.hoisted(() => vi.fn())
const historyHead = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/security/secureStore', () => ({
  isNativeSecureStore: () => false, readSecureDocument: async () => structuredClone(storage.value),
  writeSecureDocument: async (name: string, value: unknown) => { storage.saves(name, value); storage.value = structuredClone(value); return value },
  redactNative: async (value: unknown) => value,
}))
vi.mock('../../src/services/agent/websiteRepositoryGitHub', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepositoryGitHub')>(), downloadWebsiteRepository: storage.download, discoverWebsiteRepositories: storage.discover,
  downloadWebsiteCommitHistory: historyDownload, downloadWebsiteHistoryHead: historyHead,
}))
const main = (id: string, text: string) => `---\nname: ${id}\ndescription: Website experience\n---\n# ${text}\n`
const snapshot = (id: string, host: string) => ({ revision: 'a'.repeat(40), checkedAt: 1000,
  website: { version: 1 as const, id, host, name: id, icon: 'assets/icon.png' }, icon: { path: 'assets/icon.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
  files: { 'SKILL.md': main(id, 'Upstream'), 'site-graph.json': JSON.stringify({ id, host, hostPattern: host.replaceAll('.', '\\.'), nodes: [], edges: [] }) } })
const candidate = (id = 'example', host = 'example.com') => ({
  source: { owner: 'owner', name: 'website', branch: 'main', root: `skills/${id}`, url: 'https://github.com/owner/website' },
  website: snapshot(id, host).website, icon: snapshot(id, host).icon, revision: 'c'.repeat(40),
})
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); storage.value = null; storage.download.mockImplementation(async (_source, _previous, _request, identity) => snapshot(identity.id, identity.host)) })
describe('website repository registry', () => {
  it('loads the selected GitHub SHA as the active skill without replacing the working copy', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    const host = 'chaoxing.com', revision = 'c'.repeat(40)
    await mod.writeWebsiteRepositoryFile(host, 'SKILL.md', main('chaoxing', 'Local'))
    storage.download.mockResolvedValueOnce({ ...snapshot('chaoxing', host), revision })
    await mod.selectWebsiteRepositoryVersion(host, revision)
    expect(storage.download.mock.calls[0][0].branch).toBe(revision)
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).toContain('# Upstream')
    expect(await mod.readWebsiteLocalHistory(host)).toMatchObject({ currentId: revision, pinned: true, hasFork: true })
    await mod.selectWebsiteRepositoryVersion(host, null)
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).toContain('# Local')
  })

  it('shares concurrent history reads and reuses persisted pages after restart', async () => {
    const revision = 'a'.repeat(40), result = { commits: [], hasMore: true }
    historyDownload.mockResolvedValue(result)
    let mod = await import('../../src/services/agent/websiteRepository')
    const read = () => mod.readWebsiteGitHistory('chaoxing.com', revision)
    expect(await Promise.all([read(), read()])).toEqual([result, result])
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    expect(await read()).toEqual(result)
    expect(historyDownload).toHaveBeenCalledOnce()
    await mod.readWebsiteGitHistory('chaoxing.com', revision, 2)
    await mod.readWebsiteGitHistory('chaoxing.com', 'b'.repeat(40))
    expect(historyDownload).toHaveBeenCalledTimes(3)
  })
  it('refreshes and persists the history head without changing the website snapshot or fork', async () => {
    const newer = 'd'.repeat(40)
    historyHead.mockResolvedValue(newer)
    historyDownload.mockResolvedValue({ commits: [], hasMore: false })
    let mod = await import('../../src/services/agent/websiteRepository')
    await mod.writeWebsiteRepositoryFile('chaoxing.com', 'SKILL.md', main('chaoxing', 'Local'))
    const before = structuredClone(storage.value.entries['chaoxing.com'])
    const revision = before.document.upstream.revision
    await mod.refreshWebsiteGitHistory('chaoxing.com')
    expect(storage.value.entries['chaoxing.com']).toEqual(before)
    expect(storage.download).not.toHaveBeenCalled()
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.readWebsiteGitHistoryRevision('chaoxing.com', revision)).toBe(newer)
    await mod.readWebsiteGitHistory('chaoxing.com', newer)
    expect(historyHead).toHaveBeenCalledOnce()
    expect(historyDownload).toHaveBeenCalledOnce()
    expect(await mod.readWebsiteGitHistoryRevision('chaoxing.com', 'f'.repeat(40))).toBe('f'.repeat(40))
  })
  it('does not publish a new history head when loading its commits fails', async () => {
    historyHead.mockResolvedValue('d'.repeat(40))
    historyDownload.mockRejectedValueOnce(new Error('offline'))
    const mod = await import('../../src/services/agent/websiteRepository')
    await expect(mod.refreshWebsiteGitHistory('chaoxing.com')).rejects.toThrow('offline')
    expect(await mod.readWebsiteGitHistoryRevision('chaoxing.com', 'a'.repeat(40))).toBe('a'.repeat(40))
  })
  it('upgrades the old single-website cache without losing its local fork', async () => {
    const old = snapshot('chaoxing', 'chaoxing.com')
    storage.value = { version: 1, generation: 2, upstream: old, migrated: true,
      fork: { id: 'local', parentRevision: old.revision, updatedAt: 1, files: { 'SKILL.md': main('chaoxing', 'Private local') }, bases: { 'SKILL.md': old.files['SKILL.md'] }, conflicts: [] } }
    const mod = await import('../../src/services/agent/websiteRepository')
    expect((await mod.readWebsiteRepositoryFile('chaoxing.com', 'SKILL.md')).content).toContain('Private local')
    await mod.readWebsiteRepositoryFile('zjooc.cn', 'SKILL.md')
    expect(storage.value.version).toBe(2)
    expect(storage.value.entries['chaoxing.com'].document.fork.files['SKILL.md']).toContain('Private local')
    expect(storage.value.entries['zjooc.cn'].configuration.source.name).toBe('ZError-zjooc')
  })
  it('serializes persistence across websites without mixing local edits', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    await Promise.all([mod.ensureWebsiteRepository('chaoxing.com'), mod.ensureWebsiteRepository('zjooc.cn')])
    await Promise.all([mod.writeWebsiteRepositoryFile('chaoxing.com', 'SKILL.md', main('chaoxing', 'A local')),
      mod.writeWebsiteRepositoryFile('zjooc.cn', 'SKILL.md', main('zjooc', 'B local'))])
    expect(storage.value.entries['chaoxing.com'].document.fork.files['SKILL.md']).toContain('A local')
    expect(storage.value.entries['zjooc.cn'].document.fork.files['SKILL.md']).toContain('B local')
    expect(storage.saves.mock.calls.every(([name]) => name === 'website_repositories')).toBe(true)
  })
  it('previews without writing, then imports a complete pinned package and caches its icon', async () => {
    const selected = candidate(); storage.discover.mockResolvedValue([selected])
    const mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.previewWebsiteRepository('owner/website')).toEqual([selected])
    expect(storage.saves).not.toHaveBeenCalled()
    await mod.importWebsiteRepository(selected)
    expect(mod.hasWebsiteRepository('example.com')).toBe(true)
    expect(mod.websiteRepositoryStates['example.com'].iconUrl).toBe(selected.icon.dataUrl)
    expect(storage.download.mock.calls[0][0].branch).toBe(selected.revision)
    expect(storage.value.entries['example.com'].configuration.source.branch).toBe('main')
  })
  it('does not replace another source for an existing website or overwrite on invalid imports', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    await expect(mod.importWebsiteRepository(candidate('zjooc', 'zjooc.cn'))).rejects.toThrow('另一仓库')
    expect(storage.download).not.toHaveBeenCalled()
    storage.download.mockResolvedValue({ ...snapshot('example', 'example.com'), icon: undefined })
    await expect(mod.importWebsiteRepository(candidate())).rejects.toThrow('图标无效')
    expect(storage.saves).not.toHaveBeenCalled()
    expect(mod.hasWebsiteRepository('example.com')).toBe(false)
  })
  it('atomically rejects a second concurrent import for the same host', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    const first = candidate(), second = { ...candidate(), source: { ...candidate().source, name: 'other', url: 'https://github.com/owner/other' } }
    const results = await Promise.allSettled([mod.importWebsiteRepository(first), mod.importWebsiteRepository(second)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(storage.value.entries['example.com'].configuration.source.name).toBe('website')
  })
  it('does not register a website if durable import storage fails', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    storage.saves.mockImplementationOnce(() => { throw new Error('storage unavailable') })
    await expect(mod.importWebsiteRepository(candidate())).rejects.toThrow('storage unavailable')
    expect(mod.hasWebsiteRepository('example.com')).toBe(false)
    expect(storage.value).toBeNull()
  })
})
