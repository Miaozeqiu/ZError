// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

const state = vi.hoisted(() => ({} as Record<string, any>))
const actions = vi.hoisted(() => ({ remember: vi.fn(), forget: vi.fn(), website: vi.fn(), native: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: actions.native }))
vi.mock('../../src/services/agent/agentSkills', () => ({ agentSkillsState: { items: [] } }))
vi.mock('../../src/services/agent/siteAccounts', async () => {
  state.accounts = (await import('vue')).reactive({ rows: {} })
  return { siteAccountsState: state.accounts, rememberSiteAccount: actions.remember, forgetSiteAccount: actions.forget }
})
vi.mock('../../src/services/agent/websiteSettings', () => ({
  listWebsiteSettings: async () => [
    { id: 'menhu.haou.edu.cn', name: '河南开放大学·云上河开', host: 'menhu.haou.edu.cn', skillId: 'site-learn', siteHost: 'menhu.haou.edu.cn', files: ['sites/menhu.haou.edu.cn/SKILL.md'], loginHosts: ['authserver.open.ha.cn'], iconUrl: state.icon },
    { id: 'chaoxing', name: '学习通', host: 'chaoxing.com', skillId: 'chaoxing', files: ['SKILL.md', 'site-graph.json'], builtin: true },
    ...[{ id: 'zhihuishu', name: '智慧树', host: 'zhihuishu.com' }, { id: 'zjooc', name: '在浙学', host: 'zjooc.cn' }].map(site => ({ ...site, skillId: 'site-learn', siteHost: site.host, files: [`sites/${site.host}/SKILL.md`, `sites/${site.host}/site-graph.json`], builtin: true })),
  ],
  addWebsiteSettings: actions.website,
}))
vi.mock('../../src/views/settings/AgentBehaviorSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/views/settings/AgentSkillDetail.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({
    props: ['skillId', 'siteHost', 'initialPath'], emits: ['back', 'saved'],
    setup: (props, { emit }) => () => h('button', { 'data-editor-host': props.siteHost, 'data-editor-path': props.initialPath, onClick: () => emit('back') }, '返回'),
  }) }
})
import AgentSettings from '../../src/views/settings/AgentSettings.vue'
let app: App
let root: HTMLDivElement
beforeEach(async () => {
  vi.clearAllMocks()
  actions.native.mockReset()
  state.icon = undefined
  state.accounts.rows = { chaoxing: { account: 'cx-user', password: 'cx-secret', note: '' }, zjooc: { account: 'zj-user', password: 'zj-secret', note: '' } }
  actions.remember.mockImplementation((id, row) => { state.accounts.rows[id] = row })
  actions.forget.mockImplementation(id => { delete state.accounts.rows[id] })
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(AgentSettings) }); app.mount(root)
  await vi.waitFor(() => expect(root.querySelectorAll('[data-website]')).toHaveLength(4))
})
afterEach(() => { app.unmount(); root.remove(); delete (window as any).__TAURI_INTERNALS__ })
const site = (id: string) => root.querySelector(`[data-website="${id}"]`)!

