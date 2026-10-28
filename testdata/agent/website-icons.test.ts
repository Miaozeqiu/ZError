// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ files: new Map<string, string>(), decode: vi.fn(), fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 1 }, mkdir: async () => {},
  readTextFile: async (path: string) => { if (!io.files.has(path)) throw Error('ENOENT'); return io.files.get(path)! },
  writeTextFile: async (path: string, value: string) => { io.files.set(path, value) },
}))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => 'https://authserver.open.ha.cn/authserver/login' }))
const primary = 'menhu.haou.edu.cn'
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const ctx = () => ({ browserId: () => 'tab', abort: new AbortController().signal }) as any
const run = async (args: any, context = ctx()) => JSON.parse(await (await import('../../src/services/agent/websiteIconTool')).websiteIconTool({ args, ctx: context, call: {} as any }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); io.files.clear()
  io.decode.mockResolvedValue(undefined)
  io.fetch.mockImplementation(async () => new Response(png, { headers: { 'Content-Type': 'text/plain' } }))
  vi.stubGlobal('fetch', io.fetch)
  vi.stubGlobal('Image', class { src = ''; decode() { return io.decode(this.src) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('verified website icons', () => {
  it('ships the three official assets locally, without relying on favicon path guesses', async () => {
    const { builtinWebsiteIcons } = await import('../../src/services/agent/websiteIcons')
    expect(Object.keys(builtinWebsiteIcons)).toEqual(['chaoxing.com', 'zhihuishu.com', 'zjooc.cn'])
    for (const url of Object.values(builtinWebsiteIcons)) expect(url).not.toMatch(/^https?:/)
  })
  it('caches a real image for the primary website, preserves aliases, and restores it after restart/settings edits', async () => {
    const result = await run({ icon_url: 'https://cdn.example.com/logo.png' })
    expect(result).toMatchObject({ ok: true, host: primary, cached: true })
    expect(JSON.stringify(result)).not.toContain('base64')
    const mod = await import('../../src/services/agent/websiteIdentity')
    const icon = mod.websiteIdentityForHost(primary)?.iconDataUrl
    expect(icon).toMatch(/^data:image\/png;base64,/)
    expect(mod.websiteIdentityForHost('authserver.open.ha.cn')?.iconDataUrl).toBe(icon)
    expect(io.fetch.mock.calls[0][1].credentials).toBe('omit')
    await mod.saveWebsiteIdentity(primary, '河南开放大学', ['authserver.open.ha.cn'])
    vi.resetModules()
    const restored = await import('../../src/services/agent/websiteIdentity')
    await restored.loadWebsiteIdentities()
    expect(restored.websiteIdentityForHost(primary)).toMatchObject({ name: '河南开放大学', loginHosts: ['authserver.open.ha.cn'], iconDataUrl: icon })
  })
  it('rejects failed downloads, HTML responses and corrupt images without replacing a working icon', async () => {
    await run({ website: primary, icon_url: 'https://cdn.example.com/original.png' })
    const { websiteIdentityForHost } = await import('../../src/services/agent/websiteIdentity')
    const original = websiteIdentityForHost(primary)?.iconDataUrl
    io.fetch.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    expect(await run({ icon_url: 'https://cdn.example.com/missing.png' })).toMatchObject({ ok: false })
    io.fetch.mockResolvedValueOnce(new Response('<html>Access denied</html>', { headers: { 'Content-Type': 'image/png' } }))
    expect((await run({ icon_url: 'https://cdn.example.com/error.png' })).error).toContain('不是支持的图标图片')
    io.decode.mockRejectedValueOnce(new Error('Image decoding failed'))
    expect(await run({ icon_url: 'https://cdn.example.com/corrupt.png' })).toMatchObject({ ok: false })
    expect(websiteIdentityForHost(primary)?.iconDataUrl).toBe(original)
  })
  it('rejects unsupported URLs before network access and limits response size', async () => {
    for (const icon_url of ['file:///tmp/icon.png', 'data:image/png;base64,AAA=', 'https://user:secret@example.com/icon']) {
      expect(await run({ icon_url })).toMatchObject({ ok: false })
    }
    expect(io.fetch).not.toHaveBeenCalled()
    io.fetch.mockResolvedValueOnce(new Response(new Uint8Array(256 * 1024 + 1)))
    expect((await run({ icon_url: 'https://cdn.example.com/huge.png' })).error).toContain('256 KB')
    const { websiteIdentityForHost } = await import('../../src/services/agent/websiteIdentity')
    expect(websiteIdentityForHost(primary)?.iconDataUrl).toBeUndefined()
  })
  it('stops instead of persisting when the user cancels, and times out stalled decoding', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(run({ icon_url: 'https://cdn.example.com/logo.png' }, { ...ctx(), abort: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(io.fetch).not.toHaveBeenCalled()
    vi.useFakeTimers()
    io.decode.mockImplementationOnce(() => new Promise(() => {}))
    const pending = run({ icon_url: 'https://cdn.example.com/logo.png' })
    await vi.advanceTimersByTimeAsync(12001)
    expect(await pending).toMatchObject({ ok: false })
    expect(io.files.size).toBe(0)
  })
  it('is available to normal and browser agents, but not read-only exploration', async () => {
    const { assembleAgentTools, assembleBrowserTools } = await import('../../src/services/agent/tools')
    expect(assembleAgentTools().filter(t => t.function.name === 'set_website_icon')).toHaveLength(1)
    expect(assembleBrowserTools({ role: 'parent' }).some(t => t.function.name === 'set_website_icon')).toBe(true)
    expect(assembleBrowserTools({ role: 'explore' }).some(t => t.function.name === 'set_website_icon')).toBe(false)
  })
})
