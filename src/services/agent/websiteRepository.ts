import { reactive } from 'vue'
import { readSecureDocument, writeSecureDocument, redactNative, isNativeSecureStore } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { listBundledSkillFiles, readBundledSkillFile } from './skills/builtinSkillAssets'
import { normalizeLegacySkillMarkdown, parseSkillFrontmatter } from './skillFormat'
import { createWebsiteRepository, repositoryPath, validateWebsiteSnapshot, type StoredWebsiteRepositoryDocument, type WebsiteRepositoryDocument, type WebsiteSnapshot } from './websiteRepositoryCore'
import { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY, ZHIHUISHU_REPOSITORY, downloadWebsiteRepository, discoverWebsiteRepositories, WebsiteRepositoryHttpError, type WebsiteRepositoryCandidate } from './websiteRepositoryGitHub'
import { customWebsiteExperienceUrl, downloadCustomWebsiteExperience, downloadOpenWebsiteExperience } from './websiteRepositoryOpen'
import { parseGitHubWebsiteUrl, type GitHubWebsiteSource } from './websiteRepositoryManifest'
export { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY }
export type { WebsiteRepositoryCandidate }
type Configuration = { id: string; name: string; host: string; source?: GitHubWebsiteSource }
type RegistryEntry = { configuration: Configuration; document: StoredWebsiteRepositoryDocument }
type Registry = { version: 2; entries: Record<string, RegistryEntry> }
const defaults: Configuration[] = [
  { id: 'chaoxing', name: '学习通', host: 'chaoxing.com', source: CHAOXING_REPOSITORY },
  { id: 'zjooc', name: '在浙学', host: 'zjooc.cn', source: ZJOOC_REPOSITORY },
  { id: 'zhihuishu', name: '智慧树', host: 'zhihuishu.com', source: ZHIHUISHU_REPOSITORY },
]
const configurations = new Map(defaults.map(value => [value.host, value]))
const OFFLINE_REVISION = 'bundled:1', CACHE_TTL = 6 * 60 * 60 * 1000
const initialState = () => ({ ready: false, refreshing: false, revision: '', version: '', checkedAt: 0,
  source: 'offline' as 'offline' | 'repository' | 'http', customUrl: '', scriptsEnabled: false, changedPaths: [] as string[], error: '', retryAt: 0, iconUrl: '' })
export const websiteRepositoryStates = reactive<Record<string, ReturnType<typeof initialState>>>(Object.fromEntries(defaults.map(({ host }) => [host, initialState()])))
export const websiteRepositoryState = websiteRepositoryStates['chaoxing.com']
export const repositoryRegistryState = reactive({ revision: 0 })
const listeners = new Set<(host: string) => void>()
export const onWebsiteRepositoryChanged = (listener: (host: string) => void) => { listeners.add(listener); return () => listeners.delete(listener) }
const notifyWebsiteRepositoryChanged = (host: string) => { for (const listener of listeners) queueMicrotask(() => listener(host)) }
let registry: Registry = { version: 2, entries: {} }, loading: Promise<void> | undefined, saving: Promise<unknown> = Promise.resolve()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const validConfiguration = (value: Configuration) => {
  if (!value || typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.name !== 'string') throw new Error('网站仓库配置无效')
  const source = value.source
  if (!source) return
  const parsed = parseGitHubWebsiteUrl(source.url)
  if (parsed.owner !== source.owner || parsed.name !== source.name || typeof source.branch !== 'string' || !source.branch || source.branch.length > 200
    || (source.root && !/^(?:skills|\.agents\/skills)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.root))) throw new Error('网站仓库来源无效')
}
const sameSource = (first: GitHubWebsiteSource, second: GitHubWebsiteSource) =>
  first.owner.toLowerCase() === second.owner.toLowerCase() && first.name.toLowerCase() === second.name.toLowerCase()
  && first.branch === second.branch && first.root === second.root
const usesOpenExperience = (configuration: Configuration, source: GitHubWebsiteSource) =>
  configuration.host === 'chaoxing.com' && sameSource(CHAOXING_REPOSITORY, source)
