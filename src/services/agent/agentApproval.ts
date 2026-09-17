import { reactive } from 'vue'

export type AgentApprovalKind = 'submit' | 'write_skill'

export type AgentApprovalRequest = {
  id: string
  sessionId: string
  kind: AgentApprovalKind
  title: string
  detail: string
}

type Waiter = {
  resolve: (allow: boolean) => void
  reject: (error: Error) => void
}

export const agentApprovalState = reactive({
  pending: null as AgentApprovalRequest | null,
})

const waiters = new Map<string, Waiter>()

const drop = (id: string) => {
  waiters.delete(id)
  if (agentApprovalState.pending?.id === id) agentApprovalState.pending = null
}

export const requestAgentApproval = (input: {
  sessionId: string
  kind: AgentApprovalKind
  title: string
  detail?: string
  signal?: AbortSignal
}) => new Promise<boolean>((resolve, reject) => {
  if (input.signal?.aborted) {
    reject(new DOMException('已停止', 'AbortError'))
    return
  }
  const previous = agentApprovalState.pending
  if (previous) {
    const waiter = waiters.get(previous.id)
    drop(previous.id)
    waiter?.resolve(false)
  }
  const id = `approval-${Date.now()}`
  const pending: AgentApprovalRequest = {
    id,
    sessionId: input.sessionId,
    kind: input.kind,
    title: input.title,
    detail: String(input.detail || '').trim(),
  }
  const onAbort = () => {
    if (!waiters.has(id)) return
    drop(id)
    reject(new DOMException('已停止', 'AbortError'))
  }
  waiters.set(id, {
    resolve: (allow) => {
      input.signal?.removeEventListener('abort', onAbort)
      drop(id)
      resolve(allow)
    },
    reject: (error) => {
      input.signal?.removeEventListener('abort', onAbort)
      drop(id)
      reject(error)
    },
  })
  agentApprovalState.pending = pending
  input.signal?.addEventListener('abort', onAbort, { once: true })
})

export const resolveAgentApproval = (id: string, allow: boolean) => {
  const waiter = waiters.get(id)
  if (!waiter) return
  waiter.resolve(allow)
}

export const cancelApprovalsForSession = (sessionId: string) => {
  const pending = agentApprovalState.pending
  if (!pending || pending.sessionId !== sessionId) return
  const waiter = waiters.get(pending.id)
  drop(pending.id)
  waiter?.resolve(false)
}

export const approvalTitleOf = (kind: AgentApprovalKind) => (
  kind === 'submit' ? '提交作业' : '写入 Skill'
)
