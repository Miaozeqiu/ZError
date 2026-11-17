// @vitest-environment jsdom
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: network.fetch }))
import { bindModelTest } from '../../src/views/settings/ModelSettings/testModel'
const model: any = { id: 'test', modelId: 'test', apiProtocol: 'openai-chat', hasVision: false }
const create = () => {
  const state: any = { selectedPlatform: ref({ apiProtocol: 'openai-chat', baseUrl: 'https://model.test', apiKey: 'synthetic' }), testingModelId: ref(null), testAbortController: ref(null), currentTestResult: ref(null), currentTestError: ref(''), streamingResponse: ref(''), streamingReasoning: ref(''), showTestDialog: ref(true) }
  return { state, api: bindModelTest(state) }
}
const reply = (message: any) => new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { network.fetch.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => undefined) })
describe('model settings uses the production compiled provider', () => {
  it('plain text proves connectivity but does not prove function calling', async () => {
    network.fetch.mockImplementation(async () => reply({ content: 'hello' }))
    const { state, api } = create(); await api.testModel(model, false)
    expect(state.currentTestResult.value.success).toBe(true)
    await api.testModel(model, true)
    expect(state.currentTestResult.value).toBeNull(); expect(state.currentTestError.value).toContain('未实际成功调用')
  })
  it('actually executes a synthetic tool and checks the final model response', async () => {
    network.fetch.mockResolvedValueOnce(reply({ tool_calls: [{ id: 'call', function: { name: 'encrypt_string', arguments: '{"text":"HelloZError"}' } }] })).mockResolvedValueOnce(reply({ content: 'SGVsbG9aRXJyb3I=' }))
    const { state, api } = create(); await api.testModel(model, true)
    expect(state.currentTestResult.value).toMatchObject({ success: true, toolCallingVerified: true })
    const body = JSON.parse(network.fetch.mock.calls[1][1].body)
    expect(body.messages.some((item: any) => item.role === 'tool' && item.tool_call_id === 'call')).toBe(true)
  })
  it('bounds non-converging tool tests', async () => {
    network.fetch.mockImplementation(async () => reply({ tool_calls: [{ id: 'call', function: { name: 'encrypt_string', arguments: '{"text":"x"}' } }] }))
    const { state, api } = create(); await api.testModel(model, true)
    expect(network.fetch).toHaveBeenCalledTimes(4)
    expect(state.currentTestError.value).toContain('未收敛')
    expect(state.currentTestResult.value).toBeNull()
  })
})
