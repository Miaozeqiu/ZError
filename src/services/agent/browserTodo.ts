import type { AgentTodoItem } from './chatTypes'

let todoSequence = 0
const nextTodoId = (now: number) => `todo-${now}-${++todoSequence}`

export const applyBrowserTodo = (
  current: AgentTodoItem[],
  args: Record<string, unknown>,
): { ok: true; todos: AgentTodoItem[]; hint: string } | { ok: false; error: string; todos: AgentTodoItem[] } => {
  const action = String(args.action || '').trim()
  const now = Date.now()
  const reason = String(args.reason || '').trim().slice(0, 300)
  const unresolved = current.some(item => item.status === 'pending')

  if (action === 'set') {
    const raw = Array.isArray(args.items) ? args.items : []
    const texts = raw
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (texts.length > 12) return { ok: false, error: '清单最多 12 项，请按阶段规划，不能截掉剩余任务。', todos: current }
    if (unresolved && !reason) return { ok: false, error: '替换未完成清单需要 reason，说明目标为何调整；不要用重写清单省略未完成任务。', todos: current }
    if (!texts.length) {
      return { ok: false, error: 'set 需要 items：用你自己的话写下具体步骤', todos: current }
    }
    const todos = texts.map((text) => ({
      id: nextTodoId(now),
      text: text.slice(0, 80),
      status: 'pending' as const,
    }))
    return {
      ok: true,
      todos,
      hint: `已记下 ${todos.length} 步。按清单做，做完一项就 check；全部完成再用自己的话 browser_finish。`,
    }
  }

  if (action === 'add') {
    const text = String(args.text || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!text) return { ok: false, error: 'add 需要 text', todos: current }
    if (current.some((item) => item.text === text && item.status !== 'cancelled')) {
      return { ok: true, todos: current, hint: '这一项已在清单里。' }
    }
    if (current.length >= 12) return { ok: false, error: '清单已满，不能丢弃已有步骤。完成当前阶段后再规划下一阶段。', todos: current }
    const todos = [...current, { id: nextTodoId(now), text, status: 'pending' as const }]
    return { ok: true, todos, hint: `已加入「${text}」。` }
  }

  if (action === 'check') {
    const wantId = String(args.id || '').trim()
    const wantIndex = Number(args.index)
    const wantText = String(args.text || '').replace(/\s+/g, ' ').trim()
    const statusRaw = String(args.status || 'done').trim()
    if (!['pending', 'done', 'cancelled'].includes(statusRaw)) return { ok: false, error: 'status 必须是 pending / done / cancelled', todos: current }
    const status: AgentTodoItem['status'] = statusRaw === 'pending' || statusRaw === 'cancelled' ? statusRaw : 'done'
    if (status === 'cancelled' && !reason) return { ok: false, error: '取消步骤需要 reason，说明用户目标变更或该步骤为何不再需要；无法执行应报告 blocked。', todos: current }
    const norm = (value: string) => String(value || '').replace(/^\d+[.、．)]\s*/, '').replace(/\s+/g, '')
    const matches = wantText ? current.filter(item => norm(item.text) === norm(wantText)) : []
    const hit = wantId ? current.find(item => item.id === wantId)
      : args.index !== undefined ? (Number.isInteger(wantIndex) && wantIndex >= 1 ? current[wantIndex - 1] : undefined)
      : wantText ? (matches.length === 1 ? matches[0] : undefined)
      : current.find(item => item.status === 'pending')
    if (!hit) {
      return {
        ok: false,
        error: '目标不匹配。使用准确的 id、index（从 1 起）或唯一的步骤原文；只有未指定目标时才勾第一项未完成。',
        todos: current,
      }
    }
    const todos: AgentTodoItem[] = current.map((item) => (item.id === hit.id ? { ...item, status, reason: reason || undefined } : item))
    const pending = todos.filter((item) => item.status === 'pending').length
    return {
      ok: true,
      todos,
      hint: pending
        ? `「${hit.text}」→ ${status}。还剩 ${pending} 项未完成。`
        : `「${hit.text}」→ ${status}。清单已无待办，请核对实际结果再 browser_finish；取消的步骤不代表已完成。`,
    }
  }

  if (action === 'clear') {
    if (unresolved && !reason) return { ok: false, error: '清空未完成清单需要 reason；任务受阻应保留清单并报告 blocked。', todos: current }
    return { ok: true, todos: [], hint: '已清空清单。' }
  }

  return {
    ok: false,
    error: 'action 必须是 set / add / check / clear',
    todos: current,
  }
}

export const pendingTodos = (todos?: AgentTodoItem[] | null) =>
  (todos || []).filter((item) => item.status === 'pending')

const toolRoundsWithoutTodo = new Map<string, number>()

export const noteToolRoundForTodo = (sessionId: string, hadTodos: boolean, isTodoTool: boolean) => {
  const id = String(sessionId || '').trim()
  if (!id || isTodoTool) return
  if (hadTodos) {
    toolRoundsWithoutTodo.delete(id)
    return
  }
  toolRoundsWithoutTodo.set(id, (toolRoundsWithoutTodo.get(id) || 0) + 1)
}

export const toolRoundsWithoutTodoOf = (sessionId: string) => (
  toolRoundsWithoutTodo.get(String(sessionId || '').trim()) || 0
)

export const formatTodoNudge = (todos: AgentTodoItem[], opts?: { mustSet?: boolean }) => {
  const pending = pendingTodos(todos)
  if (!todos.length) {
    if (opts?.mustSet) {
      return '多步任务先 browser_todo action=set 写下 3–8 步，再按目标执行。清单用于跟踪进度，不替代用户目标或授权。'
    }
    return '还没有任务清单。多步任务先 browser_todo action=set；单步（读页、点一下）可以先做。'
  }
  if (pending.length) {
    return `清单未完成：${pending.map((item) => item.text).join('、')}。做完一项就 check。没勾完不能 finish(done)。`
  }
  return '清单项都已完成。用自己的话写 summary，再 browser_finish(status=done|watching|blocked)。'
}
