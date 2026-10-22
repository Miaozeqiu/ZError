import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_SEARCH_SETTINGS } from '../../src/services/app/settings'

vi.mock('../../src/services/app/settings', () => ({
  DEFAULT_SEARCH_SETTINGS: {
    enabled: true, apiKey: '',
  },
}))
vi.mock('../../src/services/questionServer/deps', () => ({ settingsApi: { settings: { search: null } } }))
vi.mock('../../src/services/questionServer/backend', () => ({ sendModelProgressToBackend: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../src/services/questionServer/visionImage', () => ({ buildRenderedHtml: vi.fn().mockResolvedValue('') }))
vi.mock('../../src/services/searchService', async original => ({
  ...await original<typeof import('../../src/services/searchService')>(), performWebSearch: vi.fn(),
}))

import { performWebSearch } from '../../src/services/searchService'
import { settingsApi } from '../../src/services/questionServer/deps'
import { getSearchQuestionText, runSearchForRequest } from '../../src/services/questionServer/search'
import * as runtime from '../../src/services/questionServer/runtime'

beforeEach(() => {
  vi.stubGlobal('window', { setInterval: (...args: any[]) => setInterval(...args), clearInterval })
  runtime.clearAllRequestRuntimeState()
  settingsApi.settings.search = { ...DEFAULT_SEARCH_SETTINGS }
  runtime.requestLogs.value = [{
    id: 'request1', timestamp: Date.now(), method: 'GET', path: '/query', ip: '', userAgent: '',
    requestBody: JSON.stringify({ title: 'question', options: 'A. option' }),
  }]
  vi.mocked(performWebSearch).mockImplementation((_query, _config, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
  }))
})
afterEach(() => { runtime.clearAllRequestRuntimeState(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('stopping the service cancels the real search runtime and clears heartbeats', async () => {
  const pending = runSearchForRequest('request1', getSearchQuestionText('request1'), 'model')
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(runtime.activeModelAbortControllers.size).toBe(1)
  runtime.cancelAllInFlightModelRequests()
  await rejected
  expect(runtime.cancelledRequestIds.has('request1')).toBe(true)
  expect(runtime.searchHeartbeatTimers.size).toBe(0)
  expect(runtime.activeModelAbortControllers.size).toBe(0)
  expect(runtime.requestLogs.value[0].status).toBe(499)
})

test('clearing logs cancels the search even after cancellation flags are removed', async () => {
  const pending = runSearchForRequest('request1', 'question', 'model')
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  runtime.clearAllRequestRuntimeState()
  await rejected
  expect(runtime.requestLogs.value).toHaveLength(0)
  expect(runtime.searchHeartbeatTimers.size).toBe(0)
  expect(runtime.activeModelAbortControllers.size).toBe(0)
})

test('search failure records its error and allows answering to continue', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(performWebSearch).mockRejectedValue(new Error('server unavailable'))
  await expect(runSearchForRequest('request1', 'question', 'model')).resolves.toBeNull()
  expect(runtime.requestLogs.value[0].searchTraces?.[0]).toMatchObject({ status: 'error', error: 'server unavailable' })
  expect(runtime.activeModelAbortControllers.size).toBe(0)
  expect(runtime.searchHeartbeatTimers.size).toBe(0)
})

test('search-disabled and image-only questions do not send a search', async () => {
  vi.mocked(performWebSearch).mockClear()
  settingsApi.settings.search.enabled = false
  await expect(runSearchForRequest('request1', 'question', 'model')).resolves.toBeNull()
  settingsApi.settings.search.enabled = true
  await expect(runSearchForRequest('request1', 'https://example.test/image.png', 'model')).resolves.toBeNull()
  expect(performWebSearch).not.toHaveBeenCalled()
})
