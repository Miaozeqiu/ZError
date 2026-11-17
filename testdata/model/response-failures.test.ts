import { describe, expect, it } from 'vitest'
import cases from './response-cases.json'
import { assertSuccessfulModelResponse, getModelResponseFailure, trackModelHttpOutcome } from '../../src/services/questionServer/errors'
import { normalizeAnswerJsonContent } from '../../src/utils/answer/answerNormalize'
describe('model response failure contract', () => {
  for (const item of cases) it(item.input, () => {
    expect(!!getModelResponseFailure(item.input)).toBe(item.fails)
    if (item.fails) expect(() => assertSuccessfulModelResponse(item.input)).toThrow()
    else expect(() => assertSuccessfulModelResponse(item.input)).not.toThrow()
  })
  it('rejects provider errors returned as objects and inside stream chunks', () => {
    expect(() => assertSuccessfulModelResponse({ error: { message: 'stream failed' } })).toThrow('stream failed')
    expect(() => assertSuccessfulModelResponse({ content: '', error: { message: 'rate limit' } })).toThrow('rate limit')
  })
  it('keeps incomplete completion slots through callback normalization', () => {
    expect(JSON.parse(normalizeAnswerJsonContent('{"answer":"甲######丙"}')).answer).toBe('甲######丙')
  })
})


it('rejects a failed HTTP response even if the adapter returns its plain body', async () => {
  const transport = trackModelHttpOutcome(async () => new Response('Unauthorized', { status: 401 }))
  const response = await transport.fetch('https://example.invalid')
  expect(await response.text()).toBe('Unauthorized')
  expect(() => transport.assertSuccess()).toThrow('HTTP 401')
})
it('preserves legitimate endpoint fallback from 404 to a successful response', async () => {
  let calls = 0
  const transport = trackModelHttpOutcome(async () => new Response('body', { status: ++calls === 1 ? 404 : 200 }))
  await transport.fetch('https://example.invalid/v1/messages')
  await transport.fetch('https://example.invalid/anthropic/v1/messages')
  expect(() => transport.assertSuccess()).not.toThrow()
})
it('rejects network failures swallowed by a custom model adapter', async () => {
  const transport = trackModelHttpOutcome(async () => { throw new Error('Failed to fetch') })
  try { await transport.fetch('https://example.invalid') } catch { /* adapter handles it */ }
  expect(() => transport.assertSuccess()).toThrow('Failed to fetch')
})
