// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { localStorage.clear(); vi.resetModules() })

test('saved search settings retain the toggle and key while dropping old connection configuration', async () => {
  localStorage.setItem('app_settings', JSON.stringify({ search: {
    enabled: false, apiKey: '  existing-key  ', mode: 'local', localCommand: 'npx',
    localArgs: '-y old-server', localEnv: 'KEY=old', remoteUrl: 'https://legacy.invalid',
    authMode: 'bearer', customHeaders: '{invalid', timeoutSeconds: 100,
  } }))
  const { settingsManager } = await import('../../src/services/app/settings')
  expect(settingsManager.get('search')).toEqual({ enabled: false, apiKey: 'existing-key' })
  settingsManager.import(JSON.stringify({ search: { enabled: true, apiKey: ' imported-key ', mode: 'local' } }))
  expect(settingsManager.get('search')).toEqual({ enabled: true, apiKey: 'imported-key' })
})
