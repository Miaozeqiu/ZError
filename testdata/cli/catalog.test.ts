import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ resolve: vi.fn(), installed: vi.fn(), ensure: vi.fn(), tools: vi.fn() }))
vi.mock('../../src/services/agent/tools', () => ({ assembleAgentTools: () => [{ type: 'function', function: { name: 'browser_get_page' } }], availableAgentTools: (v: unknown) => v }))
vi.mock('../../src/services/agent/websiteRuntime/hostTools', () => ({ WEBSITE_HOST_TOOLS: [] }))
vi.mock('../../src/services/agent/websiteRepository', () => ({ experienceHostForPage: f.resolve, hasWebsiteRepository: f.installed, ensureWebsiteRepository: f.ensure, websiteToolsForHost: f.tools }))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { ready: Promise.resolve(), get: () => ({ enabled: true }) } }))
import { cliToolCatalog } from '../../src/services/cli/catalog'
beforeEach(() => { vi.clearAllMocks(); f.resolve.mockResolvedValue('example.com'); f.installed.mockReturnValue(false); f.tools.mockReturnValue([]) })
it('does not try to load a nonexistent repository on ordinary pages', async () => {
  expect((await cliToolCatalog('https://example.com')).map(t => t.function.name)).toContain('browser_get_page')
  expect(f.ensure).not.toHaveBeenCalled()
})
it('retains generic browser tools during Open discovery failures', async () => {
  f.resolve.mockRejectedValueOnce(new Error('offline'))
  expect(await cliToolCatalog('https://example.com')).toHaveLength(1)
})
it('loads installed compiled tools and deduplicates definitions', async () => {
  f.installed.mockReturnValue(true)
  f.tools.mockReturnValue([{ type: 'function', function: { name: 'browser_get_page' } }, { type: 'function', function: { name: 'browser_site_example__read' } }])
  expect(await cliToolCatalog('https://example.com')).toHaveLength(2)
  expect(f.ensure).toHaveBeenCalledWith('example.com')
})
