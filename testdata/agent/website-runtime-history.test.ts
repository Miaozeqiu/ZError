import { expect, it } from 'vitest'
import { assistantTurnToHistory, messageHistoryText, modelVisibleTranscript } from '../../src/services/agent/modelHistory'
import type { AgentChatMessage, AgentTranscriptItem } from '../../src/services/agent/chatTypes'

it('模型回放和摘要投影移除内部调用及配对结果，保留外层工具与正文，不修改审计原文', () => {
  const transcript: AgentTranscriptItem[] = [
    { role: 'assistant', content: '', tool_calls: [
      { id: 'internal', type: 'function', function: { name: 'browser_package_read', arguments: '{"request":"internal-paper"}' } },
      { id: 'public', type: 'function', function: { name: 'browser_site_academy__read_questions', arguments: '{"limit":4}' } },
    ] },
    { role: 'tool', tool_call_id: 'internal', content: 'internal-whole-paper' },
    { role: 'tool', tool_call_id: 'public', content: '{"questions":["current-batch"]}' },
    { role: 'assistant', content: '已核对当前批次。', tool_calls: [{ id: 'write', type: 'function', function: { name: 'browser_package_act', arguments: '{"json":"internal-upload"}' } }] },
    { role: 'tool', name: 'browser_package_act', tool_call_id: 'write', content: 'internal-upload' },
  ]
  const original = structuredClone(transcript)
  const message = { role: 'assistant', content: '已读取四题。', transcript, steps: [] } as unknown as AgentChatMessage
  for (const text of [JSON.stringify(assistantTurnToHistory(message)), messageHistoryText(message)]) {
    expect(text).not.toContain('internal-')
    expect(text).not.toContain('browser_package_')
    expect(text).toContain('current-batch')
    expect(text).toContain('已核对当前批次')
  }
  expect(modelVisibleTranscript(transcript)).toHaveLength(3)
  expect(transcript).toEqual(original)
})

it('只有步骤记录的历史也不会把内部请求和正文带回模型', () => {
  const message = { role: 'assistant', content: '已完成本批。', steps: [
    { id: 'private', name: 'browser_package_read', kind: 'tool', status: 'done', arguments: '{}', result: 'internal-whole-paper' },
    { id: 'public', name: 'browser_site_academy__auto_answer', kind: 'tool', status: 'done', arguments: '{}', result: '{"items":[]}' },
  ] } as unknown as AgentChatMessage
  expect(JSON.stringify(assistantTurnToHistory(message))).not.toContain('internal-whole-paper')
  expect(messageHistoryText(message)).not.toContain('browser_package_read')
  expect(JSON.stringify(assistantTurnToHistory(message))).toContain('browser_site_academy__auto_answer')
})