describe('one settings card per website', () => {
  it('retries a newly saved icon even if the old favicon failed earlier', async () => {
    const portal = site('menhu.haou.edu.cn')
    portal.querySelector('.website-icon img')!.dispatchEvent(new Event('error'))
    await nextTick()
    expect(portal.querySelector('.website-icon img')).toBeNull()
    state.icon = 'data:image/png;base64,aGVsbG8='
    const { websiteIdentityState } = await import('../../src/services/agent/websiteIdentity')
    websiteIdentityState.profiles = [...websiteIdentityState.profiles]
    await vi.waitFor(() => expect(portal.querySelector('.website-icon img')?.getAttribute('src')).toBe(state.icon))
  })
  it('keeps login domains in website settings without showing an extra card description', async () => {
    const portal = site('menhu.haou.edu.cn')
    const favicon = portal.querySelector<HTMLImageElement>('.website-icon img')!
    expect(favicon.getAttribute('src')).toBe('https://menhu.haou.edu.cn/favicon.ico')
    favicon.dispatchEvent(new Event('error'))
    await nextTick()
    expect(portal.querySelector('.website-icon img')).toBeNull()
    expect(portal.querySelector('.website-icon svg')).not.toBeNull()
    const loadedIcon = site('zjooc').querySelector<HTMLImageElement>('.website-icon img')!
    loadedIcon.dispatchEvent(new Event('load'))
    await nextTick()
    expect(loadedIcon.classList.contains('is-loaded')).toBe(true)
    expect(site('zjooc').querySelector('.website-icon svg')).toBeNull()
    expect(portal.textContent).not.toContain('登录域名：')
    expect(root.querySelector('[data-website="authserver.open.ha.cn"]')).toBeNull()
    portal.querySelector<HTMLButtonElement>('.website-card-head button')!.click()
    await nextTick()
    expect(document.querySelector<HTMLInputElement>('#website-host')!.disabled).toBe(true)
    const aliases = document.querySelector<HTMLInputElement>('#website-login-hosts')!
    expect(aliases.value).toBe('authserver.open.ha.cn')
    aliases.value = 'authserver.open.ha.cn, login.example.com'
    aliases.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    document.querySelector<HTMLButtonElement>('.account-dialog .btn-confirm')!.click()
    await vi.waitFor(() => expect(actions.website).toHaveBeenCalledWith('menhu.haou.edu.cn', '河南开放大学·云上河开', ['authserver.open.ha.cn', 'login.example.com'], true))
  })

  it('edits credentials for the clicked website, with no cross-platform selector or password in the card', async () => {
    expect(site('chaoxing').textContent).toContain('cx-user')
    expect(site('zjooc').textContent).toContain('zj-user')
    expect(root.textContent).not.toContain('cx-secret')
    expect(root.textContent).not.toContain('zj-secret')
    site('zjooc').querySelector<HTMLButtonElement>('.website-info-row button')!.click()
    await nextTick()
    expect(document.querySelector('.account-site-label')!.textContent).toContain('在浙学 · zjooc.cn')
    expect(document.querySelector('#agent-acc-platform')).toBeNull()
    const account = document.querySelector<HTMLInputElement>('#agent-acc-account')!
    const password = document.querySelector<HTMLInputElement>('#agent-acc-password')!
    account.value = 'new-zj-user'; account.dispatchEvent(new Event('input', { bubbles: true }))
    password.value = 'new-zj-secret'; password.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    document.querySelector<HTMLButtonElement>('.account-dialog .btn-confirm')!.click()
    await nextTick()
    expect(actions.remember).toHaveBeenCalledWith('zjooc', { account: 'new-zj-user', password: 'new-zj-secret', note: '' })
    expect(state.accounts.rows.chaoxing.password).toBe('cx-secret')
    expect(site('zjooc').textContent).toContain('new-zj-user')
  })

  it('displays saved usernames without verification, with verification only when revealing a saved password', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const accountReference = '{{secret:site/zjooc/account}}'
    const passwordReference = '{{secret:site/zjooc/password}}'
    actions.native.mockImplementation(async command => command === 'secure_site_account_names'
      ? { zjooc: 'visible-user' } : { value: 'verified-password' })
    state.accounts.rows = { zjooc: { account: accountReference, password: passwordReference, updatedAt: 1, note: '' } }
    await vi.waitFor(() => expect(site('zjooc').textContent).toContain('visible-user'))
    expect(actions.native.mock.calls.every(([name]) => name === 'secure_site_account_names')).toBe(true)
    expect(site('zjooc').textContent).not.toContain(passwordReference)
    expect(site('zjooc').textContent).not.toContain('verified-password')
    site('zjooc').querySelector<HTMLButtonElement>('[aria-label="编辑账号密码"]')!.click()
    await nextTick()
    const account = document.querySelector<HTMLInputElement>('#agent-acc-account')!
    expect(account.value).toBe('visible-user')
    expect(account.type).toBe('text')
    expect(document.querySelector('[aria-label="查看账号"]')).toBeNull()
    expect(actions.native.mock.calls.every(([name]) => name === 'secure_site_account_names')).toBe(true)
    document.querySelector<HTMLButtonElement>('[aria-label="查看密码"]')!.click()
    await vi.waitFor(() => expect(actions.native).toHaveBeenCalledWith('secure_secret_action', { reference: passwordReference, action: 'reveal' }))
    expect(state.accounts.rows.zjooc.account).toBe(accountReference)
    expect(state.accounts.rows.zjooc.password).toBe(passwordReference)
  })

  it('uses labelled library icons for website settings, credential configuration, editing and clearing', () => {
    const saved = site('zjooc')
    for (const label of ['网站设置', '编辑账号密码', '清除账号密码', '编辑操作经验', '编辑导航图谱']) {
      const button = saved.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      expect(button).not.toBeNull()
      expect(button.title).toBe(label)
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button.textContent).toBe('')
    }
    expect(site('menhu.haou.edu.cn').querySelector('[aria-label="配置账号密码"] svg')).not.toBeNull()
  })

  it('routes experience and graph buttons to the clicked website even when they share a Skill', async () => {
    site('zhihuishu').querySelectorAll<HTMLButtonElement>('.website-info-row')[1].querySelector('button')!.click()
    await nextTick()
    expect(root.querySelector('[data-editor-host]')?.getAttribute('data-editor-host')).toBe('zhihuishu.com')
    expect(root.querySelector('[data-editor-path]')?.getAttribute('data-editor-path')).toBe('sites/zhihuishu.com/SKILL.md')
    root.querySelector<HTMLButtonElement>('[data-editor-host]')!.click()
    await nextTick()
    site('zjooc').querySelectorAll<HTMLButtonElement>('.website-info-row')[2].querySelector('button')!.click()
    await nextTick()
    expect(root.querySelector('[data-editor-path]')?.getAttribute('data-editor-path')).toBe('sites/zjooc.cn/site-graph.json')
  })
})
