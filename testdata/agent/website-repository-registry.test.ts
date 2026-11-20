import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ value: null as any, native: false, request: vi.fn(), saves: vi.fn(), download: vi.fn(), discover: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({
  isNativeSecureStore: () => storage.native, readSecureDocument: async () => structuredClone(storage.value),
  writeSecureDocument: async (name: string, value: unknown) => { storage.saves(name, value); storage.value = structuredClone(value); return value },
  redactNative: async (value: unknown) => value,
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: storage.request }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: async () => { throw new Error('ENOENT') },
  readDir: async () => [],
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
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); storage.value = null; storage.native = false; storage.download.mockImplementation(async (_source, _previous, _request, identity) => snapshot(identity.id, identity.host)) })
afterEach(() => vi.unstubAllGlobals())
describe('website repository registry', () => {
  it('registers official site tools only after installation and unregisters them on removal', async () => {
    const host = 'zjooc.cn'
    const root = 'https://open.zerrorai.com/v1/website-experience'
    const selected = candidate('zjooc', host)
    const cloud = snapshot('zjooc', host)
    const tool = { type: 'function', function: { name: 'browser_play_zjooc', description: 'Play video', parameters: { type: 'object' } } }
    const request = vi.fn(async (url: string) => url === root
      ? Response.json({ sites: [{ ...selected.website, ...selected.source }] })
      : Response.json({ ...cloud, tools: [tool], scriptManifest: '/v1/website-experience/zjooc.cn/script-manifest.json' }))
    vi.stubGlobal('fetch', request)
    const mod = await import('../../src/services/agent/websiteRepository')
    expect(mod.websiteToolsForHost(host)).toEqual([])
    await mod.experienceHostForPage('https://www.zjooc.cn/')
    expect(mod.websiteToolsForHost(host)).toEqual([tool])
    const { assembleAgentTools } = await import('../../src/services/agent/tools')
    const names = (url: string) => assembleAgentTools(url).map(row => row.function.name)
    expect(names('https://www.zjooc.cn/')).toContain(tool.function.name)
    expect(names('https://another.example/')).not.toContain(tool.function.name)
    expect(await mod.websiteScriptSource(host)).toMatchObject({ url: root + '/zjooc.cn' })
    request.mockResolvedValueOnce(Response.json({ ...cloud, tools: [{ ...tool, function: { ...tool.function, name: 'browser_login_chaoxing' } }] }))
    await mod.refreshWebsiteRepository(host, true)
    expect(mod.websiteToolsForHost(host)).toEqual([tool])
    await mod.removeWebsiteRepository(host)
    expect(mod.websiteToolsForHost(host)).toEqual([])
    expect(names('https://www.zjooc.cn/')).not.toContain(tool.function.name)
  })

  it('replaces an older bundled snapshot and waits for Open on the first native read', async () => {
    const host = 'chaoxing.com'
    const cloud = snapshot('chaoxing', host)
    const { website, icon, ...old } = cloud
    storage.value = { version: 1, migrated: true, generation: 3,
      upstream: { ...old, revision: 'bundled:1', files: { ...old.files, 'SKILL.md': main('chaoxing', 'Old bundled guide') } },
      fork: { files: { 'SKILL.md': main('chaoxing', 'Old bundled guide') + '\nPersonal shortcut\n' }, bases: {} } }
    storage.native = true
    storage.request.mockResolvedValueOnce(Response.json(cloud))
    const mod = await import('../../src/services/agent/websiteRepository')
    const result = await mod.readWebsiteRepositoryFile(host, 'SKILL.md')
    expect(storage.request).toHaveBeenCalledExactlyOnceWith('https://open.zerrorai.com/v1/website-experience/' + host, expect.anything())
    expect(result.content).toContain('Upstream')
    expect(result.content).not.toContain('Old bundled guide')
    expect(result.supplement).toBe('Personal shortcut')
    expect(mod.websiteRepositoryStates[host]).toMatchObject({ source: 'repository', revision: cloud.revision })
  })

  it('keeps Chaoxing protected with a custom endpoint, before any local data is deleted', async () => {
    const host = 'chaoxing.com'
    const mod = await import('../../src/services/agent/websiteRepository')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot('chaoxing', host))))
    await mod.setWebsiteExperienceUrl(host, 'http://localhost:8123/experience.json')
    expect(mod.isOpenWebsiteRepository(host)).toBe(true)
    expect(mod.websiteIdentityLocked(host)).toBe(true)
    const cleanup = vi.fn()
    await expect(mod.removeWebsiteRepository(host, cleanup)).rejects.toThrow('学习通是默认仓库，不能删除')
    expect(cleanup).not.toHaveBeenCalled()
    expect(await mod.websiteRepositoryHosts()).toContain(host)
    await mod.setWebsiteExperienceUrl(host, '')
    expect(mod.websiteIdentityLocked(host)).toBe(true)
  })

  it('deletes only the selected repository and keeps a deleted repository removed until imported again', async () => {
    const host = 'school.example'
    let mod = await import('../../src/services/agent/websiteRepository')
    await mod.importWebsiteRepository(candidate('school', host))
    await mod.importWebsiteRepository(candidate())
    const other = structuredClone(storage.value.entries['example.com'])
    await mod.writeWebsiteRepositorySupplement(host, 'private notes', '')
    const stale = mod.repositoryForHost(host)
    await mod.removeWebsiteRepository(host)
    await expect(stale.writeSupplement('stale notes', 'private notes')).rejects.toThrow()
    expect(storage.value.entries[host]).toBeUndefined()
    expect(storage.value.entries['example.com']).toEqual(other)
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.websiteRepositoryHosts()).not.toContain(host)
    await mod.importWebsiteRepository(candidate('school', host))
    expect(await mod.websiteRepositoryHosts()).toContain(host)
    expect((await mod.readWebsiteRepositoryFile(host, 'SKILL.md')).content).not.toContain('private notes')
  })

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

  it('uses the selected manifest on save, upgrade and restore, including a previously disabled source', async () => {
    const host = 'chaoxing.com'
    const customUrl = 'http://127.0.0.1:8123/experience.json'
    const openUrl = 'https://open.zerrorai.com/v1/website-experience/' + host
    const base = snapshot('chaoxing', host)
    const cloud = { ...base, scriptManifest: './official-manifest.json' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === openUrl ? cloud : url === customUrl
      ? { ...base, scriptManifest: './dev-manifest.json' } : base)))
    let mod = await import('../../src/services/agent/websiteRepository')
    await mod.refreshWebsiteRepository(host, true)
    expect(await mod.websiteScriptSource(host)).toEqual({ url: openUrl, manifest: cloud.scriptManifest })
    await mod.setWebsiteExperienceUrl(host, customUrl)
    const expected = { url: customUrl, manifest: './dev-manifest.json' }
    expect(await mod.websiteScriptSource(host)).toEqual(expected)

    storage.value.entries[host].document.customSource.scriptsEnabled = false
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    await mod.ensureWebsiteRepository(host)
    expect(await mod.websiteScriptSource(host)).toEqual(expected)
    expect(storage.value.entries[host].document.customSource).not.toHaveProperty('scriptsEnabled')

    await mod.setWebsiteExperienceUrl(host, customUrl + '?docs-only')
    expect(await mod.websiteScriptSource(host)).toBeNull()
    await mod.setWebsiteExperienceUrl(host, '')
    expect(await mod.websiteScriptSource(host)).toEqual({ url: openUrl, manifest: cloud.scriptManifest })
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
    const initial = { ...snapshot('chaoxing', 'chaoxing.com'), tools: [] }
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
  it.each([['zjooc', 'zjooc.cn'], ['zhihuishu', 'zhihuishu.com'], ['school', 'school.example']])(
    'installs %s on demand and respects deletion across restarts and later visits', async (id, host) => {
      const root = 'https://open.zerrorai.com/v1/website-experience'
      const selected = candidate(id, host)
      const fetcher = vi.fn(async (url: string) => url === root
        ? Response.json({ sites: [{ ...selected.website, ...selected.source }] })
        : Response.json(snapshot(id, host)))
      vi.stubGlobal('fetch', fetcher)
      let mod = await import('../../src/services/agent/websiteRepository')
      expect(await mod.websiteRepositoryHosts()).toEqual(['chaoxing.com'])
      const page = 'https://course.' + host + '/lesson'
      expect(await mod.experienceHostForPage(page)).toBe(host)
      expect(mod.isOpenWebsiteRepository(host)).toBe(true)
      const cleanup = vi.fn()
      await mod.removeWebsiteRepository(host, cleanup)
      expect(cleanup).toHaveBeenCalledOnce()
      vi.resetModules()
      mod = await import('../../src/services/agent/websiteRepository')
      fetcher.mockClear()
      await mod.experienceHostForPage(page)
      expect(await mod.websiteRepositoryHosts()).toEqual(['chaoxing.com'])
      expect(fetcher.mock.calls.every(([url]) => url === root)).toBe(true)
      await mod.importWebsiteRepository(selected)
      expect(await mod.websiteRepositoryHosts()).toContain(host)
      expect(storage.value.removedOpenHosts).not.toContain(host)
    })
  it('reinstalls a removed Open repository for an explicit task while passive visits keep it removed', async () => {
    const root = 'https://open.zerrorai.com/v1/website-experience'
    const host = 'zjooc.cn'
    const selected = candidate('zjooc', host)
    const cloud = { ...snapshot('zjooc', host), tools: [{ type: 'function', function: {
      name: 'browser_login_zjooc', description: 'Login', parameters: { type: 'object' },
    } }], scriptManifest: '/v1/website-experience/zjooc.cn/script-manifest.json' }
    let fail = false
    const fetcher = vi.fn(async (url: string) => url === root
      ? Response.json({ sites: [{ ...selected.website, ...selected.source }] })
      : fail ? new Response(null, { status: 503 }) : Response.json(cloud))
    vi.stubGlobal('fetch', fetcher)
    let mod = await import('../../src/services/agent/websiteRepository')
    await mod.experienceHostForPage('https://www.zjooc.cn/')
    await mod.removeWebsiteRepository(host)
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    fetcher.mockClear()
    await mod.experienceHostForPage('https://www.zjooc.cn/login')
    expect(mod.hasWebsiteRepository(host)).toBe(false)
    expect(mod.websiteToolsForHost(host)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()

    // An unavailable source must preserve the uninstall marker and permit an explicit retry.
    fail = true
    await mod.experienceHostForTask('https://www.zjooc.cn/login')
    expect(mod.hasWebsiteRepository(host)).toBe(false)
    expect(storage.value.removedOpenHosts).toContain(host)
    fail = false
    expect(await mod.experienceHostForTask('https://background.zjooc.cn/login')).toBe(host)
    expect(mod.isOpenWebsiteRepository(host)).toBe(true)
    expect(mod.websiteToolsForHost(host)).toEqual(cloud.tools)
    expect(await mod.websiteScriptSource(host)).toMatchObject({ url: root + '/' + host })
    expect(storage.value.removedOpenHosts).not.toContain(host)
    expect(await mod.websiteRepositoryHosts()).toEqual(['chaoxing.com', host])
    expect(fetcher.mock.calls.every(([url]) => url === root || url === root + '/' + host)).toBe(true)
  })
  it('installs only the visited catalog site, shares concurrent requests and refreshes through Open after restart', async () => {
    const root = 'https://open.zerrorai.com/v1/website-experience'
    const host = 'school.example'
    const entry = (id: string, host: string) => ({ id, host, name: id, url: 'https://github.com/owner/' + id, branch: 'main', root: 'skills/' + id })
    const cloud = snapshot('school', host)
    const fetcher = vi.fn(async (url: string) => {
      if (url === root) return Response.json({ sites: [entry('school', host), entry('other', 'other.example')] })
      if (url === root + '/' + host) return Response.json(cloud)
      if (url === root + '/' + host + '?revision=' + cloud.revision) return Response.json({ ...cloud, revision: 'b'.repeat(40), files: { ...cloud.files, 'SKILL.md': main('school', 'Updated') } })
      throw new Error('unexpected request ' + url)
    })
    vi.stubGlobal('fetch', fetcher)
    let mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.experienceHostForPage('https://school.example.evil.test/private')).toBe('school.example.evil.test')
    expect(await mod.websiteRepositoryHosts()).not.toContain(host)
    const urls = ['https://portal.school.example/course?token=private', 'https://school.example/']
    expect(await Promise.all(urls.map(mod.experienceHostForPage))).toEqual([host, host])
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([root, root + '/' + host])
    expect(await mod.websiteRepositoryHosts()).not.toContain('other.example')
    await mod.writeWebsiteRepositorySupplement(host, 'Local note', '')
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.experienceHostForPage(urls[0])).toBe(host)
    expect(mod.isOpenWebsiteRepository(host)).toBe(true)
    await mod.refreshWebsiteRepository(host, true)
    const file = await mod.readWebsiteRepositoryFile(host, 'SKILL.md')
    expect(file.content).toContain('Updated')
    expect(file.supplement).toBe('Local note')
    expect(storage.download).not.toHaveBeenCalled()
  })
  it('accepts old removed builtin records and keeps previously installed non-default repositories', async () => {
    storage.value = { version: 2, entries: {}, removedBuiltins: ['chaoxing.com', 'zhihuishu.com'] }
    let mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.websiteRepositoryHosts()).toEqual(['chaoxing.com'])
    await mod.importWebsiteRepository(candidate('zhihuishu', 'zhihuishu.com'))
    await mod.writeWebsiteRepositorySupplement('zhihuishu.com', 'Existing notes', '')
    vi.resetModules()
    mod = await import('../../src/services/agent/websiteRepository')
    expect(await mod.websiteRepositoryHosts()).toContain('zhihuishu.com')
    expect((await mod.readWebsiteRepositoryFile('zhihuishu.com', 'SKILL.md')).supplement).toBe('Existing notes')
  })
  it('upgrades the old single-website cache without losing its local notes', async () => {
    const old = snapshot('chaoxing', 'chaoxing.com')
    storage.value = { version: 1, generation: 2, upstream: old, migrated: true,
      fork: { id: 'local', parentRevision: old.revision, updatedAt: 1, files: { 'SKILL.md': main('chaoxing', 'Private local') }, bases: { 'SKILL.md': old.files['SKILL.md'] }, conflicts: [] } }
    const mod = await import('../../src/services/agent/websiteRepository')
    expect((await mod.readWebsiteRepositoryFile('chaoxing.com', 'SKILL.md')).content).toContain('Private local')
    expect(await mod.websiteRepositoryHosts()).toEqual(['chaoxing.com'])
    expect(storage.value.version).toBe(2)
    expect(storage.value.entries['chaoxing.com'].document.supplement).toContain('Private local')
    expect(storage.value.entries['zjooc.cn']).toBeUndefined()
  })
  it('serializes persistence across websites without mixing local edits', async () => {
    const mod = await import('../../src/services/agent/websiteRepository')
    await mod.importWebsiteRepository(candidate('zjooc', 'zjooc.cn'))
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
    await expect(mod.importWebsiteRepository(candidate('chaoxing', 'chaoxing.com'))).rejects.toThrow('另一仓库')
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
