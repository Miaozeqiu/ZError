// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

const state = vi.hoisted(() => ({} as Record<string, any>))
const actions = vi.hoisted(() => ({ remember: vi.fn(), forget: vi.fn(), deleteWebsite: vi.fn(), website: vi.fn(), native: vi.fn(), preview: vi.fn(), importRepository: vi.fn(), saveExperienceUrl: vi.fn() }))
vi.mock('../../src/services/agent/websiteRepository', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepository')>(), previewWebsiteRepository: actions.preview, importWebsiteRepository: actions.importRepository, setWebsiteExperienceUrl: actions.saveExperienceUrl,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: actions.native }))
vi.mock('../../src/services/agent/agentSkills', () => ({ agentSkillsState: { items: [] } }))
vi.mock('../../src/services/agent/siteAccounts', async () => {
  state.accounts = (await import('vue')).reactive({ rows: {} })
  return { siteAccountsState: state.accounts, rememberSiteAccount: actions.remember, forgetSiteAccount: actions.forget }
})
vi.mock('../../src/services/agent/websiteSettings', () => ({
  listWebsiteSettings: async () => [
    { id: 'menhu.haou.edu.cn', name: '河南开放大学·云上河开', host: 'menhu.haou.edu.cn', skillId: 'site-learn', siteHost: 'menhu.haou.edu.cn', files: ['sites/menhu.haou.edu.cn/SKILL.md'], domains: ['menhu.haou.edu.cn', 'authserver.open.ha.cn', 'old.example.com'], iconUrl: state.icon },
    { id: 'chaoxing', name: '学习通', host: 'chaoxing.com', domains: ['chaoxing.com'], skillId: 'chaoxing', files: ['SKILL.md', 'site-graph.json'], builtin: true,
      ...(state.repository ? { repositoryHost: 'chaoxing.com' } : {}) },
    ...[{ id: 'zhihuishu', name: '智慧树', host: 'zhihuishu.com' }, { id: 'zjooc', name: '在浙学', host: 'zjooc.cn' }].map(site => ({ ...site, domains: [site.host], skillId: 'site-learn', siteHost: site.host, files: [`sites/${site.host}/SKILL.md`, `sites/${site.host}/site-graph.json`], builtin: true })),
  ],
  addWebsiteSettings: actions.website, deleteWebsiteSettings: actions.deleteWebsite,
}))
vi.mock('../../src/views/settings/AgentBehaviorSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/views/settings/AgentSkillDetail.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({
    props: ['skillId', 'siteHost', 'initialPath', 'initialMode'], emits: ['back', 'saved'],
    setup: (props, { emit }) => () => h('button', { 'data-editor-host': props.siteHost, 'data-editor-path': props.initialPath, 'data-editor-mode': props.initialMode, onClick: () => emit('back') }, '返回'),
  }) }
})
import AgentSettings from '../../src/views/settings/AgentSettings.vue'
let app: App
let root: HTMLDivElement
beforeEach(async () => {
  vi.clearAllMocks()
  actions.native.mockReset()
  state.icon = undefined
  state.repository = false
  state.accounts.rows = { chaoxing: { account: 'cx-user', password: 'cx-secret', note: '' }, zjooc: { account: 'zj-user', password: 'zj-secret', note: '' } }
  actions.remember.mockImplementation((id, row) => { state.accounts.rows[id] = row })
  actions.forget.mockImplementation(id => { delete state.accounts.rows[id] })
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(AgentSettings) }); app.mount(root)
  await vi.waitFor(() => expect(root.querySelectorAll('[data-website]')).toHaveLength(4))
})
afterEach(() => { app.unmount(); root.remove(); delete (window as any).__TAURI_INTERNALS__ })
const site = (id: string) => root.querySelector(`[data-website="${id}"]`)!

const openMenu = async (row: Element) => {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
  await nextTick()
}
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('.website-context-menu [role="menuitem"]')].find(item => (item.getAttribute('aria-label') || item.textContent?.trim()) === label)!
const choose = async (row: Element, label: string) => {
  await openMenu(row)
  menuItem(label).click()
  if (label === '网站设置') await vi.waitFor(() => expect(document.querySelector('[aria-labelledby="website-dialog-title"]')).not.toBeNull())
}

