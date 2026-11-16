import { createServer } from 'node:http'
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
  it('uses a persisted HTTP endpoint, reloads changes, and restores the default source without losing notes', async () => {
    const host = 'chaoxing.com', customUrl = 'http://127.0.0.1:8123/experience.json?channel=dev'
    const cloud = snapshot('chaoxing', host)
    let custom = { ...cloud, revision: 'dev', files: { ...cloud.files, 'SKILL.md': main('chaoxing', 'Development server') } }
    let available = true
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url === customUrl
      ? available ? Response.json(custom) : new Response(null, { status: 503 })
      : Response.json(cloud))
    vi.stubGlobal('fetch', fetcher)
    let mod = await import('../../src/services/agent/websiteRepository')
    await mod.refreshWebsiteRepository(host, true)
    await mod.writeWebsiteRepositorySupplement(host, 'My local notes', '')
    await mod.setWebsiteExperienceUrl(host, customUrl)
    await mod.refreshWebsiteRepository(host, true)
    const original = await mod.readWebsiteRepositoryFile(host, 'SKILL.md')
    expect(original.content).toContain('Development server')
    expect(original.content).toContain('My local notes')
    expect(original.content).not.toContain('Upstream')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://open.zerrorai.com/v1/website-experience/chaoxing.com', customUrl, customUrl])
    expect(fetcher).toHaveBeenCalledWith(customUrl, expect.objectContaining({ credentials: 'omit', redirect: 'error' }))

    custom = { ...custom, files: { ...custom.files, 'SKILL.md': main('chaoxing', 'Updated over HTTP') } }
    await mod.refreshWebsiteRepository(host, true)
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).toContain('Updated over HTTP')
    await expect(mod.writeWebsiteRepositorySupplement(host, 'Stale write', { version: original.version })).rejects.toThrow('重新读取')
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    available = false
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).toContain('Updated over HTTP')
    expect(mod.websiteRepositoryStates[host]).toMatchObject({ customUrl, source: 'http', error: expect.stringContaining('HTTP 503') })
    expect(fetcher.mock.calls.filter(([url]) => url !== customUrl)).toHaveLength(1)

    await mod.setWebsiteExperienceUrl(host, '')
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).toContain('Upstream')
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).supplement).toBe('My local notes')
    await mod.refreshWebsiteRepository(host, true)
    expect(fetcher.mock.calls.filter(([url]) => url !== customUrl)).toHaveLength(2)
  })

  it('can switch an app-managed site to a development server and back', async () => {
    const host = 'example.com'
    const mod = await import('../../src/services/agent/websiteRepository')
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/experience.json') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ...snapshot('example', host), revision: undefined }))
    })
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a local HTTP port')
      const url = `http://127.0.0.1:${address.port}/experience.json`
      await mod.setWebsiteExperienceUrl(host, url)
      expect(await mod.websiteRepositoryHosts()).toContain(host)
      await mod.writeWebsiteRepositorySupplement(host, 'Keep this note', '')
      await mod.setWebsiteExperienceUrl(host, '')
      expect(await mod.websiteRepositoryHosts()).not.toContain(host)
      await mod.setWebsiteExperienceUrl(host, url)
      expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).supplement).toBe('Keep this note')
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('refuses unsafe URLs and prevents another site from replacing the active experience', async () => {
    const request = vi.fn(async () => Response.json(snapshot('example', 'example.com')))
    vi.stubGlobal('fetch', request)
    const mod = await import('../../src/services/agent/websiteRepository')
    for (const url of ['file:///tmp/experience.json', 'http://user:password@127.0.0.1/experience.json', 'http:localhost']) {
      await expect(mod.setWebsiteExperienceUrl('chaoxing.com', url)).rejects.toThrow('HTTP')
    }
    expect(request).not.toHaveBeenCalled()
    await expect(mod.setWebsiteExperienceUrl('chaoxing.com', 'http://127.0.0.1/experience.json')).rejects.toThrow('不一致')
    expect(mod.websiteRepositoryStates['chaoxing.com'].customUrl).toBe('')
    expect(storage.saves).not.toHaveBeenCalled()
  })
  it('refreshes official experience through Open and retains local notes when Open is unavailable', async () => {
    const initial = snapshot('chaoxing', 'chaoxing.com')
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(initial))
    vi.stubGlobal('fetch', request)
    const mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.websiteRepositoryHosts()).toContain('chaoxing.com')
    await mod.refreshWebsiteRepository('chaoxing.com', true)
    expect(request.mock.calls[0]?.[0]).toBe('https://open.zerrorai.com/v1/website-experience/chaoxing.com')
    expect(storage.download).not.toHaveBeenCalled()
    expect(mod.websiteRepositoryStates['chaoxing.com'].revision).toBe(initial.revision)
    await mod.writeWebsiteRepositorySupplement('chaoxing.com', 'Local note', '')

    request.mockResolvedValueOnce(Response.json({ revision: initial.revision, unchanged: true }))
    await mod.refreshWebsiteRepository('chaoxing.com', true)
    expect(request.mock.calls[1]?.[0]).toBe('https://open.zerrorai.com/v1/website-experience/chaoxing.com?revision=' + initial.revision)

    request.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '60' } }))
    await mod.refreshWebsiteRepository('chaoxing.com', true)
    const effective = await mod.readWebsiteRepositoryFile('chaoxing.com', 'SKILL.md')
    expect(effective.content).toContain('Upstream')
    expect(effective.content).toContain('Local note')
    expect(mod.websiteRepositoryStates['chaoxing.com'].error).toContain('HTTP 503')
  })
  it('updates other built-in experiences directly from GitHub', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    const mod = await import('../../src/services/agent/websiteRepository')
    await mod.refreshWebsiteRepository('zhihuishu.com', true)
    await mod.refreshWebsiteRepository('zjooc.cn', true)
    expect(storage.download.mock.calls.map(([source]) => source.name)).toEqual(['ZError-zhihuishu', 'ZError-zjooc'])
    expect(request).not.toHaveBeenCalled()
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
