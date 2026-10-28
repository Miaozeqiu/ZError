// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ files: new Map<string, string>(), writes: vi.fn(), fail: '' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(async (path: string) => {
    if (!io.files.has(path)) throw new Error('ENOENT: No such file or directory')
    return io.files.get(path)!
  }),
  writeTextFile: async (path: string, content: string) => {
    if (io.fail && path.includes(io.fail)) throw new Error('write failed')
    io.writes(path, content); io.files.set(path, content)
  },
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async (path: string) => { io.files.delete(path) }),
  readDir: async (dir: string) => {
    const entries = new Map<string, any>()
    for (const path of io.files.keys()) {
      if (!path.startsWith(dir + '/')) continue
      const parts = path.slice(dir.length + 1).split('/')
      entries.set(parts[0], { name: parts[0], isDirectory: parts.length > 1, isFile: parts.length === 1 })
    }
    return [...entries.values()]
  },
}))
const credentials = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({
  readSecureDocument: credentials.read, writeSecureDocument: credentials.write,
  isSecretReference: (value: unknown) => typeof value === 'string' && value.startsWith('{{secret:'),
  redactNative: async (value: unknown) => value,
}))
const root = '.local/share/zerror'
const primary = 'menhu.haou.edu.cn'
const auth = 'authserver.open.ha.cn'
const load = () => import('../../src/services/agent/websiteIdentity')
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); io.files.clear(); io.fail = ''; credentials.read.mockResolvedValue(null); credentials.write.mockImplementation(async (_name, value) => value) })