describe('one settings card per website', () => {
  it('shows a single experience entry with the same label for repository websites', async () => {
    state.repository = true
    const { websiteRepositoryStates } = await import('../../src/services/agent/websiteRepository')
    websiteRepositoryStates['chaoxing.com'].source = 'repository'
    const { websiteIdentityState } = await import('../../src/services/agent/websiteIdentity')
    websiteIdentityState.profiles = [...websiteIdentityState.profiles]
    await openMenu(site('chaoxing'))
    await vi.waitFor(() => expect(menuItem('操作经验')?.title).toBe('操作经验 · 已同步'))
    const items = [...document.querySelectorAll('.website-context-menu [role="menuitem"]')]
    expect(items.map(item => item.textContent?.trim())).toEqual(['账号密码', '操作经验', '网站设置', '删除'])
    expect(items.every(item => item.querySelector('.menu-icon svg'))).toBe(true)
    expect(menuItem('删除网站')).toBe(items[3])
    menuItem('操作经验').click()
    await vi.waitFor(() => expect(root.querySelector('[data-editor-path]')?.getAttribute('data-editor-path')).toBe('SKILL.md'))
  })

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
  it('edits and removes website domains in one list', async () => {
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
    await choose(portal, '网站设置')
    await nextTick()
    const dialog = () => document.querySelector('[aria-labelledby="website-dialog-title"]')
    expect(dialog()!.querySelector('.dialog-header button')).toBeNull()
    const footer = dialog()!.querySelector('footer')!
    expect(footer.previousElementSibling?.classList.contains('dialog-body')).toBe(true)
    expect([...footer.querySelectorAll('button')].map(button => button.textContent?.trim())).toEqual(['取消', '保存'])
    footer.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
    await nextTick()
    expect(dialog()).toBeNull()
    expect(actions.website).not.toHaveBeenCalled()

    await choose(portal, '网站设置')
    await nextTick()
    expect(dialog()!.textContent).not.toContain('关联登录域名')
    expect([...dialog()!.querySelectorAll('.website-domain')].map(chip => chip.textContent!.trim())).toEqual(['menhu.haou.edu.cn', 'authserver.open.ha.cn', 'old.example.com'])
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="移除 old.example.com"]')!.click()
    const input = dialog()!.querySelector<HTMLInputElement>('#website-domains')!
    input.value = 'courses.example.com，WWW.COURSES.EXAMPLE.COM'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(input.value).toBe('')
    input.value = 'media.example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const add = input.parentElement!.querySelector<HTMLButtonElement>('button')!
    expect(add.textContent).toBe('添加')
    expect(input.closest('.website-domains')).toBeNull()
    add.click()
    await nextTick()
    expect(input.value).toBe('')
    expect(add.disabled).toBe(true)
    expect(dialog()!.querySelector('.website-domains')!.textContent).toContain('media.example.com')
    expect(actions.website).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('.account-dialog .btn-confirm')!.click()
    await vi.waitFor(() => expect(actions.website).toHaveBeenCalledWith('menhu.haou.edu.cn', '河南开放大学·云上河开', ['menhu.haou.edu.cn', 'authserver.open.ha.cn', 'courses.example.com', 'media.example.com'], true))
  })

  it('removes the primary domain with the tag close icon and saves an empty domain list', async () => {
    await choose(site('zhihuishu'), '网站设置')
    await nextTick()
    const dialog = document.querySelector('[aria-labelledby="website-dialog-title"]')!
    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="移除 zhihuishu.com"]')!
    expect(remove.querySelector('svg')).not.toBeNull()
    remove.click()
    await nextTick()
    expect(dialog.querySelector('.website-domain')).toBeNull()
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await vi.waitFor(() => expect(actions.website).toHaveBeenCalledWith('zhihuishu.com', '智慧树', [], true))
  })

  it('protects only Chaoxing and allows changing its HTTP endpoint', async () => {
    for (const id of ['zjooc', 'zhihuishu']) {
      await openMenu(site(id))
      expect(menuItem('删除网站').getAttribute('aria-disabled')).not.toBe('true')
    }
    await openMenu(site('chaoxing'))
    const item = menuItem('删除网站')
    expect(item.getAttribute('aria-disabled')).toBe('true')
    item.click()
    await nextTick()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(actions.deleteWebsite).not.toHaveBeenCalled()
    await choose(site('chaoxing'), '网站设置')
    await nextTick()
    const dialog = document.querySelector('[aria-labelledby="website-dialog-title"]')!
    expect(dialog.querySelector<HTMLInputElement>('#website-name')!.disabled).toBe(true)
    expect(dialog.querySelector('.website-domain button, #website-domains')).toBeNull()
    expect(dialog.querySelector<HTMLInputElement>('#website-experience-url')!.disabled).toBe(false)
  })

  it('locks local website identity when using HTTP and unlocks it when the address is cleared', async () => {
    await choose(site('zhihuishu'), '网站设置')
    await nextTick()
    const dialog = document.querySelector('[aria-labelledby="website-dialog-title"]')!
    const url = dialog.querySelector<HTMLInputElement>('#website-experience-url')!
    const name = dialog.querySelector<HTMLInputElement>('#website-name')!
    name.value = '未保存的名称'
    name.dispatchEvent(new Event('input'))
    url.value = 'http://localhost:8123/experience.json'
    url.dispatchEvent(new Event('input'))
    await nextTick()
    expect(name.disabled).toBe(true)
    expect(name.value).toBe('智慧树')
    expect(dialog.querySelector('.website-domain button, #website-domains')).toBeNull()
    url.value = ''
    url.dispatchEvent(new Event('input'))
    await nextTick()
    expect(name.disabled).toBe(false)
    expect(dialog.querySelector('#website-domains')).not.toBeNull()
    expect(dialog.querySelector('[aria-label="移除 zhihuishu.com"]')).not.toBeNull()
  })

  it('saves a custom HTTP website experience URL', async () => {
    const url = 'http://127.0.0.1:8123/experience.json'
    await choose(site('chaoxing'), '网站设置')
    await nextTick()
    const dialog = document.querySelector('[aria-labelledby="website-dialog-title"]')!
    const input = dialog.querySelector<HTMLInputElement>('#website-experience-url')!
    input.value = url
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull()
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await vi.waitFor(() => expect(actions.saveExperienceUrl).toHaveBeenCalledWith('chaoxing.com', url))
    expect(actions.website).not.toHaveBeenCalled()
  })

  it('edits credentials for the clicked website, with no cross-platform selector or password in the card', async () => {
    expect(site('chaoxing').textContent).not.toContain('cx-user')
    expect(site('zjooc').textContent).not.toContain('zj-user')
    expect(root.textContent).not.toContain('cx-secret')
    expect(root.textContent).not.toContain('zj-secret')
    await choose(site('zjooc'), '账号密码')
    await vi.waitFor(() => expect(document.querySelector('.account-site-label')?.textContent).toContain('在浙学 · zjooc.cn'))
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
    expect(site('zjooc').textContent).not.toContain('new-zj-user')
  })

  it('displays saved usernames without verification, with verification only when revealing a saved password', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const accountReference = '{{secret:site/zjooc/account}}'
    const passwordReference = '{{secret:site/zjooc/password}}'
    actions.native.mockImplementation(async command => {
      if (command === 'secure_site_account_names') return { zjooc: 'visible-user' }
      if (command === 'secure_site_password_length') return 17
      return { value: 'verified-password' }
    })
    state.accounts.rows = { zjooc: { account: accountReference, password: passwordReference, updatedAt: 1, note: '' } }
    await vi.waitFor(() => expect(actions.native).toHaveBeenCalledWith('secure_site_account_names'))
    expect(site('zjooc').textContent).not.toContain('visible-user')
    expect(actions.native.mock.calls.every(([name]) => name === 'secure_site_account_names')).toBe(true)
    expect(site('zjooc').textContent).not.toContain(passwordReference)
    expect(site('zjooc').textContent).not.toContain('verified-password')
    await choose(site('zjooc'), '账号密码')
    await nextTick()
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#agent-acc-account')?.value).toBe('visible-user'))
    const account = document.querySelector<HTMLInputElement>('#agent-acc-account')!
    expect(account.type).toBe('text')
    expect(document.querySelector('[aria-label="查看账号"]')).toBeNull()
    const password = document.querySelector<HTMLInputElement>('#agent-acc-password')!
    await vi.waitFor(() => expect(password.placeholder).toBe('•'.repeat(17)))
    expect(password.value).toBe('')
    expect(actions.native).toHaveBeenCalledWith('secure_site_password_length', { reference: passwordReference })
    expect(actions.native.mock.calls.every(([name]) => ['secure_site_account_names', 'secure_site_password_length'].includes(name))).toBe(true)
    document.querySelector<HTMLButtonElement>('[aria-label="查看密码"]')!.click()
    await vi.waitFor(() => expect(actions.native).toHaveBeenCalledWith('secure_secret_action', { reference: passwordReference, action: 'reveal' }))
    expect(state.accounts.rows.zjooc.account).toBe(accountReference)
    expect(state.accounts.rows.zjooc.password).toBe(passwordReference)
  })

  it('offers actions for the selected website and requires confirmation to delete it', async () => {
    const portal = site('menhu.haou.edu.cn')
    expect(portal.querySelector('button')).toBeNull()
    await openMenu(portal)
    expect(menuItem('账号密码')).toBeDefined()
    expect(menuItem('操作经验')).toBeDefined()
    menuItem('删除网站').click()
    await nextTick()
    const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dialog().textContent).toContain('menhu.haou.edu.cn')
    dialog().querySelector<HTMLButtonElement>('.account-dialog-cancel')!.click()
    expect(actions.deleteWebsite).not.toHaveBeenCalled()
    await choose(site('zhihuishu'), '删除网站')
    await nextTick()
    expect(dialog().textContent).toContain('zhihuishu.com')
    dialog().querySelector<HTMLButtonElement>('.btn-confirm')!.click()
    await vi.waitFor(() => expect(dialog()).toBeNull())
    expect(actions.deleteWebsite).toHaveBeenCalledExactlyOnceWith('zhihuishu.com')
  })

  it('clears only the selected website credentials from the account editor', async () => {
    const saved = site('zjooc')
    expect(saved.querySelector('[aria-label="清除账号密码"]')).toBeNull()
    await choose(saved, '账号密码')
    await nextTick()
    document.querySelector<HTMLButtonElement>('.account-editor-dialog .account-delete')!.click()
    await nextTick()
    expect(actions.forget).toHaveBeenCalledExactlyOnceWith('zjooc')
    expect(actions.remember).not.toHaveBeenCalled()
    expect(document.querySelector('.account-editor-dialog')).toBeNull()
    expect(state.accounts.rows.chaoxing).toBeDefined()
    await choose(saved, '账号密码')
    await nextTick()
    expect(document.querySelector('.account-editor-dialog .account-delete')).toBeNull()
  })

  it('routes the experience menu entry to the clicked website even when they share a Skill', async () => {
    await choose(site('zhihuishu'), '操作经验')
    await vi.dynamicImportSettled()
    await nextTick()
    expect(root.querySelector('[data-editor-host]')?.getAttribute('data-editor-host')).toBe('zhihuishu.com')
    expect(root.querySelector('[data-editor-path]')?.getAttribute('data-editor-path')).toBe('sites/zhihuishu.com/SKILL.md')
    root.querySelector<HTMLButtonElement>('[data-editor-host]')!.click()
    await nextTick()
    await choose(site('zjooc'), '操作经验')
    await vi.dynamicImportSettled()
    await nextTick()
    expect(root.querySelector('[data-editor-path]')?.getAttribute('data-editor-path')).toBe('sites/zjooc.cn/SKILL.md')
  })
  it('previews a repository icon and domain before an explicit import, preserving saved accounts', async () => {
    const candidate = { website: { version: 1, id: 'portal', name: '示例门户', host: 'portal.example.com', icon: 'assets/icon.png' },
      source: { owner: 'owner', name: 'website', branch: 'main', root: 'skills/portal', url: 'https://github.com/owner/website' },
      icon: { path: 'assets/icon.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, revision: 'a'.repeat(40) }
    actions.preview.mockResolvedValue([candidate]); actions.importRepository.mockResolvedValue(candidate.website.host)
    root.querySelector<HTMLButtonElement>('.import-repository-button')!.click()
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('#repository-import-url')!
    input.value = candidate.source.url; input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const form = document.querySelector<HTMLFormElement>('[aria-labelledby="repository-import-title"]')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(form.textContent).toContain(candidate.website.host))
    expect(form.querySelector('img')?.getAttribute('src')).toBe(candidate.icon.dataUrl)
    expect(actions.importRepository).not.toHaveBeenCalled()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(actions.importRepository).toHaveBeenCalledWith(candidate))
    expect(state.accounts.rows.zjooc.password).toBe('zj-secret')
    expect(state.accounts.rows.chaoxing.password).toBe('cx-secret')
  })
  it('keeps repository read failures in the import dialog without changing website settings', async () => {
    actions.preview.mockRejectedValue(new Error('网站图标缺失'))
    root.querySelector<HTMLButtonElement>('.import-repository-button')!.click(); await nextTick()
    const input = document.querySelector<HTMLInputElement>('#repository-import-url')!
    input.value = 'owner/website'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    document.querySelector<HTMLFormElement>('[aria-labelledby="repository-import-title"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(document.querySelector('[aria-labelledby="repository-import-title"]')?.textContent).toContain('网站图标缺失'))
    expect(actions.importRepository).not.toHaveBeenCalled()
    expect(actions.website).not.toHaveBeenCalled()
  })
})
