import { reactive } from 'vue'
import { readSecureDocument, writeSecureDocument, redactNative, isNativeSecureStore } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { listBundledSkillFiles, readBundledSkillFile } from './skills/builtinSkillAssets'
import { normalizeLegacySkillMarkdown, parseSkillFrontmatter } from './skillFormat'
import { createWebsiteRepository, repositoryPath, validateWebsiteSnapshot, type WebsiteRepositoryDocument, type WebsiteSnapshot } from './websiteRepositoryCore'
import { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY, downloadWebsiteRepository, discoverWebsiteRepositories, downloadWebsiteCommitHistory, downloadWebsiteHistoryHead, WebsiteRepositoryHttpError, type WebsiteRepositoryCandidate } from './websiteRepositoryGitHub'
import { parseGitHubWebsiteUrl, type GitHubWebsiteSource } from './websiteRepositoryManifest'
export { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY }
export type { WebsiteRepositoryCandidate }
type Configuration = { id: string; name: string; host: string; source: GitHubWebsiteSource }
type RegistryEntry = { configuration: Configuration; document: WebsiteRepositoryDocument }
type CommitPage = Awaited<ReturnType<typeof downloadWebsiteCommitHistory>>
type Registry = { version: 2; entries: Record<string, RegistryEntry>; commitHistory?: Record<string, CommitPage>; historyHeads?: Record<string, { revision: string; localRevision: string }> }
const defaults: Configuration[] = [
  { id: 'chaoxing', name: '学习通', host: 'chaoxing.com', source: CHAOXING_REPOSITORY },
  { id: 'zjooc', name: '在浙学', host: 'zjooc.cn', source: ZJOOC_REPOSITORY },
]
const configurations = new Map(defaults.map(value => [value.host, value]))
const OFFLINE_REVISION = 'bundled:1', CACHE_TTL = 6 * 60 * 60 * 1000
const initialState = () => ({ ready: false, refreshing: false, revision: '', version: '', checkedAt: 0,
  source: 'offline' as 'offline' | 'repository', hasFork: false, pinned: false, changedPaths: [] as string[], conflicts: [] as string[], error: '', retryAt: 0, iconUrl: '' })
export const websiteRepositoryStates = reactive<Record<string, ReturnType<typeof initialState>>>({ 'chaoxing.com': initialState(), 'zjooc.cn': initialState() })
export const websiteRepositoryState = websiteRepositoryStates['chaoxing.com']
export const repositoryRegistryState = reactive({ revision: 0 })
const listeners = new Set<(host: string) => void>()
export const onWebsiteRepositoryChanged = (listener: (host: string) => void) => { listeners.add(listener); return () => listeners.delete(listener) }
let registry: Registry = { version: 2, entries: {} }, loading: Promise<void> | undefined, saving: Promise<unknown> = Promise.resolve()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const validConfiguration = (value: Configuration) => {
  if (!value || typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.name !== 'string') throw new Error('网站仓库配置无效')
  const source = value.source, parsed = parseGitHubWebsiteUrl(source?.url || '')
  if (parsed.owner !== source.owner || parsed.name !== source.name || typeof source.branch !== 'string' || !source.branch || source.branch.length > 200
    || (source.root && !/^(?:skills|\.agents\/skills)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.root))) throw new Error('网站仓库来源无效')
}
const loadRegistry = async () => {
  loading ||= (async () => {
    const stored = await readSecureDocument<Registry | WebsiteRepositoryDocument>('website_repositories')
    const next: Registry = stored?.version === 1 ? { version: 2, entries: { 'chaoxing.com': { configuration: defaults[0], document: stored } } }
      : stored ?? { version: 2, entries: {} }
    if (next.version !== 2 || !next.entries || Array.isArray(next.entries) || Object.keys(next.entries).length > 64) throw new Error('网站仓库索引无效，已保留原数据')
    const ids = new Map(defaults.map(value => [value.id, value.host]))
    for (const [host, entry] of Object.entries(next.entries)) {
      validConfiguration(entry.configuration)
      if (entry.configuration.host !== host || (ids.has(entry.configuration.id) && ids.get(entry.configuration.id) !== host)) throw new Error('网站仓库索引身份冲突')
      validateWebsiteSnapshot(entry.document.upstream, entry.configuration)
      ids.set(entry.configuration.id, host)
    }
    registry = clone(next)
    for (const [host, entry] of Object.entries(registry.entries)) { configurations.set(host, entry.configuration); websiteRepositoryStates[host] ||= initialState() }
    repositoryRegistryState.revision++
  })().catch(error => { loading = undefined; throw error })
  await loading
}
const saveRegistry = (update: (next: Registry) => void) => {
  const pending = saving.catch(() => undefined).then(async () => {
    const next = clone(registry)
    update(next)
    await writeSecureDocument('website_repositories', next)
    registry = next
  })
  saving = pending
  return pending
}
const saveEntry = (configuration: Configuration, document: WebsiteRepositoryDocument, createOnly = false) =>
  saveRegistry(next => {
    if (createOnly && registry.entries[configuration.host]) throw new Error('该网站刚刚已被导入，请重新读取后检查来源；未覆盖已有版本')
    if (Object.values(registry.entries).some(entry => entry.configuration.id === configuration.id && entry.configuration.host !== configuration.host)) throw new Error('该网站标识已被另一网站使用')
    next.entries[configuration.host] = { configuration: clone(configuration), document: clone(document) }
    if (Object.keys(next.entries).length > 64) throw new Error('网站仓库数量已达上限')
  })
