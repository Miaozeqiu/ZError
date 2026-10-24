import type { AgentChatSession, AgentTodoItem } from '../../services/agent/chatTypes'
import type { ImportTaskStep } from '../../services/app/importTasks'

export interface AgentTaskCard {
  id: string
  title: string
  todos: AgentTodoItem[]
}

const readTodos = (value: unknown): AgentTodoItem[] => Array.isArray(value)
  ? value.filter((item): item is AgentTodoItem => !!item && typeof item.id === 'string'
    && typeof item.text === 'string' && ['pending', 'done', 'cancelled'].includes(item.status))
  : []

/** Recover plans from persisted tool snapshots; checks update a card instead of
 * adding duplicates. Message/session snapshots also support older conversations. */
export const taskHistoryFor = (session: AgentChatSession | null | undefined): AgentTaskCard[] => {
  if (!session) return []
  const cards: AgentTaskCard[] = []
  const owners = new Map<string, AgentTaskCard>()
  let prompt = ''
  const record = (id: string, title: string, value: unknown, newPlan = false) => {
    const todos = readTodos(value)
    if (!todos.length) return
    const existing = !newPlan && todos.map(todo => owners.get(todo.id)).find(Boolean)
    const card = existing || { id, title: title || todos[0].text, todos: [] }
    card.todos = todos.map(todo => ({ ...todo }))
    if (!existing) cards.push(card)
    for (const todo of todos) owners.set(todo.id, card)
  }
  const visit = (steps: ImportTaskStep[], title: string) => {
    for (const step of steps) {
      if (step.name === 'browser_todo' && step.status === 'done' && step.result) {
        try {
          const result = JSON.parse(step.result)
          let newPlan = false
          try { newPlan = JSON.parse(step.arguments || '{}').action === 'set' } catch { /* Older/truncated arguments. */ }
          if (result?.ok === true) record(step.id, title, result.todos, newPlan)
        } catch { /* A clipped tool result can fall back to the message snapshot. */ }
      }
      if (step.children?.length) visit(step.children, title)
    }
  }
  for (const message of session.messages || []) {
    if (message.role === 'user') {
      prompt = message.content.replace(/\s+/g, ' ').trim().slice(0, 100)
      continue
    }
    visit(message.steps || [], prompt)
    record(message.id, prompt, message.todos)
  }
  record(`${session.id}-tasks`, session.title, session.todos)
  return cards.reverse()
}
