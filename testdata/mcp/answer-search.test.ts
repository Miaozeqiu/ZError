import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/services/questionServer/deps', () => ({
  modelApi: {
    platforms: { value: [] }, selectedTextModels: { value: [] },
    selectedSummaryModels: { value: [] }, selectedVisionModel: { value: null },
  },
}))
vi.mock('../../src/services/questionServer/backend', () => ({
  sendModelProgressToBackend: vi.fn().mockResolvedValue(undefined),
  sendModelResponseToBackend: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/services/questionServer/visionImage', () => ({ buildRenderedHtml: vi.fn().mockResolvedValue('') }))
vi.mock('../../src/services/questionServer/search', () => ({
  getSearchQuestionText: vi.fn().mockReturnValue('question and options'),
  runSearchForRequest: vi.fn(),
}))
vi.mock('../../src/services/questionServer/invoke', () => ({
  callModelWithStreaming: vi.fn().mockResolvedValue('ANSWER: A'),
  formatModelOutputs: (_models, results) => results.join('\n'),
  getMostFrequentSuccessfulAnswer: () => 'ANSWER: A',
  stripMarkdownCodeBlock: text => text,
  withModelRetry: (_requestId, _name, _allow, run) => run(1, 1),
}))

import { modelApi } from '../../src/services/questionServer/deps'
import { callModelAPI } from '../../src/services/questionServer/answerCall'
import { callModelWithStreaming } from '../../src/services/questionServer/invoke'
import { runSearchForRequest } from '../../src/services/questionServer/search'
import * as runtime from '../../src/services/questionServer/runtime'

beforeEach(() => {
  vi.stubGlobal('window', { clearInterval })
  runtime.clearAllRequestRuntimeState()
  runtime.requestLogs.value = [{ id: 'q1', timestamp: Date.now(), method: 'GET', path: '/query', ip: '', userAgent: '' }]
  modelApi.selectedTextModels.value = [{ id: 'm1', displayName: 'one' }, { id: 'm2', displayName: 'two' }] as any
  modelApi.selectedSummaryModels.value = []
  modelApi.platforms.value = [{ displayName: 'platform', models: modelApi.selectedTextModels.value }] as any
  vi.mocked(callModelWithStreaming).mockClear()
  vi.mocked(runSearchForRequest).mockReset().mockResolvedValue({ context: 'shared search excerpts', trace: {} } as any)
})
afterEach(() => { runtime.clearAllRequestRuntimeState(); vi.unstubAllGlobals() })

test('multiple answer models share one search and receive its context', async () => {
  await callModelAPI('q1', 'question')
  expect(runSearchForRequest).toHaveBeenCalledTimes(1)
  expect(callModelWithStreaming).toHaveBeenCalledTimes(2)
  expect(vi.mocked(callModelWithStreaming).mock.calls.every(args => args[5] === 'shared search excerpts')).toBe(true)
})

test('search failure still lets the answer models run without context', async () => {
  vi.mocked(runSearchForRequest).mockResolvedValue(null)
  await callModelAPI('q1', 'question')
  expect(callModelWithStreaming).toHaveBeenCalledTimes(2)
  expect(vi.mocked(callModelWithStreaming).mock.calls.every(args => args[5] === '')).toBe(true)
})

test('summary models receive the shared search context in their prompt', async () => {
  modelApi.selectedSummaryModels.value = [{ id: 'summary', displayName: 'summary' }] as any
  await callModelAPI('q1', 'question')
  expect(runSearchForRequest).toHaveBeenCalledTimes(1)
  expect(callModelWithStreaming).toHaveBeenCalledTimes(3)
  expect(vi.mocked(callModelWithStreaming).mock.calls[2][1]).toContain('shared search excerpts')
})
