// @vitest-environment jsdom
import { nextTick } from 'vue'
import { expect, test, vi } from 'vitest'
import type { AIPlatform, ApiProtocol, ModelSettings } from '../../src/services/model/configTypes'

const storage = vi.hoisted(() => ({ saved: null as ModelSettings | null }))
vi.mock('../../src/services/security/secureStore', () => ({
  readSecureDocument: async (name: string) => name === 'model_settings' ? storage.saved : null,
  writeSecureDocument: async (name: string, value: ModelSettings) => {
    if (name === 'model_settings') storage.saved = value
    return value
  },
}))
vi.mock('../../src/services/app/settings', () => ({
  settingsManager: { ready: Promise.resolve(), getSettings: () => ({ search: {} }) },
}))

const remote = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../src/services/app/openApi', () => ({ fetchOpenApiJson: remote.fetch }))

test('legacy text and vision choices share one selection after reload and import', async () => {
  const textIds = ['text-1', 'text-2', 'text-3', 'text-4', 'text-5']
  const allIds = [...textIds, 'vision', 'second-vision']
  const legacy = {
    globalSettings: {},
    selectedTextModels: textIds,
    selectedVisionModel: 'vision',
    selectedSummaryModel: 'text-1',
    selectedAgentModel: 'second-vision',
    platforms: [{
      id: 'custom_test',
      name: 'Test',
      enabled: true,
      models: allIds.map(id => ({ id, category: id.includes('vision') ? 'vision' : 'text', enabled: true })),
    }],
  }
  storage.saved = legacy as ModelSettings
  vi.resetModules()
  const { modelConfigManager: manager } = await import('../../src/services/model/configManager')
  await manager.ready
  expect(manager.getSelectedTextModels().map(model => model.id)).toEqual([...textIds, 'vision'])
  expect(manager.getSelectedVisionModel()?.id).toBe('vision')
  expect(manager.getSelectedSummaryModel()?.id).toBe('text-1')
  expect(manager.getSelectedAgentModel()?.id).toBe('second-vision')
  manager.toggleSelectedTextModel('second-vision')
  expect(manager.isTextModelSelected('second-vision')).toBe(false)

  manager.toggleSelectedTextModel('vision')
  expect(manager.getSelectedVisionModel()).toBeNull()
  manager.toggleSelectedTextModel('second-vision')
  expect(manager.getSelectedVisionModel()?.id).toBe('second-vision')
  expect(JSON.parse(manager.export())).not.toHaveProperty('selectedVisionModel')

  manager.import(JSON.stringify({ ...legacy, selectedTextModels: ['vision', ...textIds] }))
  expect(manager.getSelectedTextModels().map(model => model.id)).toEqual(['vision', ...textIds])
})

test('remote connection edits survive reload and sync, and reset restores both current defaults', async () => {
  vi.resetModules()
  const catalog = (apiProtocol: ApiProtocol, baseUrl = 'https://provider.test') => ({
    platforms: [{
      id: 'provider',
      name: 'Provider',
      baseUrl,
      apiProtocol,
      models: [{ id: 'remote-model' }],
    }],
  })
  // Existing installations only stored the effective address and protocol.
  storage.saved = {
    platforms: [{
      ...catalog('anthropic').platforms[0],
      isRemote: true,
      apiKey: 'test-key',
      models: [{ id: 'remote-model', isRemote: true }],
    } as AIPlatform],
  } as ModelSettings

  const { modelConfigManager: initialManager } = await import('../../src/services/model/configManager')
  await initialManager.ready
  remote.fetch.mockResolvedValue(catalog('anthropic', 'https://provider.test/v1'))
  await initialManager.syncRemotePlatforms()
  expect(initialManager.getPlatforms()[0].baseUrl).toBe('https://provider.test/v1')

  initialManager.updatePlatform('provider', { baseUrl: 'https://gateway.test/v1' })
  initialManager.setPlatformApiProtocol('provider', 'openai-chat')
  await nextTick()

  vi.resetModules()
  const { modelConfigManager: manager } = await import('../../src/services/model/configManager')
  await manager.ready
  expect(manager.getPlatforms()[0]).toMatchObject({
    baseUrl: 'https://gateway.test/v1', remoteBaseUrl: 'https://provider.test/v1',
    apiProtocol: 'openai-chat', remoteApiProtocol: 'anthropic',
  })

  remote.fetch.mockResolvedValue(catalog('openai-response', 'https://provider.test/v2'))
  await manager.syncRemotePlatforms()
  expect(manager.getPlatforms()[0]).toMatchObject({
    apiKey: 'test-key',
    baseUrl: 'https://gateway.test/v1',
    remoteBaseUrl: 'https://provider.test/v2',
    apiProtocol: 'openai-chat',
    remoteApiProtocol: 'openai-response',
    models: [{ id: 'remote-model', apiProtocol: 'openai-chat' }],
  })

  manager.resetPlatformConnection('provider')
  expect(manager.getPlatforms()[0]).toMatchObject({
    apiKey: 'test-key',
    baseUrl: 'https://provider.test/v2',
    apiProtocol: 'openai-response',
    models: [{ id: 'remote-model', apiProtocol: 'openai-response' }],
  })
  expect(manager.getPlatforms()[0].apiProtocolOverride).toBeUndefined()
  await nextTick()
  await manager.save()
  expect(storage.saved?.platforms[0].baseUrlOverride).toBeUndefined()
  expect(storage.saved?.platforms[0].apiProtocolOverride).toBeUndefined()

  vi.resetModules()
  const { modelConfigManager: resetManager } = await import('../../src/services/model/configManager')
  remote.fetch.mockResolvedValue(catalog('anthropic', 'https://provider.test/v3'))
  await resetManager.syncRemotePlatforms()
  expect(resetManager.getPlatforms()[0]).toMatchObject({
    baseUrl: 'https://provider.test/v3', apiProtocol: 'anthropic',
  })
})
