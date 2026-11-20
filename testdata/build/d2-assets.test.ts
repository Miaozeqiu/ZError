import { afterEach, describe, expect, it, vi } from 'vitest'
import { d2Assets } from '../../scripts/vite/d2Assets'

const loadAssets = async (production = true) => {
  const plugin = d2Assets()
  ;(plugin.configResolved as Function)({ command: production ? 'build' : 'serve' })
  const assets: Array<{ name: string; source: string }> = []
  const source = (plugin.load as Function).call({
    emitFile(asset: { name: string; source: string }) {
      assets.push(asset)
      return 'asset' + (assets.length - 1)
    },
  }, '\0virtual:zerror-d2-assets') as string
  const code = source.replace(/import\.meta\.ROLLUP_FILE_URL_asset(\d+)/g, (_, index) => JSON.stringify('/' + assets[index].name))
  // Each test gets an independent module cache and pending request.
  const runtime = await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(code) + '#case=' + Math.random())
  return { runtime, assets }
}

afterEach(() => vi.unstubAllGlobals())

describe('D2 asset loading', () => {
  it('loads bundled payloads only on demand and shares concurrent requests', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, text: async () => url }))
    vi.stubGlobal('fetch', fetchMock)
    const { runtime, assets } = await loadAssets()
    expect(assets.length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
    const first = runtime.prepareD2Assets()
    expect(runtime.prepareD2Assets()).toBe(first)
    await first
    expect(runtime.payloads).toEqual(assets.map(asset => '/' + asset.name))
    await runtime.prepareD2Assets()
    expect(fetchMock).toHaveBeenCalledTimes(assets.length)
  })

  it('rejects missing resources and allows a later retry', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { runtime, assets } = await loadAssets()
    await expect(runtime.prepareD2Assets()).rejects.toThrow('404')
    expect(runtime.payloads).toEqual([])
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, text: async () => 'restored' }))
    await runtime.prepareD2Assets()
    expect(runtime.payloads).toEqual(assets.map(() => 'restored'))
  })

  it('keeps the original payloads available offline in development', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { runtime, assets } = await loadAssets(false)
    expect(assets).toEqual([])
    expect(runtime.payloads.some((payload: string) => payload.length > 1_000_000)).toBe(true)
    await runtime.prepareD2Assets()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
