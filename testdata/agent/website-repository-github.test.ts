import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { runtimeFixture } from './fixtures/websiteRuntime'
import { downloadChaoxingRepository, discoverWebsiteRepositories } from '../../src/services/agent/websiteRepositoryGitHub'
import type { WebsiteSnapshot } from '../../src/services/agent/websiteRepositoryCore'

const files = { 'SKILL.md': '---\nname: chaoxing\ndescription: Website operations\n---\n# 学习通\n',
  'site-graph.json': JSON.stringify({ id: 'chaoxing', host: 'chaoxing.com', hostPattern: 'chaoxing\\.com', nodes: [], edges: [] }) }
const fallback: WebsiteSnapshot = { revision: 'bundled:1', checkedAt: 0, files }
const website = { version: 1, id: 'chaoxing', name: '学习通', host: 'chaoxing.com', icon: 'assets/icon.png' }
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZksAAAAASUVORK5CYII=', 'base64')
const sha = (text: string | Buffer) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')
const fixture = (extra: Record<string, string> = {}) => {
  const pack: Record<string, string | Buffer> = { ...files, 'website.json': JSON.stringify(website), 'assets/icon.png': icon, ...extra }
  const entries = Object.entries(pack).map(([path, text]) => ({ path: `skills/chaoxing/${path}`, mode: '100644', type: 'blob', sha: sha(text), size: Buffer.byteLength(text) }))
  const request = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    expect(init?.method).toBe('GET')
    expect((init?.headers as any).Authorization).toBeUndefined()
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } }, { headers: { etag: '"etag"' } })
    if (url.includes('/git/trees/')) return Response.json({ tree: entries, truncated: false })
    if (!url.includes('/git/blobs/')) return Response.json({ default_branch: 'main' })
    const text = Object.values(pack).find(text => url.endsWith(sha(text)))!
    return Response.json({ sha: sha(text), size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64') })
  })
  return { request, entries }
}

describe('GitHub website snapshot downloads', () => {
  it('accepts an integrity-checked compiled runtime from the same commit without exposing it as experience text', async () => {
    const runtime = runtimeFixture()
    const { request } = fixture({ 'runtime.json': JSON.stringify(runtime) })
    const result = await downloadChaoxingRepository(fallback, request as typeof fetch, 1000)
    expect(result.runtime).toEqual(runtime)
    expect(result.tools?.[0].function.name).toBe('browser_site_chaoxing__read_catalog')
    expect(result.files['runtime.json']).toBeUndefined()
    runtime.bundle.code += 'changed'
    const corrupt = fixture({ 'runtime.json': JSON.stringify(runtime) })
    await expect(downloadChaoxingRepository(fallback, corrupt.request as typeof fetch)).rejects.toThrow('哈希')
  })
  it('downloads a public snapshot pinned to one commit, verifying actual blob bytes', async () => {
    const { request } = fixture()
    const result = await downloadChaoxingRepository(fallback, request as typeof fetch, 1000)
    expect(result).toEqual({ revision: 'a'.repeat(40), checkedAt: 1000, etag: '"etag"', files, website, icon: { path: website.icon, dataUrl: `data:image/png;base64,${icon.toString('base64')}` } })
    expect(request.mock.calls[1][0]).toContain(`/git/trees/${'b'.repeat(40)}?recursive=1`)
    expect(request.mock.calls.slice(2).every(([url]) => /\/git\/blobs\/[a-f0-9]{40}$/.test(url))).toBe(true)
  })

  it('uses conditional reads and never downloads unchanged files', async () => {
    const previous = { ...fallback, revision: 'a'.repeat(40), etag: '"etag"' }
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as any)['If-None-Match']).toBe('"etag"')
      return new Response(null, { status: 304 })
    })
    expect(await downloadChaoxingRepository(previous, request as typeof fetch, 2000)).toEqual({ ...previous, checkedAt: 2000 })
    expect(request).toHaveBeenCalledOnce()
  })
  it('discovers a website and previews the icon from the same pinned repository tree', async () => {
    const { request } = fixture()
    expect(await discoverWebsiteRepositories('https://github.com/owner/repo', request as typeof fetch)).toEqual([{
      source: { owner: 'owner', name: 'repo', branch: 'main', root: 'skills/chaoxing', url: 'https://github.com/owner/repo' },
      website, icon: { path: website.icon, dataUrl: `data:image/png;base64,${icon.toString('base64')}` }, revision: 'a'.repeat(40),
    }])
  })
  it('rejects packages without an in-repository icon before importing any files', async () => {
    const { request, entries } = fixture()
    entries.splice(entries.findIndex(entry => entry.path.endsWith('/assets/icon.png')), 1)
    await expect(discoverWebsiteRepositories('owner/repo', request as typeof fetch)).rejects.toThrow('不支持')
    await expect(downloadChaoxingRepository(fallback, request as typeof fetch)).rejects.toThrow('不支持')
  })

  it('rejects truncated trees, unsafe paths and symlinks without accepting a partial cache', async () => {
    for (const entry of [{ path: 'skills/chaoxing/../../SKILL.md' }, { mode: '120000' }, { path: 'skills/chaoxing/scripts/run.js' }]) {
      const { request, entries } = fixture()
      Object.assign(entries[0], entry)
      await expect(downloadChaoxingRepository(fallback, request as typeof fetch)).rejects.toThrow('不支持')
    }
    const { request } = fixture()
    const original = request.getMockImplementation()!
    request.mockImplementation((url, init) => url.includes('/git/trees/') ? Promise.resolve(Response.json({ tree: [], truncated: true })) : original(url, init))
    await expect(downloadChaoxingRepository(fallback, request as typeof fetch)).rejects.toThrow('不完整')
  })

  it('rejects altered content even when the remote supplies a valid-looking SHA and length', async () => {
    const { request } = fixture(); const original = request.getMockImplementation()!
    request.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (!url.includes('/git/blobs/')) return response
      const body = await response.json()
      body.content = Buffer.from('x'.repeat(body.size)).toString('base64')
      return Response.json(body)
    })
    await expect(downloadChaoxingRepository(fallback, request as typeof fetch)).rejects.toThrow('校验失败')
  })

  it('honors rate-limit retry times, returning no replacement snapshot', async () => {
    const request = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    await expect(downloadChaoxingRepository(fallback, request as typeof fetch, 1000)).rejects.toMatchObject({ retryAt: 121000 })
    expect(request).toHaveBeenCalledOnce()
  })
})
