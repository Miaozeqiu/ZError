import { expect, it } from 'vitest'
import { conversationHistory } from '../../src/services/agent/conversationHistory'
import { taskStateContext } from '../../src/services/agent/core/taskContext'
import { newRun } from '../../src/services/agent/core/run'
import type { AgentChatSession } from '../../src/services/agent/chatTypes'

const session = (): AgentChatSession => ({ id: 'current', title: '任务', createdAt: 1, updatedAt: 1, messages: [
  { id: 'goal', role: 'user', content: '所有章节的视频和测验都要处理，最后只保存', status: 'done', steps: [] },
  { id: 'answer', role: 'assistant', content: '处理中', status: 'streaming', steps: [], run: { ...newRun('run'), goalMessageId: 'goal' }, todos: [{ id: 'one', text: '完成测验', status: 'pending' }],
    transcript: [{ role: 'tool', tool_call_id: 'large-result', content: '前'.repeat(20000) + '末尾题干与选项' }] },
] })
it('retrieves a long result tail by reference and pages without changing archived text', () => {
  const source = session()
  const search = conversationHistory(source, 'search', { query: '末尾题干' }) as any
  expect(search.matches[0]).toMatchObject({ message_id: 'answer', tool_call_id: 'large-result' })
  const read = conversationHistory(source, 'read', { tool_call_id: 'large-result', offset: 19998, limit: 12000 }) as any
  expect(read.text).toContain('末尾题干与选项'); expect(read.nextOffset).toBeNull()
  const page = conversationHistory(source, 'read', { tool_call_id: 'large-result', limit: 9999999 }) as any
  expect(page.text).toHaveLength(12000); expect(page.nextOffset).toBe(12000)
  expect(conversationHistory(source, 'read', { message_id: 'other-session-message' }).ok).toBe(false)
})
it('keeps the original task and current plan separate from a contradictory model summary', () => {
  const source = session()
  source.contextSummary = { text: '任务已全部完成', coveredCount: 1, coveredThrough: 'goal', tokens: 10, updatedAt: 2 }
  const context = taskStateContext(source, 'answer')
  expect(context).toContain('所有章节的视频和测验都要处理，最后只保存')
  expect(context).toContain('pending')
  expect(context).not.toContain('任务已全部完成')
})
it('can search legacy tool records with no returned content', () => {
  const source = session()
  source.messages[1].transcript!.push({ role: 'tool', tool_call_id: 'empty' })
  expect(conversationHistory(source, 'search', { query: '章节' }).ok).toBe(true)
})
