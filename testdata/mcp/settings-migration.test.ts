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
  expect(settingsManager.get('search')).toEqual({ enabled: false, apiKey: 'existing-key', provider: 'exa', deepseekApiKey: '' })
  settingsManager.import(JSON.stringify({ search: { enabled: true, apiKey: ' imported-key ', mode: 'local' } }))
  expect(settingsManager.get('search')).toEqual({ enabled: true, apiKey: 'imported-key', provider: 'exa', deepseekApiKey: '' })
})

test('DeepSeek model and search use one key without affecting a proxy or Exa', async () => {
  localStorage.setItem('app_settings', JSON.stringify({
    search: { enabled: true, provider: 'deepseek', apiKey: 'exa-key', deepseekApiKey: 'old-search-key' },
  }))
  const official = { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', isRemote: true, apiKey: 'old-model-key', models: [] }
  const proxy = { ...official, id: 'proxy', baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key' }
  localStorage.setItem('model_settings', JSON.stringify({ platforms: [official, proxy] }))
  const { modelConfigManager, withConfiguredDeepSeekKey } = await import('../../src/services/model/configManager')
  const { settingsManager } = await import('../../src/services/app/settings')
  await modelConfigManager.ready
  const search = settingsManager.get('search')
  const [model, other] = modelConfigManager.getPlatforms()

  expect(withConfiguredDeepSeekKey(search).deepseekApiKey).toBe('old-model-key')
  modelConfigManager.setDeepSeekApiKey('updated-from-search')
  expect(modelConfigManager.getPlatformApiKey(model)).toBe('updated-from-search')
  modelConfigManager.updatePlatform(model.id, { apiKey: 'updated-from-model' })
  expect(withConfiguredDeepSeekKey(search).deepseekApiKey).toBe('updated-from-model')
  expect(JSON.parse(modelConfigManager.export()).deepseekApiKey).toBe('')
  modelConfigManager.updatePlatform(model.id, { apiKey: '' })
  expect(withConfiguredDeepSeekKey(search).deepseekApiKey).toBe('')
  expect(modelConfigManager.getPlatformApiKey(other)).toBe('proxy-key')
  expect(withConfiguredDeepSeekKey({ ...search, provider: 'exa' }).apiKey).toBe('exa-key')
})

test('new search providers keep independent keys and omit them from exported settings', async () => {
  const { settingsManager } = await import('../../src/services/app/settings')
  settingsManager.import(JSON.stringify({ search: {
    provider: 'brave', tavilyApiKey: ' tv-key ', braveApiKey: 'br-key', youApiKey: 'you-key',
  } }))
  expect(settingsManager.get('search')).toMatchObject({
    provider: 'brave', tavilyApiKey: 'tv-key', braveApiKey: 'br-key', youApiKey: 'you-key',
  })
  expect(JSON.parse(settingsManager.export()).search).toMatchObject({
    provider: 'brave', tavilyApiKey: '', braveApiKey: '', youApiKey: '',
  })
})
