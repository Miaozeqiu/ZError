/** 一次模型回复结束前的任务检查；不发模型请求，也不执行网页操作。 */
import type { AgentTodoItem } from './chatTypes'

export type AgentTaskOutcome = 'completed' | 'blocked' | 'incomplete'
export type CompletionStep = { id: string; name: string; status: string; result?: string }
type TaskSnapshot = { todos: AgentTodoItem[]; steps: CompletionStep[] }

const object = (raw?: string): Record<string, unknown> => {
  try { return JSON.parse(raw || '{}') || {} } catch { return {} }
}
// 只读问答和网站资料维护可以直接答复；实际网页操作需要网页收尾回执。
const observation = /^(browser_get_state|browser_get_page|browser_find|browser_screenshot|browser_decode_chaoxing_font|browser_eval|browser_wait|browser_site_graph)$/
const needsReceipt = (step: CompletionStep) => step.name.startsWith('browser_') && !observation.test(step.name)

export const currentTaskFinish = ({ steps, todos }: TaskSnapshot): 'done' | 'blocked' | undefined => {
  const reverseIndex = [...steps].reverse().findIndex(step => step.name === 'browser_finish')
  if (reverseIndex < 0) return
  const index = steps.length - reverseIndex - 1
  const step = steps[index]!
  const result = object(step.result)
  if (step.status !== 'done' || result.ok !== true || result.finished !== true || result.error) return
  // 旧回执不能覆盖之后的新操作、失败、清单修改，或并发执行中的操作。
  if (steps.some((item, at) => item.name.startsWith('browser_') && (at > index || item.status === 'running'))) return
  if (result.status === 'blocked') return 'blocked'
  if (result.status === 'done' && !todos.some(item => item.status === 'pending')) return 'done'
}

export const createTaskCompletionCheck = (read: () => TaskSnapshot) => {
  let previous = ''
  let idleStops = 0
  let outcome: AgentTaskOutcome | undefined
  return {
    get outcome() { return outcome },
    get active() { const state = read(); return Boolean(state.todos.length || state.steps.some(needsReceipt)) },
    terminal: () => currentTaskFinish(read()),
    beforeComplete: (remainingRounds: number, continuation?: string): string | undefined => {
      const state = read()
      const finish = currentTaskFinish(state)
      if (finish) { outcome = finish === 'done' ? 'completed' : 'blocked'; return }
      const pending = state.todos.filter(item => item.status === 'pending')
      if (!continuation && !pending.length && !state.steps.some(needsReceipt)) return

      outcome = 'incomplete'
      const progress = JSON.stringify([state.todos, state.steps.map(step => [step.id, step.status])])
      idleStops = progress === previous ? idleStops + 1 : 1
      previous = progress
      if (remainingRounds <= 0) throw new Error('任务尚未完成：已达到本轮执行次数上限，未完成步骤已保留。')
      if (idleStops >= 3) throw new Error('任务尚未完成：模型连续只输出说明，未继续执行或报告有效阻塞，已停止重试。未完成步骤已保留。')
      if (continuation) return continuation
      return pending.length
        ? `【任务仍在进行】还有未完成步骤：${pending.map(item => item.text).join('；')}。刚才的文字仅是进展说明。根据已有工具结果继续下一步，操作失败先修复；实际完成并核对结果后再 check。确实无法继续时 browser_finish(status=blocked, summary=具体阻塞原因)。不要为了结束而批量勾选、清空或取消清单。`
        : '【尚未确认任务结束】网页操作或收尾尝试尚无有效的最终回执。根据已有结果核对目标，成功后 browser_finish(status=done)，确实受阻则 browser_finish(status=blocked)。若之前收尾被拒绝，处理返回原因；不要重复已成功的操作，也不能改成普通文字绕过检查。'
    },
  }
}
