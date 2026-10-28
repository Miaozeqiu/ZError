// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), mkdir: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: files.read, writeTextFile: files.write, mkdir: files.mkdir, BaseDirectory: { Home: 1 } }))
const key = 'zerror-agent-profiles'
const oldProfile = (id: string, extra = {}) => ({ id, name: id === 'browser' ? '浏览器' : '学习', kind: id, preset: id, systemOverlay: '', skillIds: [], toolPolicy: { domain: id === 'learning' ? 'never' : 'current-site' }, ...extra })
const legacy = (profiles = [oldProfile('browser'), oldProfile('learning')], extra = {}) => ({ version: 1, defaultBrowserId: 'browser', defaultLearningId: 'learning', profiles, ...extra })
const load = () => import('../../src/services/agent/agentProfiles')

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear()
  files.read.mockRejectedValue(new Error('no saved file'))
  files.write.mockResolvedValue(undefined); files.mkdir.mockResolvedValue(undefined)
})

describe('unified Agent profiles', () => {
  it('starts with one preset and one active default', async () => {
    const mod = await load()
    expect(mod.listAgentProfiles().map(p => p.id)).toEqual(['agent'])
    expect(mod.getActiveAgentProfile().id).toBe('agent')
    expect(mod.normalizeProfileStore(null)).toEqual({ version: 2, defaultId: 'agent', profiles: mod.listAgentProfiles() })
  })
  it('merges legacy rules and removes obsolete skill and tool policies', async () => {
    const { normalizeProfileStore } = await load()
    const result = normalizeProfileStore(legacy([
      oldProfile('learning', { systemOverlay: '按证据回答', skillIds: ['quiz', 'shared'] }),
      oldProfile('browser', { systemOverlay: '先确认页面状态', skillIds: ['site', 'shared'], toolPolicy: { domain: 'never' } }),
    ]))
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0].systemOverlay).toContain('按证据回答')
    expect(result.profiles[0].systemOverlay).toContain('仅进行网页操作时适用：\n先确认页面状态')
    expect(result.profiles[0]).not.toHaveProperty('skillIds')
    expect(result.profiles[0]).not.toHaveProperty('toolPolicy')
    expect(result.profiles[0]).not.toHaveProperty('kind')
    expect(normalizeProfileStore(result)).toEqual(result)
  })
  it('retains custom profiles and inactive edited presets during migration', async () => {
    const { normalizeProfileStore } = await load()
    const result = normalizeProfileStore(legacy([
      oldProfile('learning', { systemOverlay: '原学习规则' }),
      oldProfile('browser'),
      oldProfile('custom', { name: '我的配置', preset: undefined, kind: 'learning', systemOverlay: '当前规则' }),
    ], { defaultLearningId: 'custom' }))
    expect(result.defaultId).toBe('agent')
    expect(result.profiles.map(p => p.id)).toEqual(['agent', 'custom', 'legacy-learning'])
    expect(result.profiles[0].systemOverlay).toBe('当前规则')
    expect(result.profiles.find(p => p.id === 'custom')?.name).toBe('我的配置')
    expect(result.profiles.find(p => p.id === 'legacy-learning')?.systemOverlay).toBe('原学习规则')
  })
  it('removes obsolete skill and tool policies from unified and custom configurations', async () => {
    const { normalizeProfileStore } = await load()
    const store = normalizeProfileStore({ version: 2, defaultId: 'custom', profiles: [
      { id: 'agent', name: 'Agent', skillIds: ['site'], toolPolicy: { domain: 'never' } },
      { id: 'custom', name: '自定义', skillIds: ['quiz'], toolPolicy: { domain: 'always' }, systemOverlay: '保留的规则' },
    ] })
    expect(store.defaultId).toBe('custom')
    expect(store.profiles.every(profile => !('skillIds' in profile) && !('toolPolicy' in profile))).toBe(true)
    expect(store.profiles[1].systemOverlay).toBe('保留的规则')
  })
  it('persists the local migration and supports duplicate, default, delete and reset', async () => {
    localStorage.setItem(key, JSON.stringify(legacy([oldProfile('browser', { systemOverlay: '网页规则' }), oldProfile('learning')])))
    const mod = await load()
    expect(JSON.parse(localStorage.getItem(key)!).version).toBe(2)
    expect(JSON.stringify(mod.listAgentProfiles())).not.toContain('skillIds')
    expect(JSON.stringify(mod.listAgentProfiles())).not.toContain('toolPolicy')
    const copy = mod.duplicateAgentProfile('agent', '自定义')!
    mod.setDefaultProfile(copy.id)
    expect(mod.getActiveAgentProfile().id).toBe(copy.id)
    mod.deleteAgentProfile(copy.id)
    expect(mod.getActiveAgentProfile().id).toBe('agent')
    mod.resetAgentProfile('agent')
    expect(mod.getActiveAgentProfile().systemOverlay).toBe('')
  })
  it('does not overwrite edits when a startup file read finishes late', async () => {
    let finish!: (value: string) => void
    files.read.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve }))
    const mod = await load()
    await vi.waitFor(() => expect(files.read).toHaveBeenCalled())
    mod.saveAgentProfile({ ...mod.getActiveAgentProfile(), systemOverlay: '刚修改的规则' })
    finish(JSON.stringify(legacy([oldProfile('browser', { systemOverlay: '旧文件规则' }), oldProfile('learning')])))
    await vi.waitFor(() => expect(files.write).toHaveBeenCalled())
    expect(mod.getActiveAgentProfile().systemOverlay).toBe('刚修改的规则')
  })
  it('loads and migrates a file when there is no local configuration', async () => {
    files.read.mockResolvedValueOnce(JSON.stringify(legacy([oldProfile('browser', { systemOverlay: '从文件恢复' }), oldProfile('learning')])))
    const mod = await load()
    await vi.waitFor(() => expect(mod.getActiveAgentProfile().systemOverlay).toContain('从文件恢复'))
    expect(JSON.parse(localStorage.getItem(key)!).defaultId).toBe('agent')
  })
})
