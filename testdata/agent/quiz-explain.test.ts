// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import AgentQuizBlock from '../../src/components/agent/AgentQuizBlock.vue'

vi.mock('../../src/services/app/database', () => ({ databaseService: {} }))

it('records an answer immediately and requests explanation only from the result button', async () => {
  const explainBusy = ref(false)
  const attempt = vi.fn()
  const explain = vi.fn()
  const quoteOption = vi.fn()
  const cards = [{
    uid: 'first', question: '请选择正确选项', options: 'A. 正确\nB. 错误', answer: 'A', question_type: '单选',
  }]
  const root = document.createElement('div')
  const app = createApp({ render: () => h(AgentQuizBlock, {
    stepId: 'quiz-explain-test', cards, explainBusy: explainBusy.value, onAttempt: attempt, onExplain: explain,
    onQuoteOption: quoteOption,
  }) })
  app.mount(root)
  try {
    expect(root.querySelector('.quiz-why')).toBeNull()
    root.querySelector<HTMLButtonElement>('.quiz-option')!.click()
    await nextTick()
    expect(attempt).toHaveBeenCalledOnce()
    expect(explain).not.toHaveBeenCalled()
    expect(root.querySelector('.quiz-result')?.textContent).toContain('回答正确')

    const quoteButtons = root.querySelectorAll<HTMLButtonElement>('.quiz-option-quote')
    expect(quoteButtons).toHaveLength(2)
    quoteButtons[1].click()
    expect(quoteOption).toHaveBeenCalledExactlyOnceWith({
      stepId: 'quiz-explain-test', uid: 'first', question_id: undefined,
      question: '请选择正确选项', key: 'B', text: '错误',
    })
    expect(attempt).toHaveBeenCalledOnce()
    expect(explain).not.toHaveBeenCalled()

    const button = root.querySelector<HTMLButtonElement>('.quiz-why')!
    expect(button.textContent).toBe('为什么🧐')
    explainBusy.value = true
    await nextTick()
    expect(button.disabled).toBe(true)
    button.click()
    expect(explain).not.toHaveBeenCalled()

    explainBusy.value = false
    await nextTick()
    button.click()
    expect(explain).toHaveBeenCalledExactlyOnceWith(attempt.mock.calls[0][0])
  } finally {
    app.unmount()
  }
})