const fallbackFor = (configuration: Configuration): WebsiteSnapshot => {
  const { host, id, name } = configuration
  const prefix = id === 'chaoxing' ? '' : `sites/${host}/`
  const skill = id === 'chaoxing' ? 'chaoxing' : 'site-learn'
  const files = Object.fromEntries(listBundledSkillFiles(skill).filter(path => path.startsWith(prefix) && repositoryPath(path.slice(prefix.length)))
    .map(path => [path.slice(prefix.length), readBundledSkillFile(skill, path)!]))
  if (files['SKILL.md']) files['SKILL.md'] = normalizeLegacySkillMarkdown(files['SKILL.md'], id, { name, description: `${name}操作经验` })
  return { revision: OFFLINE_REVISION, checkedAt: 0, files }
}
const legacyFiles = async (configuration: Configuration, fallback: WebsiteSnapshot) => {
  if (!isNativeSecureStore()) return {}
  const { readTextFile, readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const options = { baseDir: BaseDirectory.Home }, { host, id, name } = configuration
  const absent = (error: unknown) => /ENOENT|No such file or directory|not found|os error 2\b/i.test(String(error))
  const read = async (path: string) => { try { return await readTextFile(path, options) } catch (error) { if (absent(error)) return null; throw error } }
  const base = '.local/share/zerror/skill-overrides', dir = id === 'chaoxing' ? `${base}/chaoxing` : `${base}/site-learn/sites/${host}`
  const files: Record<string, string> = {}
  const root = await read(`${dir}/SKILL.md`) ?? (id === 'chaoxing' ? await read(`${base}/chaoxing.md`) : null)
  if (root !== null) files['SKILL.md'] = normalizeLegacySkillMarkdown(root, id, { name, description: `${name}操作经验` })
  let entries
  try { entries = await readDir(`${dir}/references`, options) } catch (error) { if (!absent(error)) throw error; entries = [] }
  for (const path of new Set(['site-graph.json', ...entries.filter(entry => entry.isFile && !entry.isSymlink).map(entry => `references/${entry.name}`)])) {
    if (!repositoryPath(path)) continue
    const content = await read(`${dir}/${path}`)
    if (content !== null) files[path] = content
  }
  if (id === 'chaoxing') {
    const learned = await read(`${base}/site-learn/sites/chaoxing.com/SKILL.md`)
    if (learned?.trim()) {
      const body = parseSkillFrontmatter(learned).body, original = files['SKILL.md'] ?? fallback.files['SKILL.md']
      if (body && !original.includes(body)) files['SKILL.md'] = `${original.trim()}\n\n## 本机已记录的站点经验\n\n${body}\n`
    }
  }
  return await redactNative(redactObject(files))
}
const instances = new Map<string, ReturnType<typeof createWebsiteRepository>>()
const request = async (): Promise<typeof fetch> => isNativeSecureStore() ? (await import('@tauri-apps/plugin-http')).fetch as typeof fetch : globalThis.fetch
const verifyIcon = async (dataUrl?: string) => {
  if (!dataUrl || typeof Image === 'undefined') return
  const image = new Image()
  image.src = dataUrl
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([image.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('网站图标解码超时')), 5000) })])
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 2048 || image.naturalHeight > 2048) throw new Error('网站图标尺寸无效或过大')
  } finally { if (timer) clearTimeout(timer) }
}
export const repositoryForHost = (host: string) => {
  if (instances.has(host)) return instances.get(host)!
  const initial = configurations.get(host)
  if (!initial) throw new Error('该网站尚未关联仓库')
  const fallback = registry.entries[host]?.document.upstream || fallbackFor(initial)
  const repository = createWebsiteRepository({
    fallback,
    load: async () => { await loadRegistry(); return registry.entries[host]?.document || null },
    save: document => saveEntry(configurations.get(host)!, document),
    legacy: () => legacyFiles(configurations.get(host)!, fallback),
    download: async previous => {
      const snapshot = await downloadWebsiteRepository(configurations.get(host)!.source, previous, await request(), configurations.get(host)!)
      await verifyIcon(snapshot.icon?.dataUrl)
      return snapshot
    },
    changed: document => {
      Object.assign(websiteRepositoryStates[host] ||= initialState(), { ready: true, revision: document.upstream.revision,
        version: `${host}:${document.upstream.revision}:${document.generation}`, checkedAt: document.upstream.checkedAt, pinned: Boolean(document.selection),
        source: document.upstream.revision === OFFLINE_REVISION ? 'offline' : 'repository', hasFork: Boolean(Object.keys(document.fork?.files || {}).length),
        changedPaths: Object.keys(document.fork?.files || {}), conflicts: [...(document.fork?.conflicts || [])], iconUrl: document.selection?.snapshot.icon?.dataUrl ?? document.upstream.icon?.dataUrl ?? '' })
      for (const listener of listeners) queueMicrotask(() => listener(host))
    },
  })
  instances.set(host, repository)
  return repository
}
export const chaoxingRepository = repositoryForHost('chaoxing.com')
export const hasWebsiteRepository = (host: string) => { void repositoryRegistryState.revision; return configurations.has(host) }
export const repositorySourceFor = (host: string) => configurations.get(host)?.source
export const websiteRepositoryHosts = async () => { await loadRegistry(); return [...configurations.keys()] }
const pending = new Map<string, Promise<void>>()
export const refreshWebsiteRepository = async (host: string, force = false) => {
  if (pending.has(host)) return pending.get(host)
  const repository = repositoryForHost(host)
  await repository.ready()
  const state = websiteRepositoryStates[host], now = Date.now()
  const { upstream: cached, selection } = repository.inspect()
  if (selection) {
    if (force) throw new Error('正在使用历史版本，请先回到工作版本再更新。')
    return
  }
  if (now < state.retryAt || (!force && cached.website && cached.icon && now - cached.checkedAt < CACHE_TTL)) return
  state.refreshing = true
  const refresh = repository.refresh().then(() => { state.error = ''; state.retryAt = 0 }).catch(error => {
    state.error = error instanceof Error ? error.message : '网站仓库更新失败，已保留缓存'
    state.retryAt = error instanceof WebsiteRepositoryHttpError ? error.retryAt : Date.now() + 60_000
  }).finally(() => { state.refreshing = false; pending.delete(host) })
  pending.set(host, refresh)
  return refresh
}
export const ensureWebsiteRepository = async (host: string) => {
  await loadRegistry()
  await repositoryForHost(host).ready()
  if (isNativeSecureStore()) void refreshWebsiteRepository(host).catch(error => { websiteRepositoryStates[host].error = error instanceof Error ? error.message : '网站仓库无法加载' })
}
export const readWebsiteRepositoryFile = async (host: string, path: string) => { await ensureWebsiteRepository(host); return repositoryForHost(host).read(path) }
export const listWebsiteRepositoryFiles = async (host: string) => { await ensureWebsiteRepository(host); return repositoryForHost(host).list() }
export const writeWebsiteRepositoryFile = async (host: string, path: string, content: string, version?: string) => {
  await ensureWebsiteRepository(host)
  const configuration = configurations.get(host)!
  const text = path === 'SKILL.md' ? normalizeLegacySkillMarkdown(content, configuration.id, { name: configuration.name, description: `${configuration.name}操作经验` }) : content
  await repositoryForHost(host).write(path, String(await redactNative(redactObject(text))), version)
}
export const readWebsiteLocalHistory = async (host: string) => {
  await loadRegistry()
  const repository = repositoryForHost(host)
  await repository.ready()
  const document = repository.inspect()
  return { commits: [...(document.history || [])].reverse(), truncated: Boolean(document.historyTruncated),
    ...repository.versionSelection(), revision: document.upstream.revision, forkId: document.fork?.id || '', hasFork: Boolean(Object.keys(document.fork?.files || {}).length) }
}
const selectRepositoryVersion = async (host: string, id: string | null) => {
  await loadRegistry()
  const repository = repositoryForHost(host)
  await repository.ready()
  if (id === null || /^[a-f0-9]{64}$/.test(id)) return repository.selectVersion(id)
  if (!/^[a-f0-9]{40}$/.test(id)) throw new Error('无效的网站提交版本。')
  const { upstream, selection } = repository.inspect()
  if (selection?.id === id || upstream.revision === id) return repository.selectVersion(id, upstream)
  const configuration = configurations.get(host)!
  const snapshot = await downloadWebsiteRepository(
    { ...configuration.source, branch: id }, { revision: '', files: {}, checkedAt: 0 }, await request(), configuration, undefined, { allowLegacy: true },
  )
  await verifyIcon(snapshot.icon?.dataUrl)
  await repository.selectVersion(id, snapshot)
}
const switchingVersions = new Set<string>()
export const selectWebsiteRepositoryVersion = async (host: string, id: string | null) => {
  if (switchingVersions.has(host)) throw new Error('该网站正在切换版本。')
  switchingVersions.add(host)
  try { await selectRepositoryVersion(host, id) }
  finally { switchingVersions.delete(host) }
}
const commitPages = new Map<string, CommitPage>()
const pendingCommitPages = new Map<string, Promise<CommitPage>>()
export const readWebsiteGitHistoryRevision = async (host: string, fallback: string) => {
  await loadRegistry()
  const head = registry.historyHeads?.[JSON.stringify(configurations.get(host)?.source)]
  return head?.localRevision === fallback && /^[a-f0-9]{40}$/.test(head.revision) ? head.revision : fallback
}
export const readWebsiteGitHistory = async (host: string, revision: string, page = 1) => {
  await loadRegistry()
  const source = configurations.get(host)?.source
  if (!source) throw new Error('该网站尚未关联仓库')
  const key = JSON.stringify([source, revision, page])
  const cached = commitPages.get(key) ?? registry.commitHistory?.[key]
  if (Array.isArray(cached?.commits) && typeof cached.hasMore === 'boolean') return clone(cached)
  let pending = pendingCommitPages.get(key)
  if (!pending) {
    pending = (async () => {
      const result = await downloadWebsiteCommitHistory(source, revision, page, await request())
      if (commitPages.size >= 100) commitPages.delete(commitPages.keys().next().value!)
      commitPages.set(key, result)
      // A page is pinned to a commit SHA. Fetch again when the revision changes or the page was evicted.
      await saveRegistry(next => {
        const pages = { ...next.commitHistory, [key]: result }
        const keys = Object.keys(pages)
        while (keys.length > 32 || JSON.stringify(pages).length > 512 * 1024) delete pages[keys.shift()!]
        next.commitHistory = pages
      }).catch(() => undefined) // A disk failure still allows this session to display the fetched page.
      return result
    })().finally(() => pendingCommitPages.delete(key))
    pendingCommitPages.set(key, pending)
  }
  return clone(await pending)
}
const pendingHistoryRefresh = new Map<string, Promise<CommitPage & { revision: string }>>()
export const refreshWebsiteGitHistory = async (host: string) => {
  await loadRegistry()
  const source = configurations.get(host)?.source
  if (!source) throw new Error('该网站尚未关联仓库')
  const key = JSON.stringify(source)
  let pending = pendingHistoryRefresh.get(key)
  if (!pending) {
    pending = (async () => {
      const { revision: localRevision } = await readWebsiteLocalHistory(host)
      const revision = await downloadWebsiteHistoryHead(source, await request())
      const page = await readWebsiteGitHistory(host, revision)
      // Refresh only the history reference. Website snapshots, forks and
      // conflicts remain untouched until the user updates the website itself.
      await saveRegistry(next => {
        const heads = { ...next.historyHeads }
        delete heads[key]
        heads[key] = { revision, localRevision }
        while (Object.keys(heads).length > 64) delete heads[Object.keys(heads)[0]]
        next.historyHeads = heads
      })
      return { ...page, revision }
    })().finally(() => pendingHistoryRefresh.delete(key))
    pendingHistoryRefresh.set(key, pending)
  }
  return clone(await pending)
}
export const ensureChaoxingRepository = () => ensureWebsiteRepository('chaoxing.com')
export const refreshChaoxingRepository = (force = false) => refreshWebsiteRepository('chaoxing.com', force)
export const readChaoxingRepositoryFile = (path: string) => readWebsiteRepositoryFile('chaoxing.com', path)
export const listChaoxingRepositoryFiles = () => listWebsiteRepositoryFiles('chaoxing.com')
export const writeChaoxingRepositoryFile = (path: string, content: string, version?: string) => writeWebsiteRepositoryFile('chaoxing.com', path, content, version)
export const previewWebsiteRepository = async (url: string) => {
  const candidates = await discoverWebsiteRepositories(url, await request())
  for (const candidate of candidates) await verifyIcon(candidate.icon.dataUrl)
  return candidates
}
export const importWebsiteRepository = async (candidate: WebsiteRepositoryCandidate) => {
  await loadRegistry()
  const { website, source } = candidate
  const previous = configurations.get(website.host)
  if (previous) {
    const original = previous.source
    if (original.owner.toLowerCase() !== source.owner.toLowerCase() || original.name.toLowerCase() !== source.name.toLowerCase()
      || original.branch !== source.branch || original.root !== source.root) throw new Error('该网站已关联另一仓库，未替换原来源、账号或本地经验')
    await refreshWebsiteRepository(website.host, true)
    if (websiteRepositoryStates[website.host].error) throw new Error(websiteRepositoryStates[website.host].error)
    return website.host
  }
  if ([...configurations.values()].some(value => value.id === website.id && value.host !== website.host)) throw new Error('该网站标识已被其他网站使用')
  const snapshot = await downloadWebsiteRepository({ ...source, branch: candidate.revision }, { revision: '', checkedAt: 0, files: {} }, await request(), website)
  await verifyIcon(snapshot.icon?.dataUrl)
  const configuration = { id: website.id, name: website.name, host: website.host, source }
  validConfiguration(configuration)
  const legacy = await legacyFiles(configuration, snapshot)
  const prepared = createWebsiteRepository({ fallback: snapshot, load: async () => null, save: async () => undefined, download: async () => snapshot, legacy: async () => legacy })
  await prepared.ready()
  await saveEntry(configuration, prepared.inspect(), true)
  configurations.set(website.host, configuration)
  websiteRepositoryStates[website.host] ||= initialState()
  repositoryRegistryState.revision++
  await repositoryForHost(website.host).ready()
  return website.host
}
