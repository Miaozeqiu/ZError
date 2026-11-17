import { describe, expect, it, vi } from 'vitest'
import { resolveContextBudget, estimateContextTokens, IMAGE_CONTEXT_TOKENS } from '../../src/services/model/contextBudget'
import { splitSummaryText, summarizeRecord } from '../../src/services/model/contextSummary'
import { compactExecutionContext } from '../../src/services/model/contextCompaction'
import { compactAgentRequestMessages } from '../../src/services/model/agentRequestContext'
import { clipTranscript } from '../../src/services/agent/modelHistory'
import { projectToolResult } from '../../src/services/model/toolResultProjection'

describe('context projections and loss-aware compaction', () => {
  it('uses the configured window and reserves space for output; unknown windows use the same conservative fallback', () => {
    const budget = resolveContextBudget({ contextWindow: 8192, maxTokens: 2048 })
    expect(budget.inputLimit + budget.outputReserve + budget.safety).toBe(8192)
    expect(budget.estimatedWindow).toBe(false)
    expect(resolveContextBudget().contextWindow).toBe(65536)
    expect(resolveContextBudget({ contextWindow: NaN }).estimatedWindow).toBe(true)
    const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'x'.repeat(100000) } }
    expect(estimateContextTokens([image])).toBeGreaterThanOrEqual(IMAGE_CONTEXT_TOKENS)
    expect(estimateContextTokens([image])).toBeLessThan(IMAGE_CONTEXT_TOKENS + 30)
  })
  it('keeps long argument JSON intact and projects results as valid JSON with a read-back reference and receipt IDs', () => {
    const args = JSON.stringify({ script: 'x'.repeat(12000) })
    const result = JSON.stringify({ ok: false, resultUncertain: true, operation_id: 'op-1', observation_id: 'page-1', result: '尾'.repeat(40000) })
    const projected = clipTranscript([
      { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'browser_eval', arguments: args } }] },
      { role: 'tool', tool_call_id: 'call-1', content: result },
    ])
    expect(JSON.parse(projected[0].tool_calls![0].function.arguments)).toEqual(JSON.parse(args))
    expect(JSON.parse(String(projected[1].content))).toMatchObject({ operation_id: 'op-1', observation_id: 'page-1', history_ref: 'call-1', truncated: true })
  })
  it('does not drop user text to pretend that a soft projection threshold is a hard limit', () => {
    const text = '测'.repeat(30000)
    expect(compactAgentRequestMessages([{ role: 'user', content: text }])[0].content).toBe(text)
  })
  it('bounds nested error bodies without cutting operation IDs or producing broken JSON', () => {
    const projected = projectToolResult(JSON.stringify({ error: { html: '错'.repeat(30000) }, operation_id: 'exact-id', resultUncertain: true }), 1000, 'call')
    expect(projected.length).toBeLessThan(2500)
    expect(JSON.parse(projected)).toMatchObject({ operation_id: 'exact-id', resultUncertain: true, history_ref: 'call' })
  })
  it('omits old tool images after redaction clones, without stripping original user attachments', () => {
    const image = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }]
    const source = [{ role: 'user', content: image }, { role: 'user', __agentToolImage: true, content: image }, { role: 'user', __agentToolImage: true, content: image }]
    const projected = compactAgentRequestMessages(JSON.parse(JSON.stringify(source)))
    expect(projected[0].content).toEqual(image)
    expect(typeof projected[1].content).toBe('string')
    expect(projected[2].content).toEqual(image)
  })
  it('feeds the entire original text to bounded summary requests, including message tails and early records', async () => {
    const text = '首条约定'.repeat(1000) + '🙂'.repeat(200) + '末尾不能提交'
    const chunks = splitSummaryText(text, 1000)
    expect(chunks.join('')).toBe(text)
    const prompts: string[] = []
    const summary = await summarizeRecord({ text, previous: '之前约定', chunkTokens: 1000,
      summarize: async prompt => { prompts.push(prompt); return '合并后的摘要' } })
    expect(prompts[0]).toContain('之前约定')
    expect(prompts.at(-1)).toContain('末尾不能提交')
    expect(summary).toBe('合并后的摘要')
  })
  it('does not split signed assistant/tool batches or summarise private reasoning', async () => {
    const messages = [
      { role: 'system', content: '规则' }, { role: 'user', content: '只保存，不提交' },
      { role: 'assistant', content: '', thinking_blocks: [{ type: 'thinking', thinking: 'private thought', signature: 'opaque' }], tool_calls: [{ id: 'a', function: { name: 'one', arguments: '{}' } }, { id: 'b', function: { name: 'two', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: '第一条'.repeat(100) }, { role: 'tool', tool_call_id: 'b', content: '第二条'.repeat(100) },
      { role: 'assistant', content: '', thinking_blocks: [{ type: 'thinking', signature: 'keep-exact' }], tool_calls: [{ id: 'c', function: { name: 'three', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c', content: '最新回执' },
    ]
    const summarize = vi.fn(async () => '已完成 a、b，当前等待 c 的页面核对')
    const next = await compactExecutionContext({ messages, keepTokens: 100, summarize })
    expect(summarize).toHaveBeenCalledOnce()
    expect(summarize.mock.calls[0][0]).not.toContain('private thought')
    expect(summarize.mock.calls[0][0]).toContain('第一条')
    expect(next).toContain(messages[1])
    expect(next.slice(-2)).toEqual(messages.slice(-2))
    expect(next.some(item => item.tool_call_id === 'a')).toBe(false)
    expect(messages).toHaveLength(7)
  })
  it('cancels summarisation between chunks and never manufactures an empty successful summary', async () => {
    const abort = new AbortController()
    const summarize = vi.fn(async () => { abort.abort(); return '部分摘要' })
    await expect(summarizeRecord({ text: '长'.repeat(1500), chunkTokens: 256, signal: abort.signal, summarize })).rejects.toMatchObject({ name: 'AbortError' })
    expect(summarize).toHaveBeenCalledOnce()
    await expect(summarizeRecord({ text: '资料', chunkTokens: 1000, summarize: async () => '' })).rejects.toThrow('原记录保持不变')
  })
  it('rejects excessive archive work before issuing any paid summarisation requests', async () => {
    const summarize = vi.fn()
    await expect(summarizeRecord({ text: '长'.repeat(10000), chunkTokens: 256, summarize })).rejects.toThrow('待归档资料过大')
    expect(summarize).not.toHaveBeenCalled()
  })
})
