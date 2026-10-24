// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'

const state = vi.hoisted(() => ({ chat: null as any }))
vi.mock('../../src/services/agent/chat', async () => {
  const { ref } = await import('vue')
  state.chat = ref(null)
  return { activeChat: state.chat, hydrateQuizCards: vi.fn(async cards => cards), isChatBusy: ref(false) }
})
vi.mock('../../src/services/app/database', () => ({ databaseService: { getStudyGraph: vi.fn(async () => ({ nodes: [] })) } }))
vi.mock('../../src/services/study/graphStream', async () => ({ studyGraphStream: (await import('vue')).ref(null), finishStudyGraphStream: vi.fn() }))
vi.mock('../../src/utils/study/studyGraph', () => ({ graphFromPayload: vi.fn() }))
vi.mock('../../src/utils/question/quizPractice', () => ({ getQuizCards: () => [], parseMarkdownQuizzes: () => [] }))
vi.mock('../../src/views/agentChat/threadDisplay', () => ({
  isBrowseQuizStep: () => false,
  isQuizStep: (step: any) => step.name === 'present_quiz',
  quizCardsFor: (step: any) => step.cards || [],
  quizKeyOf: (message: string, step: string) => `${message}\t${step}`,
  quizStatFor: () => '1 题', quizTitleFor: () => '练习', stepQuizCards: () => [],
}))
import {
  availableGraphSubjectId, availableQuizKey, availableWriteStepId, bindAgentChatPanes,
  openGraphPane, openedGraphSubjectId, openedQuizKey, openedWriteStepId,
  selectAgentPane, selectedAgentPane, toggleQuiz,
} from '../../src/views/agentChat/useAgentChatPanes'

const chat = (id: string) => ({ id, messages: [{ id: 'message', role: 'assistant', status: 'done', content: '', steps: [
  { id: 'first', name: 'present_quiz', cards: [{}] },
  { id: 'latest', name: 'present_quiz', cards: [{}] },
  { id: 'saved', name: 'save_questions', preview: [{}] },
] }] })
let scope: EffectScope
let sequence = 0
beforeEach(() => {
  openedQuizKey.value = null; openedWriteStepId.value = null; openedGraphSubjectId.value = null
  state.chat.value = chat(`session-${++sequence}`)
  scope = effectScope(); scope.run(bindAgentChatPanes)
})
afterEach(() => scope.stop())

describe('Agent header panel switching', () => {
  it('returns to the selected older quiz after showing the browser', () => {
    toggleQuiz('message', 'first')
    selectAgentPane('browser')
    expect(selectedAgentPane.value).toBe('browser')
    selectAgentPane('quiz')
    expect(openedQuizKey.value).toBe('message\tfirst')
    selectAgentPane('quiz')
    expect(selectedAgentPane.value).toBe('quiz')
  })
  it('switches exclusively between saved questions, graph and browser', async () => {
    selectAgentPane('write')
    expect(openedQuizKey.value).toBeNull()
    expect(openedWriteStepId.value).toBe('saved')
    openGraphPane(42); await nextTick()
    expect(selectedAgentPane.value).toBe('graph')
    selectAgentPane('browser')
    expect(availableGraphSubjectId.value).toBe(42)
    selectAgentPane('graph')
    expect(openedGraphSubjectId.value).toBe(42)
    expect(openedWriteStepId.value).toBeNull()
  })
  it('does not carry panel targets into another conversation', async () => {
    openGraphPane(42)
    state.chat.value = { id: `empty-${sequence}`, messages: [] }
    await nextTick()
    expect(selectedAgentPane.value).toBe('browser')
    expect(availableGraphSubjectId.value).toBeNull()
    expect(availableQuizKey.value).toBeNull()
    expect(availableWriteStepId.value).toBeNull()
    selectAgentPane('quiz'); selectAgentPane('graph'); selectAgentPane('write')
    expect(selectedAgentPane.value).toBe('browser')
  })
})
