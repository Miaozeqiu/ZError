// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ files: new Map<string, string>(), documents: new Map<string, unknown>(), requests: vi.fn(), writes: vi.fn(), native: false }))
vi.mock('../../src/services/security/secureStore', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/security/secureStore')>(), isNativeSecureStore: () => io.native,
  readSecureDocument: async (name: string) => io.documents.get(name) ?? null,
  writeSecureDocument: async (name: string, value: unknown) => { io.documents.set(name, JSON.parse(JSON.stringify(value))); return value },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(async (path: string) => {
    if (!io.files.has(path)) throw new Error('ENOENT: No such file or directory')
    return io.files.get(path)!
  }),
  writeTextFile: async (path: string, content: string) => { io.writes(path, content); io.files.set(path, content) },
  mkdir: vi.fn(async () => {}), remove: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: io.requests }))
const base = '.local/share/zerror/skill-overrides/'
const load = async () => {
  const mod = await import('../../src/services/agent/agentSkills')
  await vi.waitFor(() => expect(mod.agentSkillsState.ready).toBe(true))
  return mod
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); io.files.clear(); io.documents.clear(); io.native = false
})

describe('Skill storage and installation', () => {
  it('lists websites when Windows reports that the legacy parent directory is missing', async () => {
    io.native = true
    const { readTextFile, readDir } = await import('@tauri-apps/plugin-fs')
    const originalRead = vi.mocked(readTextFile).getMockImplementation()!
    const originalList = vi.mocked(readDir).getMockImplementation()!
    const missingPath = '系统找不到指定的路径。 (os error 3)'
    vi.mocked(readTextFile).mockImplementation(async (path, options) => {
      if (path.startsWith(base) && !io.files.has(path)) throw missingPath
      return originalRead(path, options)
    })
    vi.mocked(readDir).mockImplementation(async (path, options) => {
      if (path.startsWith(base)) throw missingPath
      return originalList(path, options)
    })
    try {
      const { listWebsiteSettings } = await import('../../src/services/agent/websiteSettings')
      await expect(listWebsiteSettings()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'chaoxing', name: '学习通', files: expect.arrayContaining(['SKILL.md']) }),
      ]))
      const { readAgentSkillFileContent } = await load()
      await expect(readAgentSkillFileContent('site-learn', 'sites/portal.example.com/SKILL.md')).resolves.toBeNull()
    } finally {
      vi.mocked(readTextFile).mockImplementation(originalRead)
      vi.mocked(readDir).mockImplementation(originalList)
    }
  })

  it('distinguishes an absent website document from filesystem read errors without relying on a directory listing', async () => {
    const mod = await load()
    const target = 'sites/portal.example.com/SKILL.md'
    expect(await mod.readAgentSkillFileContent('site-learn', target)).toBeNull()
    io.files.set(base + 'site-learn/' + target, '# Existing portal instructions')
    expect(await mod.readAgentSkillFileContent('site-learn', target)).toMatchObject({ content: '# Existing portal instructions' })
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error('permission denied'))
    await expect(mod.readAgentSkillFileContent('site-learn', target)).rejects.toThrow('permission denied')
    expect(io.files.get(base + 'site-learn/' + target)).toBe('# Existing portal instructions')
  })
  it('exposes and saves only the local note for online websites, with version checks', async () => {
    const mod = await load()
    const { repositoryForHost } = await import('../../src/services/agent/websiteRepository')
    const repository = repositoryForHost('chaoxing.com')
    const original = await mod.readAgentSkillFileContent('site-learn', 'sites/chaoxing.com/SKILL.md')
    expect(original).toMatchObject({ write_scope: 'local_experience', local_experience: '' })
    const upstream = repository.inspect().upstream
    expect(await mod.writeAgentSkillFileContent('chaoxing', 'SKILL.md', '验证过的本地导航', original?.repository_version))
      .toMatchObject({ ok: true })
    const file = await mod.readAgentSkillFileContent('chaoxing', 'SKILL.md')
    expect(file).toMatchObject({ write_scope: 'local_experience', local_experience: '验证过的本地导航' })
    expect(file?.content).toContain('验证过的本地导航')
    expect(await mod.writeAgentSkillFileContent('chaoxing', 'SKILL.md', '过期笔记', original?.repository_version))
      .toHaveProperty('error', expect.stringContaining('重新读取'))
    expect(await mod.resetAgentSkillFile('site-learn', 'sites/chaoxing.com/SKILL.md'))
      .toHaveProperty('error', expect.stringContaining('只可修改'))
    expect(await mod.writeAgentSkillFileContent('site-learn', 'sites//chaoxing.com/./references/study.md', '覆盖', file?.repository_version))
      .toHaveProperty('error', expect.stringContaining('只可修改'))
    expect(repository.inspect()).toMatchObject({ upstream, supplement: '验证过的本地导航' })

    const path = 'sites/custom.example.com/references/guide.md'
    expect(await mod.writeAgentSkillFileContent('site-learn', path, '# 自建参考文件')).toMatchObject({ ok: true })
    expect(io.files.get(base + 'site-learn/' + path)).toBe('# 自建参考文件\n')
  })
  it('ignores local legacy artifacts and rejects their mutation without deleting the stored files', async () => {
    const mod = await load()
    const legacy = ['sites/zjooc.cn/fixtures/page.html', 'sites/zjooc.cn/parsers/study/see.json', 'sites/zjooc.cn/schema.json']
    for (const path of legacy) io.files.set(base + 'site-learn/' + path, 'legacy sample')
    const { readDir, remove } = await import('@tauri-apps/plugin-fs')
    vi.mocked(readDir).mockImplementation(async (dir: any) => {
      const entries = new Map<string, any>()
      for (const path of io.files.keys()) {
        if (!path.startsWith(dir + '/')) continue
        const parts = path.slice(String(dir).length + 1).split('/')
        entries.set(parts[0], { name: parts[0], isDirectory: parts.length > 1, isFile: parts.length === 1 })
      }
      return [...entries.values()]
    })
    try {
      io.writes.mockClear(); vi.mocked(remove).mockClear()
      const doc = await mod.getSkillDocument('site-learn', 'zjooc.cn')
      expect(doc).toBeNull()
      for (const path of legacy) {
        expect(await mod.listSkillFiles('site-learn')).not.toContain(path)
        expect(await mod.getSkillFileContent('site-learn', path)).toBeNull()
        expect(await mod.readAgentSkillFileContent('site-learn', path)).toBeNull()
        await expect(mod.saveSkillFileContent('site-learn', path, 'replacement')).rejects.toThrow('当前网页验证')
        await expect(mod.resetSkillFileContent('site-learn', path)).rejects.toThrow('当前网页验证')
        expect(await mod.writeAgentSkillFileContent('site-learn', path, 'replacement')).toHaveProperty('error')
        expect(io.files.get(base + 'site-learn/' + path)).toBe('legacy sample')
      }
      expect(io.writes).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    } finally {
      vi.mocked(readDir).mockResolvedValue([])
    }
  })

  it('shows only concrete website configurations while internal website learning still persists', async () => {
    const mod = await load()
    expect(mod.agentSkillsState.items.filter(item => mod.isSkillVisibleInSettings(item.id)).map(item => item.id)).toEqual(['chaoxing'])
    for (const id of ['site-learn', 'site-graph']) {
      expect(await mod.getSkillDocument(id)).toBeNull()
      expect(await mod.readAgentSkillContent(id)).not.toBeNull()
    }
    await mod.saveSkillFileContent('site-learn', 'sites/example.com/SKILL.md', '# 已验证的站点步骤')
    expect(io.files.get(base + 'site-learn/sites/example.com/SKILL.md')).toBe('# 已验证的站点步骤\n')
  })

  it('opens one learned website without exposing internal instructions or another website', async () => {
    const mod = await load()
    expect(await mod.getSkillDocument('site-learn', '../zhihuishu.com')).toBeNull()
    expect(await mod.getSkillDocument('site-learn')).toBeNull()
    const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
    io.files.set(base + 'site-learn/sites/zjooc.cn/SKILL.md', '---\nname: 在浙学\n---\n# 在浙学')
    io.files.set(base + 'site-learn/sites/custom.example.com/SKILL.md', '# Custom site')
    vi.mocked(readDir).mockImplementation(async (path: any) => {
      const entries: Record<string, any[]> = {
        [base + 'site-learn']: [{ name: 'sites', isDirectory: true }],
        [base + 'site-learn/sites']: [{ name: 'custom.example.com', isDirectory: true }, { name: 'zjooc.cn', isDirectory: true }],
        [base + 'site-learn/sites/zjooc.cn']: [{ name: 'SKILL.md', isFile: true }],
        [base + 'site-learn/sites/custom.example.com']: [{ name: 'SKILL.md', isFile: true }],
      }
      return entries[path] || []
    })
    // The lazy filesystem module can be loaded through both the host adapter
    // and the mocked module after registry initialization. Exercise the same
    // native command boundary for either path.
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {
      invoke: async (command: string, args: any) => {
        if (command === 'plugin:fs|read_dir') return readDir(args.path, args.options)
        if (command === 'plugin:fs|read_text_file') return new TextEncoder().encode(await readTextFile(args.path, args.options))
        if (command === 'secure_redact') return args.value
        throw new Error(`Unexpected native command: ${command}`)
      },
    } })
    try {
      const doc = await mod.getSkillDocument('site-learn', 'zjooc.cn')
      expect(doc?.name).toBe('在浙学')
      expect(doc?.files?.length).toBeGreaterThan(0)
      expect(doc?.files?.every(path => path.startsWith('sites/zjooc.cn/'))).toBe(true)
      expect(doc?.files).not.toContain('SKILL.md')
      const identity = await import('../../src/services/agent/websiteIdentity')
      expect(identity.websitePrimaryHost('custom.example.com')).toBe('custom.example.com')
      expect(await mod.listSkillFiles('site-learn')).toContain('sites/custom.example.com/SKILL.md')
      expect(await mod.getSkillFileContent('site-learn', 'sites/custom.example.com/SKILL.md')).toMatchObject({ content: '# Custom site' })
      const custom = await mod.getSkillDocument('site-learn', 'custom.example.com')
      expect(custom?.builtin).toBe(false)
      expect(custom?.files).toEqual(['sites/custom.example.com/SKILL.md'])
    } finally {
      vi.mocked(readDir).mockResolvedValue([])
      delete (window as any).__TAURI_INTERNALS__
    }
  })

  it('hides non-website builtins from editing while keeping them readable and blocking all mutations', async () => {
    const mod = await load()
    expect(mod.agentSkillsState.items.filter(item => item.builtin && mod.isSkillEditable(item.id)).map(item => item.id).sort())
      .toEqual(['chaoxing', 'site-graph', 'site-learn'])
    const { remove } = await import('@tauri-apps/plugin-fs')
    io.writes.mockClear()
    vi.mocked(remove).mockClear()
    for (const id of ['campus-bank', 'question-import', 'knowledge-graph', 'quiz-practice', 'folder-admin', 'skill-edit']) {
      expect(mod.getEnabledSkillCatalog().some(item => item.id === id)).toBe(true)
      expect(await mod.readAgentSkillContent(id)).not.toBeNull()
      expect(await mod.getSkillDocument(id)).toBeNull()
      expect((await mod.getSkillFileContent(id, 'SKILL.md'))?.readonly).toBe(true)
      await expect(mod.saveSkillDocument(id, 'replacement')).rejects.toThrow('只读')
      await expect(mod.saveSkillFileContent(id, 'references/new.md', 'replacement')).rejects.toThrow('只读')
      await expect(mod.resetSkillDocument(id)).rejects.toThrow('只读')
      await expect(mod.resetSkillFileContent(id, 'references/new.md')).rejects.toThrow('只读')
      expect(await mod.writeAgentSkillFileContent(id, 'SKILL.md', 'replacement')).toHaveProperty('error')
      expect(await mod.resetAgentSkillFile(id)).toHaveProperty('error')
    }
    expect(io.writes).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps Chinese labels in the catalog and exposes compatibility only on demand', async () => {
    const mod = await load()
    const entry = mod.getEnabledSkillCatalog().find(item => item.id === 'chaoxing')!
    expect(entry.name).toBe('学习通')
    expect(entry).not.toHaveProperty('compatibility')
    const skill = await mod.readAgentSkillContent('chaoxing')
    expect(skill?.compatibility).toBeUndefined()
    expect(skill?.content).toContain('首次同步需要连接 Open')
  })

  it('migrates old overrides into encrypted local notes without changing the originals', async () => {
    io.native = true
    const path = base + 'chaoxing/SKILL.md'
    const original = '---\nname: 我的学习通\ndescription: 旧说明\n---\n\n用户正文\n'
    io.files.set(path, original)
    const mod = await load()
    const doc = await mod.getSkillDocument('chaoxing')
    expect(doc?.name).toBe('学习通')
    expect(doc?.markdown).toContain('name: chaoxing')
    expect(io.files.get(path)).toBe(original)
    await mod.saveSkillDocument('chaoxing', doc!.markdown)
    expect(io.files.get(path)).toBe(original)
    const { repositoryForHost } = await import('../../src/services/agent/websiteRepository')
    expect(repositoryForHost('chaoxing.com').inspect().supplement).toBe('用户正文')
    expect((await mod.getSkillDocument('chaoxing'))?.markdown).toContain('\n\n用户正文\n')
  })

  it('rejects invalid saves before touching the existing root file', async () => {
    const mod = await load()
    const path = base + 'chaoxing/SKILL.md'
    io.files.set(path, 'existing content')
    await expect(mod.saveSkillDocument('chaoxing', '---\nname: wrong\ndescription: x\n---\nbody')).rejects.toThrow('目录一致')
    expect(io.files.get(path)).toBe('existing content')
  })

  it('installs by standard directory ID, retains metadata and supporting files, rejects collisions/mismatch', async () => {
    const mod = await load()
    let markdown = '---\nname: example\ndescription: "Search: test"\nallowed-tools: browser_click\nmetadata:\n  display-name: 中文名称\n  author: Somebody\n---\n# Example\n'
    io.requests.mockImplementation(async (url: string) => ({ ok: true, text: async () => {
      if (url.includes('api.github.com')) return JSON.stringify([
        { name: 'SKILL.md', path: 'skills/example/SKILL.md', type: 'file', download_url: 'https://test/main' },
        { name: 'reference.md', path: 'skills/example/reference.md', type: 'file', download_url: 'https://test/reference' },
      ])
      return url.endsWith('/main') ? markdown : 'Supporting document'
    } }))
    expect(await mod.installSkillFromGitHub('owner/repo/skills/example')).toEqual(['example'])
    expect(io.files.get('.local/share/zerror/skills/example/SKILL.md')).toBe(markdown)
    expect(io.files.get('.local/share/zerror/skills/example/reference.md')).toBe('Supporting document')
    expect(JSON.parse(io.files.get('.local/share/zerror/skills/example/meta.json')!).name).toBe('中文名称')
    mod.agentSkillsState.items.push({ id: 'example', name: '中文名称', description: '', enabled: true, builtin: false, scope: 'both' })
    expect(mod.isSkillEditable('example')).toBe(true)
    await mod.saveSkillFileContent('example', 'reference.md', 'Updated reference')
    expect(io.files.get('.local/share/zerror/skills/example/reference.md')).toBe('Updated reference\n')
    await expect(mod.installSkillFromGitHub('other/repo/skills/example')).rejects.toThrow('其他来源')
    markdown = markdown.replace('name: example', 'name: wrong')
    io.writes.mockClear()
    await expect(mod.installSkillFromGitHub('owner/repo/skills/example')).rejects.toThrow('目录一致')
    expect(io.writes).not.toHaveBeenCalled()
  })
})

it('通用导入 Skill 不依赖网站仓库是否能加载',async()=>{
  const mod=await load()
  const repository=await import('../../src/services/agent/websiteRepository')
  const hosts=vi.spyOn(repository,'websiteRepositoryHosts').mockRejectedValue(new Error('网站缓存失败'))
  try {
    expect(await mod.getSkillFileContent('question-import','references/workflow.md')).toMatchObject({content:expect.stringContaining('本地题库')})
    expect(hosts).not.toHaveBeenCalled()
  } finally { hosts.mockRestore() }
})
