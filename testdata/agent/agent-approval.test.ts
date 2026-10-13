import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentApprovalState,
  requestAgentApproval,
  resolveAgentApproval,
  SKILL_AUTO_ALLOW_MS,
} from '../../src/services/agent/agentApproval'

afterEach(() => {
  const pending = agentApprovalState.pending
  if (pending) resolveAgentApproval(pending.id, false)
  vi.useRealTimers()
})

describe('写入 Skill 的确认', () => {
  it('5 秒内没有拒绝就自动允许', async () => {
    vi.useFakeTimers()
    const result = requestAgentApproval({
      sessionId: 's',
      kind: 'write_skill',
      title: '写入 Skill',
      detail: 'site-learn / see.json',
    })
    expect(agentApprovalState.pending?.autoAllowAt).toBeTruthy()
    await vi.advanceTimersByTimeAsync(SKILL_AUTO_ALLOW_MS - 1)
    expect(agentApprovalState.pending).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(true)
    expect(agentApprovalState.pending).toBeNull()
  })

  it('5 秒内拒绝就不再自动允许', async () => {
    vi.useFakeTimers()
    const result = requestAgentApproval({
      sessionId: 's',
      kind: 'write_skill',
      title: '写入 Skill',
    })
    resolveAgentApproval(agentApprovalState.pending!.id, false)
    await expect(result).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(SKILL_AUTO_ALLOW_MS)
    expect(agentApprovalState.pending).toBeNull()
  })

  it('提交作业不会到点自动允许', async () => {
    vi.useFakeTimers()
    const result = requestAgentApproval({
      sessionId: 's',
      kind: 'submit',
      title: '提交作业',
    })
    await vi.advanceTimersByTimeAsync(SKILL_AUTO_ALLOW_MS)
    expect(agentApprovalState.pending?.kind).toBe('submit')
    resolveAgentApproval(agentApprovalState.pending!.id, false)
    await expect(result).resolves.toBe(false)
  })
})
