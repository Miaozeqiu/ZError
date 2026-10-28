// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

const state = vi.hoisted(() => ({} as Record<string, any>))
const actions = vi.hoisted(() => ({ policy: vi.fn(), save: vi.fn() }))
vi.mock('../../src/services/agent/agentPolicy', async () => {
  state.policy = (await import('vue')).reactive({ permissionMode: 'strict', writeSkills: 'ask', submit: 'ask' })
  return { agentPolicyState: state.policy, setAgentPolicy: actions.policy }
})
vi.mock('../../src/services/agent/agentProfiles', async () => {
  state.profiles = (await import('vue')).reactive({ defaultId: 'agent', profiles: [] })
  return {
    getActiveAgentProfile: () => state.profiles.profiles.find((p: any) => p.id === state.profiles.defaultId),
    saveAgentProfile: actions.save,
  }
})
import AgentBehaviorSettings from '../../src/views/settings/AgentBehaviorSettings.vue'
let app: App
let root: HTMLDivElement
const change = async (id: string, value: string) => {
  const input = root.querySelector(`#${id}`) as HTMLTextAreaElement | HTMLButtonElement
  if (input instanceof HTMLTextAreaElement) {
    input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    input.click(); await nextTick()
    const text = ({ allow: '允许', deny: '禁止', ask: '先确认', explore: '常规', strict: '严格' } as Record<string, string>)[value]
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.trim() === text)
    expect(option).toBeDefined(); option!.click()
  }
  await nextTick()
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state.policy, { permissionMode: 'strict', writeSkills: 'ask', submit: 'ask' })
  state.profiles.defaultId = 'agent'
  state.profiles.profiles = [{ id: 'agent', name: 'Agent', preset: 'agent', systemOverlay: '原规则' }]
  actions.policy.mockImplementation(patch => Object.assign(state.policy, patch))
  actions.save.mockImplementation(profile => Object.assign(state.profiles.profiles.find((p: any) => p.id === profile.id), profile))
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(AgentBehaviorSettings) }); app.mount(root)
})
afterEach(() => { app.unmount(); root.remove() })

describe('merged Agent behavior settings', () => {
  it('changes global permissions without changing a rule profile', async () => {
    expect(root.querySelector('#agent-permission-mode')!.textContent).toBe('严格')
    await change('agent-submit-permission', 'allow')
    await change('agent-skill-permission', 'deny')
    expect(actions.policy.mock.calls).toEqual([[{ submit: 'allow' }], [{ writeSkills: 'deny' }]])
    expect(actions.save).not.toHaveBeenCalled()
    expect(state.profiles.profiles[0].systemOverlay).toBe('原规则')
  })
  it('edits the active prompt directly without configuration controls or permission changes', async () => {
    expect(root.querySelector('#agent-rule-profile')).toBeNull()
    expect(root.querySelector('#agent-rule-name')).toBeNull()
    expect(root.textContent).not.toMatch(/复制配置|设为默认|删除配置/)
    expect(root.textContent).toContain('追加到内置系统提示词')
    await change('agent-rule-text', '新提示词')
    expect(state.profiles.profiles[0].systemOverlay).toBe('新提示词')
    expect(state.profiles.defaultId).toBe('agent')
    expect(actions.policy).not.toHaveBeenCalled()
  })
  it('preserves an existing active custom prompt and allows clearing only its additions', async () => {
    state.profiles.profiles.push({ id: 'custom', name: '原自定义配置', systemOverlay: '沿用的提示词' })
    state.profiles.defaultId = 'custom'
    await nextTick()
    expect(root.querySelector<HTMLTextAreaElement>('#agent-rule-text')!.value).toBe('沿用的提示词')
    await change('agent-rule-text', '')
    expect(state.profiles.profiles[1].systemOverlay).toBe('')
    expect(state.profiles.profiles[0].systemOverlay).toBe('原规则')
    expect(state.profiles.defaultId).toBe('custom')
    expect(actions.policy).not.toHaveBeenCalled()
  })
})