describe('website identity across login domains', () => {
  it('recognizes the verified portal/login relationship without trusting arbitrary callback URLs', async () => {
    const mod = await load()
    expect(mod.websitePrimaryHost(`https://${auth}/authserver/login?service=https://evil.example.com`)).toBe(primary)
    expect(mod.websiteAccountId(auth)).toBe(primary)
    expect(mod.websitePrimaryHost(`https://login.example.com/?service=https://${primary}`)).toBe('login.example.com')
    expect(mod.websitePrimaryHost('authserver.open.ha.cn.evil.example.com')).toBe('authserver.open.ha.cn.evil.example.com')
    const pattern = new RegExp(mod.websiteHostPattern(primary))
    expect(pattern.test(`https://${auth}/authserver/login`)).toBe(true)
    expect(pattern.test(`https://evil.example.com/?next=https://${auth}/`)).toBe(false)
  })

  it('persists explicit login aliases, prevents conflicts and retains simultaneous settings changes', async () => {
    const mod = await load()
    await Promise.all([
      mod.saveWebsiteIdentity('portal.example.com', '自定义学校', ['login.example.com']),
      mod.saveWebsiteIdentity('other.example.com', '另一个网站', ['account.example.com']),
    ])
    expect(mod.websiteAccountId('login.example.com')).toBe('portal.example.com')
    expect(mod.websiteAccountId('account.example.com')).toBe('other.example.com')
    await expect(mod.saveWebsiteIdentity('third.example.com', '冲突', ['login.example.com'])).rejects.toThrow('其他网站')
    await expect(mod.saveWebsiteIdentity('third.example.com', '冲突', ['chaoxing.com'])).rejects.toThrow('其他网站')
    await mod.saveWebsiteIdentity('portal.example.com', '自定义学校', [])
    expect(mod.websiteAccountId('login.example.com')).toBe('login.example.com')
    vi.resetModules()
    const restored = await load()
    await restored.loadWebsiteIdentities()
    expect(restored.websiteLabel('other.example.com')).toBe('另一个网站')
    expect(restored.websiteAccountId('account.example.com')).toBe('other.example.com')
  })

  it('shares one encrypted credential record across the portal and verified login host', async () => {
    const references = { account: '{{secret:site/menhu.haou.edu.cn/account}}', password: '{{secret:site/menhu.haou.edu.cn/password}}', note: '', updatedAt: 1 }
    credentials.read.mockResolvedValue({ [primary]: references })
    const accounts = await import('../../src/services/agent/siteAccounts')
    await accounts.siteAccountsReady
    expect(accounts.siteAccountOf(primary)).toEqual(references)
    expect(accounts.siteAccountOf(auth)).toEqual(references)
    expect(accounts.siteAccountsPrompt(`https://${auth}/login`)).toContain(references.password)
    accounts.forgetSiteAccount(auth)
    expect(accounts.siteAccountOf(primary)).toBeNull()
    await vi.waitFor(() => expect(credentials.write).toHaveBeenCalled())
  })

  it('routes foreign experience out of chaoxing and saves login-domain experience under the primary site', async () => {
    const mod = await import('../../src/services/agent/agentSkills')
    await vi.waitFor(() => expect(mod.agentSkillsState.ready).toBe(true))
    await mod.saveSkillFileContent('chaoxing', `sites/${auth}/SKILL.md`, '# 已验证的登录流程')
    expect(io.files.get(`${root}/skill-overrides/site-learn/sites/${primary}/SKILL.md`)).toBe('# 已验证的登录流程\n')
    expect(io.files.has(`${root}/skill-overrides/chaoxing/sites/${auth}/SKILL.md`)).toBe(false)
    const read = await mod.readAgentSkillFileContent('chaoxing', `sites/${auth}/SKILL.md`)
    expect(read).toMatchObject({ id: 'site-learn', path: `sites/${primary}/SKILL.md` })
  })

  it('keeps portal and login graph nodes in the same graph and persists the primary target', async () => {
    const core = await import('../../src/services/browser/siteGraphCore')
    const first = core.applySiteGraphPatch({ action: 'upsert_site', siteId: 'portal', host: primary, name: '河南开放大学' })
    expect(first.site?.id).toBe(primary)
    core.applySiteGraphPatch({ action: 'upsert_node', siteId: primary, id: 'home', title: '门户首页', path: '/', patterns: [primary] })
    const login = core.applySiteGraphPatch({ action: 'upsert_site', siteId: 'authserver', host: auth })
    expect(login.site?.id).toBe(primary)
    expect(login.site?.nodes.some(node => node.id === 'home')).toBe(true)
    expect(core.liveSiteGraphs.value.filter(site => site.id === primary)).toHaveLength(1)
    const save = await import('../../src/services/browser/siteGraphSave')
    expect(save.siteGraphSkillTarget({ id: 'authserver', host: auth })).toEqual({ skillId: 'site-learn', path: `sites/${primary}/site-graph.json` })
    expect(() => save.siteGraphSkillTarget({ id: 'chaoxing', host: primary })).toThrow('不能保存到学习通')
  })

  it('migrates duplicate experience with a backup and is idempotent after restart', async () => {
    const source = `${root}/skill-overrides/chaoxing/sites/${primary}/SKILL.md`
    const destination = `${root}/skill-overrides/site-learn/sites/${primary}/SKILL.md`
    io.files.set(source, '# Verified portal steps'); io.files.set(destination, '# Verified portal steps')
    const mod = await import('../../src/services/agent/websiteDataMigration')
    expect(await mod.migrateWebsiteSkillOverrides()).toMatchObject({ moved: 1, conflicts: [] })
    expect(io.files.has(source)).toBe(false)
    expect(io.files.get(`${root}/backups/website-unify-v1/skill-overrides/chaoxing/sites/${primary}/SKILL.md`)).toBe('# Verified portal steps')
    vi.resetModules()
    expect(await (await import('../../src/services/agent/websiteDataMigration')).migrateWebsiteSkillOverrides()).toMatchObject({ moved: 0 })
  })

  it('reruns experience migration when a user configures another website login domain', async () => {
    const source = `${root}/skill-overrides/site-learn/sites/login.example.com/SKILL.md`
    io.files.set(source, '# Verified login steps')
    const migration = await import('../../src/services/agent/websiteDataMigration')
    expect((await migration.migrateWebsiteSkillOverrides()).moved).toBe(0)
    await (await load()).saveWebsiteIdentity('portal.example.com', 'Example portal', ['login.example.com'])
    expect((await migration.migrateWebsiteSkillOverrides()).moved).toBe(1)
    expect(io.files.get(`${root}/skill-overrides/site-learn/sites/portal.example.com/SKILL.md`)).toBe('# Verified login steps')
    expect(io.files.has(source)).toBe(false)
  })

  it('keeps both originals on conflicting content or a failed destination write', async () => {
    const source = `${root}/skill-overrides/chaoxing/sites/${primary}/SKILL.md`
    const destination = `${root}/skill-overrides/site-learn/sites/${primary}/SKILL.md`
    io.files.set(source, '# Old steps'); io.files.set(destination, '# New steps')
    const migration = await import('../../src/services/agent/websiteDataMigration')
    expect((await migration.migrateWebsiteSkillOverrides()).conflicts).toHaveLength(1)
    expect(io.files.get(source)).toBe('# Old steps'); expect(io.files.get(destination)).toBe('# New steps')
    vi.resetModules(); io.files.delete(destination); io.fail = `/site-learn/sites/${primary}/`
    await expect((await import('../../src/services/agent/websiteDataMigration')).migrateWebsiteSkillOverrides()).rejects.toThrow('write failed')
    expect(io.files.get(source)).toBe('# Old steps')
  })
})
