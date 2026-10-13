import type { AgentTodoItem } from './chatTypes'

export const applyBrowserTodo = (
  current: AgentTodoItem[],
  args: Record<string, unknown>,
): { ok: true; todos: AgentTodoItem[]; hint: string } | { ok: false; error: string; todos: AgentTodoItem[] } => {
  const action = String(args.action || '').trim()
  const now = Date.now()

  if (action === 'set') {
    const raw = Array.isArray(args.items) ? args.items : []
    const texts = raw
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 12)
    if (!texts.length) {
      return { ok: false, error: 'set 需要 items：用你自己的话写下具体步骤', todos: current }
    }
    const todos = texts.map((text, index) => ({
      id: `todo-${now}-${index}`,
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
    const todos = [...current, { id: `todo-${now}`, text, status: 'pending' as const }].slice(-12)
    return { ok: true, todos, hint: `已加入「${text}」。` }
  }

  if (action === 'check') {
    const wantId = String(args.id || '').trim()
    const wantIndex = Number(args.index)
    const wantText = String(args.text || '').replace(/\s+/g, ' ').trim()
    const statusRaw = String(args.status || 'done').trim()
    const status: AgentTodoItem['status'] = statusRaw === 'pending' || statusRaw === 'cancelled' ? statusRaw : 'done'
    const norm = (value: string) => String(value || '').replace(/^\d+[.、．)]\s*/, '').replace(/\s+/g, '')
    const hit = current.find((item) => item.id === wantId)
      || (Number.isFinite(wantIndex) && wantIndex >= 1 ? current[wantIndex - 1] : null)
      || (wantText
        ? current.find((item) => {
          const a = norm(item.text)
          const b = norm(wantText)
          return a === b || a.includes(b) || b.includes(a)
        })
        : null)
      || current.find((item) => item.status === 'pending')
    if (!hit) {
      return {
        ok: false,
        error: '找不到该项。传 id、index（从 1 起）或 text；不传就勾第一项未完成。',
        todos: current,
      }
    }
    const todos: AgentTodoItem[] = current.map((item) => (item.id === hit.id ? { ...item, status } : item))
    const pending = todos.filter((item) => item.status === 'pending').length
    return {
      ok: true,
      todos,
      hint: pending
        ? `「${hit.text}」→ ${status}。还剩 ${pending} 项未完成。`
        : `「${hit.text}」→ ${status}。清单已全部完成，用自己的话写 summary 并 browser_finish。`,
    }
  }

  if (action === 'clear') {
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
      return '多步任务必须先 browser_todo action=set 写下 3–8 步，再 invoke / 配方。清单是行动许可。'
    }
    return '还没有任务清单。多步任务先 browser_todo action=set；单步（读页、点一下）可以先做。'
  }
  if (pending.length) {
    return `清单未完成：${pending.map((item) => item.text).join('、')}。做完一项就 check。没勾完不能 finish(done)。`
  }
  return '清单项都已完成。用自己的话写 summary，再 browser_finish(status=done|watching|blocked)。'
}
