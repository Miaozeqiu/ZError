import { describe, expect, it } from 'vitest'
import { dispatchSiteBrowserTool, registerSiteBrowserAdapter, siteBrowserAdapterFor, siteNavigationFor } from '../../src/services/browser/siteCapabilities'
import { hostCapabilitiesFor } from '../../src/services/agent/hostCapabilities'

describe('application-owned site capabilities', () => {
  it('keeps ordinary hosts independent and removes capabilities on teardown', async () => {
    const url = 'https://adapter.test/course'
    const stop = registerSiteBrowserAdapter({
      id: 'test-site', matches: target => new URL(target).hostname === 'adapter.test',
      navigation: siteNavigationFor('https://ordinary.test'), capabilities: { catalog: true },
      tools: ['test_tool'], dispatch: async () => 'result',
    })
    try {
      expect(hostCapabilitiesFor(url).catalog).toBe(true)
      expect(hostCapabilitiesFor('https://ordinary.test/?url=https://adapter.test').catalog).toBe(false)
      expect(await dispatchSiteBrowserTool({ name: 'test_tool' })).toBe('result')
      expect(await dispatchSiteBrowserTool({ name: 'unknown_tool' })).toBeNull()
    } finally { stop() }
    expect(hostCapabilitiesFor(url).catalog).toBe(false)
    expect(siteBrowserAdapterFor(url)).toBeUndefined()
  })
  it('an old disposer cannot remove a later registration', () => {
    const adapter = { id: 'replaceable', matches: () => false, navigation: siteNavigationFor(''), capabilities: {}, tools: [], dispatch: async () => null }
    const oldStop = registerSiteBrowserAdapter(adapter); oldStop()
    const replacement = { ...adapter }
    const stop = registerSiteBrowserAdapter(replacement)
    expect(() => registerSiteBrowserAdapter(adapter)).toThrow('Duplicate')
    oldStop()
    expect(() => registerSiteBrowserAdapter(adapter)).toThrow('Duplicate')
    stop()
  })
})
