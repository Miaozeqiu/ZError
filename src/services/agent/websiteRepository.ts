import { validateWebsiteRuntime, verifyWebsiteRuntime, websiteToolName, type InstalledWebsiteTool } from './websiteRuntime/protocol'
import { reactive } from 'vue'
import type { ToolDefinition } from './core/tools'
import { validateWebsiteTools } from './websiteToolDefinitions'
import { readSecureDocument, writeSecureDocument, redactNative, isNativeSecureStore } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { createSkillMarkdown, normalizeLegacySkillMarkdown, parseSkillFrontmatter } from './skillFormat'
import { createWebsiteRepository, recoverCachedWebsiteDocument, repositoryPath, validateWebsiteSnapshot, type StoredWebsiteRepositoryDocument, type WebsiteRepositoryDocument, type WebsiteSnapshot } from './websiteRepositoryCore'
import { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY, ZHIHUISHU_REPOSITORY, downloadWebsiteRepository, discoverWebsiteRepositories, WebsiteRepositoryHttpError, type WebsiteRepositoryCandidate } from './websiteRepositoryGitHub'
import { findOpenWebsite, customWebsiteExperienceUrl, downloadCustomWebsiteExperience, downloadOpenWebsiteExperience } from './websiteRepositoryOpen'
import { parseGitHubWebsiteUrl, type GitHubWebsiteSource } from './websiteRepositoryManifest'
import { BUILTIN_WEBSITES, normalizeWebsiteHost, loadWebsiteIdentities, websiteIdentityForHost, websitePrimaryHost } from './websiteIdentity'
export { CHAOXING_REPOSITORY, ZJOOC_REPOSITORY }
export type { WebsiteRepositoryCandidate }
type Configuration = { id: string; name: string; host: string; source?: GitHubWebsiteSource; open?: true }
type RegistryEntry = { configuration: Configuration; document: StoredWebsiteRepositoryDocument }
type Registry = { version: 2; entries: Record<string, RegistryEntry>; removedOpenHosts?: string[] }
type StoredRegistry = Registry & { removedBuiltins?: string[] }
const defaults: Configuration[] = [
  { id: 'chaoxing', name: '学习通', host: 'chaoxing.com', source: CHAOXING_REPOSITORY },
]
export const isRequiredWebsiteRepository = (host: string) => host === 'chaoxing.com'
const configurations = new Map(defaults.map(value => [value.host, value]))
const EMPTY_REVISION = 'unloaded:1', CACHE_TTL = 6 * 60 * 60 * 1000
const initialState = () => ({ ready: false, refreshing: false, revision: '', version: '', checkedAt: 0,
  source: 'offline' as 'offline' | 'repository' | 'http', customUrl: '', changedPaths: [] as string[], error: '', retryAt: 0, iconUrl: '' })
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
// Also recognize official sources persisted before the registry recorded Open installs.
const legacyOpenSources = new Map([
  ['chaoxing.com', CHAOXING_REPOSITORY], ['zjooc.cn', ZJOOC_REPOSITORY], ['zhihuishu.com', ZHIHUISHU_REPOSITORY],
])
const usesOpenExperience = (configuration: Configuration, source: GitHubWebsiteSource) => {
  const legacy = legacyOpenSources.get(configuration.host)
  return configuration.open === true || Boolean(legacy && sameSource(legacy, source))
}
const customSourceOf = (entry?: RegistryEntry) => entry?.document.version === 3 ? entry.document.customSource : undefined
const loadRegistry = async () => {
  loading ||= (async () => {
    const stored = await readSecureDocument<StoredRegistry | Extract<StoredWebsiteRepositoryDocument, { version: 1 }>>('website_repositories')
    const next: StoredRegistry = stored?.version === 1 ? { version: 2, entries: { 'chaoxing.com': { configuration: defaults[0], document: stored } } }
      : stored ?? { version: 2, entries: {} }
    if (next.version !== 2 || !next.entries || Array.isArray(next.entries) || Object.keys(next.entries).length > 64) throw new Error('网站仓库索引无效，已保留原数据')
    for (const removed of [next.removedBuiltins, next.removedOpenHosts]) {
      if (removed !== undefined && (!Array.isArray(removed) || !removed.every(host => typeof host === 'string' && normalizeWebsiteHost(host) === host))) throw new Error('网站仓库删除记录无效')
    }
    const ids = new Map<string, string>(BUILTIN_WEBSITES.map(site => [site.id, site.host]))
    for (const [host, entry] of Object.entries(next.entries)) {
      validConfiguration(entry.configuration)
      if (entry.configuration.host !== host || (ids.has(entry.configuration.id) && ids.get(entry.configuration.id) !== host)) throw new Error('网站仓库索引身份冲突')
      entry.document = recoverCachedWebsiteDocument(entry.document)
      validateWebsiteSnapshot(entry.document.upstream, entry.configuration)
      if (entry.document.upstream.runtime) await verifyWebsiteRuntime(entry.document.upstream.runtime)
      const customRuntime = customSourceOf(entry)?.snapshot.runtime
      if (customRuntime) await verifyWebsiteRuntime(customRuntime)
      ids.set(entry.configuration.id, host)
    }
    const removed = new Set([...(next.removedBuiltins ?? []), ...(next.removedOpenHosts ?? [])])
    registry = { version: 2, entries: clone(next.entries), removedOpenHosts: [...removed].filter(host => !isRequiredWebsiteRepository(host) && !next.entries[host]) }
    for (const [host, entry] of Object.entries(registry.entries)) {
      const customSource = customSourceOf(entry)
      if (!entry.configuration.source && !customSource) continue
      configurations.set(host, entry.configuration)
      const state = websiteRepositoryStates[host] ||= initialState()
      state.customUrl = customSource?.url ?? ''
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
const saveEntry = (configuration: Configuration, document: WebsiteRepositoryDocument, createOnly = false, isCurrent?: () => boolean) =>
  saveRegistry(next => {
    if (isCurrent && !isCurrent()) throw new Error('网站经验来源已变更')
    if (BUILTIN_WEBSITES.some(site => site.id === configuration.id && site.host !== configuration.host)) throw new Error('该网站标识已被内置网站使用')
    if (createOnly && next.removedOpenHosts) next.removedOpenHosts = next.removedOpenHosts.filter(host => host !== configuration.host)
    const existing = next.entries[configuration.host]
    if (createOnly && (existing?.configuration.source || customSourceOf(existing))) throw new Error('该网站刚刚已设置经验来源，未覆盖已有资料')
    if (Object.values(registry.entries).some(entry => entry.configuration.id === configuration.id && entry.configuration.host !== configuration.host)) throw new Error('该网站标识已被另一网站使用')
    next.entries[configuration.host] = { configuration: clone(configuration), document: clone(document) }
    if (Object.keys(next.entries).length > 64) throw new Error('网站仓库数量已达上限')
  })
const fallbackFor = ({ host, id, name }: Configuration): WebsiteSnapshot => ({
  revision: EMPTY_REVISION,
  checkedAt: 0,
  files: {
    'SKILL.md': createSkillMarkdown(id, `${name}网站经验尚未从 Open 下载。`, name, '首次同步需要连接 Open。'),
    'site-graph.json': JSON.stringify({ id, name, host, hostPattern: host.replaceAll('.', '\\.'), nodes: [], edges: [] }),
  },
})
const legacyFiles = async (configuration: Configuration, fallback: WebsiteSnapshot) => {
  if (!isNativeSecureStore()) return {}
  const { readTextFile, readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const options = { baseDir: BaseDirectory.Home }, { host, id, name } = configuration
  const absent = (error: unknown) => /ENOENT|No such file or directory|not found|os error [23]\b/i.test(String(error))
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
const toolDefinitions = reactive<Record<string, ToolDefinition[]>>({})
export const websiteToolsForHost = (host: string): ToolDefinition[] => toolDefinitions[host] ?? []

const runtimePackages = new Map<string, Omit<InstalledWebsiteTool, 'tool'> & { source: string }>()
export function installedWebsiteRuntimeTool(name: string): InstalledWebsiteTool | undefined {
  void repositoryRegistryState.revision
  for (const runtime of runtimePackages.values()) {
    const tool = runtime.runtime.tools.find(tool => websiteToolName(runtime.siteId, tool.name) === name)
    if (tool) return { ...runtime, tool }
  }
}
export function websitePageAutomationTools(host: string) {
  const runtime = runtimePackages.get(host)
  return runtime ? (runtime.runtime.automations || []).map(row => ({ name: websiteToolName(runtime.siteId, row.tool), revision: `${runtime.authority}:${runtime.revision}:${runtime.runtime.bundle.sha256}` })) : []
}
export const websiteRuntimeAuthorityActive = (tool: InstalledWebsiteTool) =>
  runtimePackages.get(tool.host)?.authority === tool.authority
  && Boolean(toolDefinitions[tool.host]?.some(candidate => candidate.function.name === websiteToolName(tool.siteId, tool.tool.name)))

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
  const fallback = fallbackFor(initial)
  const repository = createWebsiteRepository({
    fallback,
    replaceBundledSnapshot: true,
    load: async () => { await loadRegistry(); return registry.entries[host]?.document || null },
    save: document => saveEntry(initial, document, false, () => instances.get(host) === repository),
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
      if (instances.get(host) !== repository) return
      const snapshot = document.customSource?.snapshot ?? document.upstream
      toolDefinitions[host] = validateWebsiteTools(host, snapshot.tools, snapshot.runtime, initial.id)
      if (snapshot.runtime) {
        const customUrl = document.customSource?.url || ''
        const source = JSON.stringify([initial.id, host, customUrl, configurations.get(host)?.source])
        const previous = runtimePackages.get(host)
        runtimePackages.set(host, { siteId: initial.id, host, revision: snapshot.revision,
          source, authority: previous?.source === source ? previous.authority : crypto.randomUUID(),
          runtime: validateWebsiteRuntime(snapshot.runtime, initial.id) })
      } else runtimePackages.delete(host)
      Object.assign(websiteRepositoryStates[host] ||= initialState(), { ready: true, revision: snapshot.revision,
        version: `${host}:${snapshot.revision}:${document.generation}`, checkedAt: snapshot.checkedAt,
        source: document.customSource ? 'http' : snapshot.revision === EMPTY_REVISION ? 'offline' : 'repository',
        customUrl: document.customSource?.url ?? '',
        changedPaths: [...(document.supplement ? ['SKILL.md'] : []), ...(document.graph && !document.customSource ? ['site-graph.json'] : [])],
        iconUrl: snapshot.icon?.dataUrl ?? '' })
      notifyWebsiteRepositoryChanged(host)
    },
  })
  instances.set(host, repository)
  return repository
}
export const hasWebsiteRepository = (host: string) => { void repositoryRegistryState.revision; return configurations.has(host) }
export const isOpenWebsiteRepository = (host: string) => {
  void repositoryRegistryState.revision
  const config = configurations.get(host)
  return Boolean(config?.source && usesOpenExperience(config, config.source))
}
export const websiteIdentityLocked = (host: string, customUrl = websiteRepositoryStates[host]?.customUrl) =>
  isOpenWebsiteRepository(host) || Boolean(customUrl?.trim())

const wasRemovedFromOpen = (host: string) => registry.removedOpenHosts?.includes(host) ?? false
export const repositorySourceFor = (host: string) => configurations.get(host)?.source
export const websiteRepositoryHosts = async () => { await loadRegistry(); return [...configurations.keys()] }

const pending = new Map<string, Promise<void>>()
const lastCustomCheck = new Map<string, number>()
export const refreshWebsiteRepository = async (host: string, force = false) => {
  const repository = repositoryForHost(host)
  await repository.ready()
  if (instances.get(host) !== repository) return
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
export function startInstalledWebsiteSync() {
  if (!isNativeSecureStore()) return () => {}
  let stopped = false
  let running = false
  const sync = async () => {
    if (stopped || running) return
    running = true
    try {
      for (const host of await websiteRepositoryHosts()) {
        if (stopped) break
        await refreshWebsiteRepository(host).catch(() => undefined)
      }
    } finally { running = false }
  }
  const check = () => { void sync().catch(() => undefined) }
  check()
  const timer = window.setInterval(check, CACHE_TTL)
  window.addEventListener('online', check)
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener('online', check)
  }
}

export const ensureWebsiteRepository = async (host: string, checkOnOpen = false) => {
  await loadRegistry()
  await repositoryForHost(host).ready()
  if (websiteRepositoryStates[host]?.customUrl) await refreshWebsiteRepository(host, checkOnOpen)
  else if (isNativeSecureStore()) {
    const refresh = refreshWebsiteRepository(host, checkOnOpen).catch(error => {
      if (hasWebsiteRepository(host)) websiteRepositoryStates[host].error = error instanceof Error ? error.message : '网站仓库无法加载'
    })
    if (websiteRepositoryStates[host].source === 'offline') await refresh
  }
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
export const readChaoxingRepositoryFile = (path: string) => readWebsiteRepositoryFile('chaoxing.com', path)
export const listChaoxingRepositoryFiles = () => listWebsiteRepositoryFiles('chaoxing.com')
export const writeChaoxingRepositoryFile = (path: string, content: string, version?: string) => writeWebsiteRepositoryFile('chaoxing.com', path, content, version)
export const previewWebsiteRepository = async (url: string) => {
  const candidates = await discoverWebsiteRepositories(url, await request())
  for (const candidate of candidates) await verifyIcon(candidate.icon.dataUrl)
  return candidates
}

export const setWebsiteExperienceUrl = (host: string, input: string) => changeSource(host, async () => {
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
      delete toolDefinitions[host]
      runtimePackages.delete(host)
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
  const snapshot = await downloadCustomWebsiteExperience(url, { host, id: active?.id ?? stored?.configuration.id }, await request())
  await verifyIcon(snapshot.icon?.dataUrl)
  const source = { url, snapshot }
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

export const removeWebsiteRepository = (host: string, removeLocalData?: () => Promise<void>) => changeSource(host, async () => {
  await loadRegistry()
  if (isRequiredWebsiteRepository(host)) throw new Error('学习通是默认仓库，不能删除')
  const fromOpen = isOpenWebsiteRepository(host)
  const priorRuntime = runtimePackages.get(host)
  runtimePackages.delete(host)
  notifyWebsiteRepositoryChanged(host)
  try {
    await removeLocalData?.()
    const { packageState } = await import('./websiteRuntime/packageState')
    await packageState.removeOwner(host)
    await saveRegistry(next => {
      delete next.entries[host]
      if (fromOpen) next.removedOpenHosts = [...new Set([...(next.removedOpenHosts ?? []), host])]
    })
  } catch (error) {
    if (priorRuntime) runtimePackages.set(host, { ...priorRuntime, authority: crypto.randomUUID() })
    notifyWebsiteRepositoryChanged(host)
    throw error
  }
  configurations.delete(host)
  instances.delete(host)
  pending.delete(host)
  lastCustomCheck.delete(host)
  delete websiteRepositoryStates[host]
  delete toolDefinitions[host]
  runtimePackages.delete(host)
  repositoryRegistryState.revision++
  notifyWebsiteRepositoryChanged(host)
  const { websiteCheckpoints } = await import('./websiteRuntime/checkpoints')
  await websiteCheckpoints.removeHost(host)
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
  const configuration = { id: website.id, name: website.name, host: website.host, source }
  const previousSnapshot = { revision: '', checkedAt: 0, files: {} }
  const fetch = await request()
  const snapshot = usesOpenExperience(configuration, source)
    ? await downloadOpenWebsiteExperience(website, previousSnapshot, fetch)
    : await downloadWebsiteRepository({ ...source, branch: candidate.revision }, previousSnapshot, fetch, website)
  return installWebsiteSnapshot(configuration, snapshot)
})

async function installWebsiteSnapshot(configuration: Configuration, snapshot: WebsiteSnapshot) {
  validateWebsiteSnapshot(snapshot, configuration)
  if (snapshot.runtime) await verifyWebsiteRuntime(snapshot.runtime)
  await verifyIcon(snapshot.icon?.dataUrl)
  validConfiguration(configuration)
  const legacy = await legacyFiles(configuration, snapshot)
  const dormant = registry.entries[configuration.host]?.document
  const prepared = createWebsiteRepository({ fallback: snapshot, load: async () => dormant?.version === 3 ? { ...dormant, upstream: snapshot } : null,
    save: async () => undefined, download: async () => snapshot, legacy: async () => legacy })
  await prepared.ready()
  await saveEntry(configuration, prepared.inspect(), true)
  configurations.set(configuration.host, configuration)
  websiteRepositoryStates[configuration.host] ||= initialState()
  repositoryRegistryState.revision++
  await repositoryForHost(configuration.host).ready()
  return configuration.host
}

export function installedExperienceHost(host: string) {
  if (hasWebsiteRepository(host)) return host
  for (let offset = host.indexOf('.'); offset !== -1; offset = host.indexOf('.', offset + 1)) {
    const parent = host.slice(offset + 1)
    if (isOpenWebsiteRepository(parent) && !websiteIdentityForHost(parent)?.excludedDomains?.includes(parent)) return parent
  }
  return ''
}

const installRetryAt = new Map<string, number>()

/** Resolve a visited or explicitly requested site; discovery failures leave browsing available. */
async function resolvePageExperience(url: string, reinstallRemoved: boolean): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return ''
  await Promise.all([loadRegistry(), loadWebsiteIdentities()])
  const host = websitePrimaryHost(url)
  if (!host || (!reinstallRemoved && wasRemovedFromOpen(host))) return host
  const installed = installedExperienceHost(host)
  if (installed) {
    await ensureWebsiteRepository(installed)
    return installed
  }
  const fetcher = await request()
  const entry = await findOpenWebsite(host, fetcher)
  if (!entry) return host
  return changeSource(entry.host, async () => {
    if (!reinstallRemoved && wasRemovedFromOpen(entry.host)) return host
    if (hasWebsiteRepository(entry.host)) return entry.host
    if (!reinstallRemoved && Date.now() < (installRetryAt.get(entry.host) ?? 0)) return host
    try {
      const snapshot = await downloadOpenWebsiteExperience(entry, { revision: '', checkedAt: 0, files: {} }, fetcher)
      await installWebsiteSnapshot({ ...entry, name: snapshot.website!.name, open: true }, snapshot)
      installRetryAt.delete(entry.host)
      return entry.host
    } catch {
      installRetryAt.set(entry.host, Date.now() + 60_000)
      return host
    }
  })
}

/** Passive visits retain the user's uninstall choice. */
export const experienceHostForPage = (url: string) => resolvePageExperience(url, false)

/** An explicit website task may reinstall its Open repository; credentials remain separately authorized. */
export const experienceHostForTask = (url: string) => resolvePageExperience(url, true)
