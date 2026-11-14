import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ value: null as any, saves: vi.fn(), download: vi.fn(), discover: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({
  isNativeSecureStore: () => false, readSecureDocument: async () => structuredClone(storage.value),
  writeSecureDocument: async (name: string, value: unknown) => { storage.saves(name, value); storage.value = structuredClone(value); return value },
  redactNative: async (value: unknown) => value,
}))
vi.mock('../../src/services/agent/websiteRepositoryGitHub', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepositoryGitHub')>(), downloadWebsiteRepository: storage.download, discoverWebsiteRepositories: storage.discover,
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
afterEach(() => vi.unstubAllGlobals())
describe('website repository registry', () => {
  it('refreshes official experience through Open and retains local notes when Open is unavailable', async () => {
    const initial = snapshot('zhihuishu', 'zhihuishu.com')
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(initial))
    vi.stubGlobal('fetch', request)
    const mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.websiteRepositoryHosts()).toContain('zhihuishu.com')
    await mod.refreshWebsiteRepository('zhihuishu.com', true)
    expect(request.mock.calls[0]?.[0]).toBe('https://open.zerrorai.com/v1/website-experience/zhihuishu.com')
    expect(storage.download).not.toHaveBeenCalled()
    expect(mod.websiteRepositoryStates['zhihuishu.com'].revision).toBe(initial.revision)
    await mod.writeWebsiteRepositorySupplement('zhihuishu.com', 'Local note', '')

    request.mockResolvedValueOnce(Response.json({ revision: initial.revision, unchanged: true }))
    await mod.refreshWebsiteRepository('zhihuishu.com', true)
    expect(request.mock.calls[1]?.[0]).toBe('https://open.zerrorai.com/v1/website-experience/zhihuishu.com?revision=' + initial.revision)

    request.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '60' } }))
    await mod.refreshWebsiteRepository('zhihuishu.com', true)
    const effective = await mod.readWebsiteRepositoryFile('zhihuishu.com', 'SKILL.md')
    expect(effective.content).toContain('Upstream')
    expect(effective.content).toContain('Local note')
    expect(mod.websiteRepositoryStates['zhihuishu.com'].error).toContain('HTTP 503')
  })
  it('upgrades the old single-website cache without losing its local notes', async () => {
    const old = snapshot('chaoxing', 'chaoxing.com')
    storage.value = { version: 1, generation: 2, upstream: old, migrated: true,
      fork: { id: 'local', parentRevision: old.revision, updatedAt: 1, files: { 'SKILL.md': main('chaoxing', 'Private local') }, bases: { 'SKILL.md': old.files['SKILL.md'] }, conflicts: [] } }
    const mod = await import('../../src/services/agent/websiteRepository')
    expect((await mod.readWebsiteRepositoryFile('chaoxing.com', 'SKILL.md')).content).toContain('Private local')
    await mod.readWebsiteRepositoryFile('zjooc.cn', 'SKILL.md')
    expect(storage.value.version).toBe(2)
    expect(storage.value.entries['chaoxing.com'].document.supplement).toContain('Private local')
    expect(storage.value.entries['zjooc.cn'].configuration.source.name).toBe('ZError-zjooc')
  })
  it('serializes persistence across websites without mixing local edits', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    await Promise.all([mod.ensureWebsiteRepository('chaoxing.com'), mod.ensureWebsiteRepository('zjooc.cn')])
    await Promise.all([mod.writeWebsiteRepositoryFile('chaoxing.com', 'SKILL.md', main('chaoxing', 'A local')),
      mod.writeWebsiteRepositoryFile('zjooc.cn', 'SKILL.md', main('zjooc', 'B local'))])
    expect(storage.value.entries['chaoxing.com'].document.supplement).toContain('A local')
    expect(storage.value.entries['zjooc.cn'].document.supplement).toContain('B local')
    expect(storage.saves.mock.calls.every(([name]) => name === 'website_repositories')).toBe(true)
  })
  it('previews without writing, then imports a complete verified package and caches its icon', async () => {
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