const customSourceOf = (entry?: RegistryEntry) => entry?.document.version === 3 ? entry.document.customSource : undefined
const loadRegistry = async () => {
  loading ||= (async () => {
    const stored = await readSecureDocument<Registry | Extract<StoredWebsiteRepositoryDocument, { version: 1 }>>('website_repositories')
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
    registry = clone({ version: 2, entries: next.entries })
    for (const [host, entry] of Object.entries(registry.entries)) {
      const customSource = customSourceOf(entry)
      if (!entry.configuration.source && !customSource) continue
      configurations.set(host, entry.configuration)
      const state = websiteRepositoryStates[host] ||= initialState()
      state.customUrl = customSource?.url ?? ''
      state.scriptsEnabled = customSource?.scriptsEnabled === true
    }
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
    const existing = next.entries[configuration.host]
    if (createOnly && (existing?.configuration.source || customSourceOf(existing))) throw new Error('该网站刚刚已设置经验来源，未覆盖已有资料')
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
const sourceChanges = new Map<string, Promise<unknown>>()
const changeSource = async <T>(host: string, change: () => Promise<T>) => {
  const next = (sourceChanges.get(host) ?? Promise.resolve()).catch(() => undefined).then(change)
  sourceChanges.set(host, next)
  try { return await next } finally { if (sourceChanges.get(host) === next) sourceChanges.delete(host) }
}
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
    legacy: initial.source ? () => legacyFiles(initial, fallback) : undefined,
    readCustomSource: async (url, previous) => {
      const snapshot = await downloadCustomWebsiteExperience(url, initial, await request())
      if (snapshot.icon?.dataUrl !== previous.icon?.dataUrl) await verifyIcon(snapshot.icon?.dataUrl)
      return snapshot
    },
    download: async previous => {
      const configuration = configurations.get(host)!
      if (!configuration.source) throw new Error('该网站没有远程来源')
      const fetch = await request()
      const snapshot = usesOpenExperience(configuration, configuration.source)
        ? await downloadOpenWebsiteExperience(configuration, previous, fetch)
        : await downloadWebsiteRepository(configuration.source, previous, fetch, configuration)
      await verifyIcon(snapshot.icon?.dataUrl)
      return snapshot
    },
    changed: document => {
      const snapshot = document.customSource?.snapshot ?? document.upstream
      Object.assign(websiteRepositoryStates[host] ||= initialState(), { ready: true, revision: snapshot.revision,
        version: `${host}:${snapshot.revision}:${document.generation}`, checkedAt: snapshot.checkedAt,
        source: document.customSource ? 'http' : snapshot.revision === OFFLINE_REVISION ? 'offline' : 'repository',
        customUrl: document.customSource?.url ?? '',
        scriptsEnabled: document.customSource?.scriptsEnabled === true,
        changedPaths: [...(document.supplement ? ['SKILL.md'] : []), ...(document.graph && !document.customSource ? ['site-graph.json'] : [])],
        iconUrl: snapshot.icon?.dataUrl ?? '' })
      notifyWebsiteRepositoryChanged(host)
    },
  })
  instances.set(host, repository)
  return repository
}
export const chaoxingRepository = repositoryForHost('chaoxing.com')
export const hasWebsiteRepository = (host: string) => { void repositoryRegistryState.revision; return configurations.has(host) }
export const repositorySourceFor = (host: string) => configurations.get(host)?.source
export const websiteRepositoryHosts = async () => { await loadRegistry(); return [...configurations.keys()] }

