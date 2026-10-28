import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ inputs: [] as any[] }))
vi.mock('../../src/services/model/config', () => ({ fetchRemoteModelsCatalog: vi.fn().mockResolvedValue({}) }))
vi.mock('../../src/services/model/protocol', () => ({
  resolveRuntimeModelId: () => 'vision',
  resolveExecutableModelJsCode: () => `async function processModel(input) { globalThis.__imageQuestionInputs.push(input); return 'ANSWER: 2'; }`,
}))
vi.mock('../../src/services/questionServer/deps', () => ({ modelApi: {
  platforms: { value: [{ models: [{ id: 'vision' }] }] },
  selectedVisionModel: { value: { id: 'vision', displayName: 'Vision' } },
} }))
vi.mock('../../src/services/questionServer/search', () => ({ runSearchForRequest: vi.fn().mockResolvedValue(null) }))
vi.mock('../../src/services/questionServer/backend', () => ({ sendModelProgressToBackend: vi.fn(), sendModelResponseToBackend: vi.fn() }))
vi.mock('../../src/services/questionServer/invoke', () => ({
  getReasoningContentValue: () => '', withModelRetry: (_id, _label, _enabled, run) => run(1, 1),
}))
vi.mock('../../src/services/questionServer/visionImage', () => ({
  applyWhiteBackgroundToDataUrl: async value => value,
  ensureDataUrlMinimumSize: async value => value,
  prepareVisionRequestContent: async value => value,
  executeVisionModelWithAutoUpscale: (processModel, input, config, fetch, signal) => processModel(input, config, fetch, signal),
}))
vi.mock('../../src/utils/question/questionImage', async importOriginal => ({
  ...await importOriginal<any>(), fetchQuestionImageBase64: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
import { fetchQuestionImageBase64 } from '../../src/utils/question/questionImage'
import { analyzeUrlQuestion, handleUrlQuestionRequest } from '../../src/services/questionServer/urlQuestion'
import { buildQuestionImagePreview } from '../../src/services/questionServer/imageQuestion'
import { requestLogs, clearAllRequestRuntimeState } from '../../src/services/questionServer/runtime'
import { sendModelProgressToBackend, sendModelResponseToBackend } from '../../src/services/questionServer/backend'
const images = ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']
const urls = ['https://a.test/render?id=1', 'https://a.test/second.png']
const question = (title: string, options: string, supplied?: string[]) => ({
  title, options, images: supplied, questionType: 'single', imageUrl: null, analyzing: false,
  analysisResult: null, analysisError: '', streamingResponse: '', streamingReasoning: '', reasoningContent: '',
})
beforeEach(() => {
  vi.clearAllMocks(); state.inputs.length = 0
  vi.stubGlobal('__imageQuestionInputs', state.inputs)
  vi.stubGlobal('window', { clearInterval, setInterval })
  clearAllRequestRuntimeState(); requestLogs.value = []
  vi.mocked(fetchQuestionImageBase64).mockImplementation(async url => images[urls.indexOf(url)])
})
afterEach(() => { clearAllRequestRuntimeState(); vi.unstubAllGlobals() })
it('OCS-on and OCS-off produce the same multimodal input, and local answers are restored before callback', async () => {
  requestLogs.value = [{ id: 'local', timestamp: 0, method: 'POST', path: '/query', ip: '', userAgent: '',
    urlQuestion: question('选出正确图形', `A. ${urls[0]}\n说明一\nB. ${urls[1]}\n说明二`) }]
  const preview = buildQuestionImagePreview(requestLogs.value[0].urlQuestion!)
  await analyzeUrlQuestion('local'); await preview
  expect(fetchQuestionImageBase64).toHaveBeenCalledTimes(2)
  const localAnswer = JSON.parse(vi.mocked(sendModelResponseToBackend).mock.calls[0][1])
  expect(localAnswer.answer).toBe(`${urls[1]}\n说明二`)
  requestLogs.value.push({ id: 'ocs', timestamp: 0, method: 'POST', path: '/query', ip: '', userAgent: '',
    urlQuestion: question('选出正确图形', 'A. [图片1]\n说明一\nB. [图片2]\n说明二', images) })
  await analyzeUrlQuestion('ocs')
  expect(state.inputs).toHaveLength(2)
  expect(state.inputs[0]).toEqual(state.inputs[1])
  expect(fetchQuestionImageBase64).toHaveBeenCalledTimes(2)
  expect(JSON.parse(vi.mocked(sendModelResponseToBackend).mock.calls[1][1]).answer).toBe('[图片2]\n说明二')
})
it('failed local image download never calls the model and is reported as failure', async () => {
  vi.mocked(fetchQuestionImageBase64).mockRejectedValue(new Error('denied'))
  requestLogs.value = [{ id: 'failed', timestamp: 0, method: 'POST', path: '/query', ip: '', userAgent: '',
    urlQuestion: question(urls[0], 'A. 一个选项\nB. 另一个选项') }]
  await analyzeUrlQuestion('failed')
  expect(state.inputs).toHaveLength(0)
  expect(sendModelResponseToBackend).toHaveBeenCalledWith('failed', expect.stringContaining('图片下载或转换失败'), false)
})

it('uses question metadata even when the model event arrives before its request log', async () => {
  await handleUrlQuestionRequest('late', '题干\n__OPTIONS__:A. [图片1]\nB. [图片2]', images)
  requestLogs.value.push({ id: 'late', timestamp: 0, method: 'POST', path: '/query', ip: '', userAgent: '',
    requestBody: JSON.stringify({ type: 'multiple', title: '原题', options: '原选项', has_images: true }) })
  await vi.waitFor(() => expect(sendModelResponseToBackend).toHaveBeenCalled(), { timeout: 1500, interval: 10 })
  expect(requestLogs.value[0].urlQuestion?.questionType).toBe('multiple')
  expect(JSON.stringify(state.inputs[0])).toContain('多选题')
  expect(fetchQuestionImageBase64).not.toHaveBeenCalled()
})

it('keeps the backend active while legacy images are still downloading', async () => {
  let finish: (image: string) => void
  vi.mocked(fetchQuestionImageBase64).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  requestLogs.value = [{ id: 'slow', timestamp: 0, method: 'POST', path: '/query', ip: '', userAgent: '',
    urlQuestion: question(urls[0], 'A. 第一项\nB. 第二项') }]
  const task = analyzeUrlQuestion('slow')
  expect(sendModelProgressToBackend).toHaveBeenCalledWith('slow', expect.stringContaining('准备图片'))
  expect(state.inputs).toHaveLength(0)
  finish!(images[0]); await task
  expect(state.inputs).toHaveLength(1)
})
