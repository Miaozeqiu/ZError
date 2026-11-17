import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSkillFrontmatter } from '../../src/services/agent/skillFormat'
import { normalizeWebsiteHost, websiteAccountId } from '../../src/services/agent/websiteIdentity'

const state = vi.hoisted(() => ({ files: new Map<string, string>(), rows: {} as Record<string, unknown>, save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 1 }, readTextFile: vi.fn(async () => { throw new Error('missing') }),
  writeTextFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}), readDir: vi.fn(async () => []), remove: vi.fn(async () => {}),
}))
vi.mock('../../src/services/agent/siteAccounts', () => ({ siteAccountsState: { get rows() { return state.rows } } }))
vi.mock('../../src/services/agent/agentSkills', async () => ({
  agentSkillsState: { items: [{ id: 'chaoxing', enabled: true }, { id: 'site-learn', enabled: true }] },
  listSkillFiles: async (id: string) => [...state.files.keys()].filter(path => path.startsWith(`${id}/`)).map(path => path.slice(id.length + 1)),
  getSkillFileContent: async (id: string, path: string) => state.files.has(`${id}/${path}`) ? { content: state.files.get(`${id}/${path}`) } : null,
  parseSkillFrontmatter: (await import('../../src/services/agent/skillFormat')).parseSkillFrontmatter,
  saveSkillFileContent: async (id: string, path: string, content: string) => { state.save(id, path, content); state.files.set(`${id}/${path}`, content) },
}))
import { addWebsiteSettings, listWebsiteSettings } from '../../src/services/agent/websiteSettings'

beforeEach(() => {
  state.files.clear(); state.rows = {}; state.save.mockClear()
  state.files.set('chaoxing/SKILL.md', '# 学习通')
  state.files.set('chaoxing/site-graph.json', '{}')
  for (const host of ['zjooc.cn', 'zhihuishu.com']) {
    state.files.set(`site-learn/sites/${host}/SKILL.md`, `# ${host}`)
    state.files.set(`site-learn/sites/${host}/site-graph.json`, '{}')
  }
  state.files.set('site-learn/SKILL.md', 'internal instructions')
})

describe('settings grouped by website', () => {
  it('shows portal and authentication credentials as one website with a login-domain label', async () => {
    state.files.set('site-learn/sites/menhu.haou.edu.cn/SKILL.md', '# 登录流程')
    state.rows = { 'menhu.haou.edu.cn': { account: 'portal-user' }, 'authserver.open.ha.cn': { account: 'same-user' } }
    const rows = await listWebsiteSettings()
    expect(rows.filter(site => site.id === 'menhu.haou.edu.cn')).toHaveLength(1)
    expect(rows.some(site => site.id === 'authserver.open.ha.cn')).toBe(false)
    expect(rows.find(site => site.id === 'menhu.haou.edu.cn')).toMatchObject({ name: '河南开放大学·云上河开', loginHosts: ['authserver.open.ha.cn'] })
  })
  it('joins existing website IDs and keeps each website file list isolated', async () => {
    state.rows = { chaoxing: { account: 'cx' }, zjooc: { account: 'zj' } }
    const sites = await listWebsiteSettings()
    expect(sites.map(site => site.id)).toEqual(['chaoxing', 'zhihuishu', 'zjooc'])
    expect(sites.find(site => site.id === 'chaoxing')?.files).toEqual(['SKILL.md', 'site-graph.json'])
    for (const site of sites.filter(site => site.siteHost)) {
      expect(site.files.every(path => path.startsWith(`sites/${site.host}/`))).toBe(true)
      expect(site.files).not.toContain('SKILL.md')
    }
  })

  it('discovers learned sites and accounts without creating duplicate known sites', async () => {
    state.files.set('site-learn/sites/example.com/SKILL.md', '---\nname: 自定义网站\ndescription: 操作\n---\n经验')
    state.rows = { 'account-only.example.com': { account: 'abc' } }
    const sites = await listWebsiteSettings()
    expect(sites.find(site => site.host === 'example.com')?.name).toBe('自定义网站')
    expect(sites.find(site => site.host === 'account-only.example.com')?.files).toEqual([])
    expect(sites.filter(site => site.id === 'zjooc')).toHaveLength(1)
    await addWebsiteSettings('account-only.example.com', '账号站点')
    const updated = (await listWebsiteSettings()).find(site => site.id === 'account-only.example.com')!
    expect(updated.files).toContain('sites/account-only.example.com/SKILL.md')
    expect(updated.name).toBe('账号站点')
  })

  it('adds a site by normalized domain, preserves its name and never overwrites an existing site', async () => {
    await addWebsiteSettings('https://www.example.com/course', '示例网站')
    const sites = await listWebsiteSettings()
    expect(sites.find(site => site.id === 'example.com')).toMatchObject({ host: 'example.com', name: '示例网站', siteHost: 'example.com' })
    const original = state.files.get('site-learn/sites/example.com/SKILL.md')!
    expect(parseSkillFrontmatter(original).displayName).toBe('示例网站')
    state.save.mockClear()
    await addWebsiteSettings('example.com', '不同名称')
    expect(state.save).not.toHaveBeenCalled()
    expect(state.files.get('site-learn/sites/example.com/SKILL.md')).toBe(original)
  })

  it('normalizes known subdomains but does not confuse lookalike domains or unsafe input', async () => {
    expect(websiteAccountId('passport2.chaoxing.com')).toBe('chaoxing')
    expect(websiteAccountId('fakechaoxing.com')).toBe('fakechaoxing.com')
    expect(normalizeWebsiteHost('https://WWW.Example.com/path')).toBe('example.com')
    for (const input of ['../another-site', 'file:///tmp/example', 'https://user:pass@example.com', 'not a host']) {
      await expect(addWebsiteSettings(input, '')).rejects.toThrow('有效的网站')
    }
  })
})