export const websiteScriptSource = async (host: string) => {
  await loadRegistry()
  const source = customSourceOf(registry.entries[host])
  if (!source?.scriptsEnabled) return null
  return { url: source.url, manifest: source.snapshot.scriptManifest }
}
const pending = new Map<string, Promise<void>>()
const lastCustomCheck = new Map<string, number>()
export const refreshWebsiteRepository = async (host: string, force = false) => {
  const repository = repositoryForHost(host)
  await repository.ready()
  if (pending.has(host)) return pending.get(host)
  const state = websiteRepositoryStates[host], now = Date.now()
  if (state.customUrl) {
    if (!force && (now < state.retryAt || now - (lastCustomCheck.get(host) ?? 0) < 3000)) return
    lastCustomCheck.set(host, now)
  } else {
    const cached = repository.inspect().upstream
    if (!configurations.get(host)?.source || now < state.retryAt || (!force && cached.website && cached.icon && now - cached.checkedAt < CACHE_TTL)) return
  }
  const usingCustomSource = Boolean(state.customUrl)
  state.refreshing = true
  const refresh = repository.refresh().then(() => { if (pending.get(host) === refresh) { state.error = ''; state.retryAt = 0 } }).catch(error => {
    if (pending.get(host) !== refresh) return
    state.error = error instanceof Error ? error.message : '网站经验更新失败，已保留缓存'
    state.retryAt = error instanceof WebsiteRepositoryHttpError ? error.retryAt : Date.now() + (usingCustomSource ? 10_000 : 60_000)
  }).finally(() => { if (pending.get(host) === refresh) { state.refreshing = false; pending.delete(host) } })
  pending.set(host, refresh)
  return refresh
}
export const ensureWebsiteRepository = async (host: string, checkOnOpen = false) => {
  await loadRegistry()
  await repositoryForHost(host).ready()
  if (websiteRepositoryStates[host].customUrl) await refreshWebsiteRepository(host, checkOnOpen)
  else if (isNativeSecureStore()) void refreshWebsiteRepository(host, checkOnOpen).catch(error => { websiteRepositoryStates[host].error = error instanceof Error ? error.message : '网站仓库无法加载' })
}
export const readWebsiteRepositoryFile = async (host: string, path: string) => { await ensureWebsiteRepository(host); return repositoryForHost(host).read(path) }
export const listWebsiteRepositoryFiles = async (host: string) => { await ensureWebsiteRepository(host); return repositoryForHost(host).list() }
export const writeWebsiteRepositoryFile = async (host: string, path: string, content: string, version?: string) => {
  await ensureWebsiteRepository(host)
  const configuration = configurations.get(host)!
  const text = path === 'SKILL.md' ? normalizeLegacySkillMarkdown(content, configuration.id, { name: configuration.name, description: `${configuration.name}操作经验` }) : content
  return repositoryForHost(host).write(path, String(await redactNative(redactObject(text))), version)
}
export const writeWebsiteRepositorySupplement = async (host: string, content: string, expected: string | { version: string }) => {
  await ensureWebsiteRepository(host)
  return repositoryForHost(host).writeSupplement(String(await redactNative(redactObject(content))), expected)
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

export const setWebsiteExperienceUrl = (host: string, input: string, scriptsEnabled = false) => changeSource(host, async () => {
  await loadRegistry()
  const active = configurations.get(host)
  const stored = registry.entries[host]
  if (!input.trim()) {
    if (!active || !customSourceOf(stored)) return
    await repositoryForHost(host).setCustomSource(undefined)
    pending.delete(host)
    lastCustomCheck.delete(host)
    if (!active.source) {
      configurations.delete(host)
      instances.delete(host)
      delete websiteRepositoryStates[host]
      repositoryRegistryState.revision++
      notifyWebsiteRepositoryChanged(host)
    } else {
      websiteRepositoryStates[host].error = ''
      websiteRepositoryStates[host].retryAt = 0
      websiteRepositoryStates[host].refreshing = false
    }
    return
  }
  const url = customWebsiteExperienceUrl(input)
  const current = customSourceOf(stored)
  // Users must be able to turn scripts off while the development server is down.
  if (current?.url === url && !scriptsEnabled && active) {
    await repositoryForHost(host).setCustomSource({ ...current, scriptsEnabled: false })
    return
  }
  const snapshot = await downloadCustomWebsiteExperience(url, { host, id: active?.id ?? stored?.configuration.id }, await request())
  await verifyIcon(snapshot.icon?.dataUrl)
  if (scriptsEnabled && !snapshot.scriptManifest) throw new Error('网站经验接口未提供脚本清单。')
  const source = { url, snapshot, scriptsEnabled }
  if (active) {
    await repositoryForHost(host).setCustomSource(source)
  } else {
    const { id, name } = snapshot.website!
    const configuration = stored?.configuration ?? { id, name, host }
    if ([...configurations.values()].some(value => value.id === id && value.host !== host)) throw new Error('该网站标识已被其他网站使用')
    const prepared = createWebsiteRepository({ fallback: snapshot, load: async () => stored?.document ?? null, save: async () => undefined, download: async () => snapshot })
    await prepared.setCustomSource(source)
    await saveEntry(configuration, prepared.inspect(), true)
    configurations.set(host, configuration)
    await repositoryForHost(host).ready()
    repositoryRegistryState.revision++
  }
  pending.delete(host)
  lastCustomCheck.set(host, Date.now())
  websiteRepositoryStates[host].error = ''
  websiteRepositoryStates[host].retryAt = 0
  websiteRepositoryStates[host].refreshing = false
})

export const importWebsiteRepository = (candidate: WebsiteRepositoryCandidate) => changeSource(candidate.website.host, async () => {
  await loadRegistry()
  const { website, source } = candidate
  const previous = configurations.get(website.host)
  if (previous) {
    if (!previous.source || !sameSource(previous.source, source)) throw new Error('该网站已关联另一仓库或自定义地址，未替换原来源、账号或本地经验')
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
  const dormant = registry.entries[website.host]?.document
  const prepared = createWebsiteRepository({ fallback: snapshot, load: async () => dormant?.version === 3 ? { ...dormant, upstream: snapshot } : null,
    save: async () => undefined, download: async () => snapshot, legacy: async () => legacy })
  await prepared.ready()
  await saveEntry(configuration, prepared.inspect(), true)
  configurations.set(website.host, configuration)
  websiteRepositoryStates[website.host] ||= initialState()
  repositoryRegistryState.revision++
  await repositoryForHost(website.host).ready()
  return website.host
})
