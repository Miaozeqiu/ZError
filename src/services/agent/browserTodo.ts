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
    const statusRaw = String(args.status || 'done').trim()
    const status: AgentTodoItem['status'] = statusRaw === 'pending' || statusRaw === 'cancelled' ? statusRaw : 'done'
    const hit = current.find((item) => item.id === wantId)
      || (Number.isFinite(wantIndex) && wantIndex >= 1 ? current[wantIndex - 1] : null)
    if (!hit) {
      return {
        ok: false,
        error: '找不到该项，传 id 或 index（从 1 起）',
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

export const formatTodoNudge = (todos: AgentTodoItem[]) => {
  const pending = pendingTodos(todos)
  if (!todos.length) {
    return (
      '先用 browser_todo action=set 把用户任务拆成具体步骤（内容必须你自己写，例如「登录学习通」「进入应用高等数学」「点章节找未完成」「播放并交给监控」），'
      + '再按清单调用工具。禁止空喊 browser_finish，也禁止用套话 summary。'
    )
  }
  if (pending.length) {
    return (
      `清单还有未完成：${pending.map((item) => item.text).join('、')}。`
      + '继续调用工具做这些事；做完一项立刻 browser_todo action=check。不要提前 browser_finish。'
    )
  }
  return (
    '清单项都已完成。用你自己的话写 summary（概括实际做了什么/交到哪一步），'
    + '调用 browser_finish(status=done|watching|blocked, summary=…)。禁止套话，禁止写在正文里。'
  )
}
