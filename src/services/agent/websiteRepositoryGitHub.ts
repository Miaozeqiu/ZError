import { validateWebsiteRuntime, verifyWebsiteRuntime } from './websiteRuntime/protocol'
import { validateWebsiteTools } from './websiteToolDefinitions'
import { repositoryPath, validateWebsiteSnapshot, type WebsiteSnapshot } from './websiteRepositoryCore'
import { parseGitHubWebsiteUrl, repositoryIcon, websiteManifest, type GitHubWebsiteSource, type WebsiteManifest, type WebsiteRepositoryIcon } from './websiteRepositoryManifest'
export type { GitHubWebsiteSource } from './websiteRepositoryManifest'
export const CHAOXING_REPOSITORY: GitHubWebsiteSource = { owner: 'Miaozeqiu', name: 'ZError-chaoxing', branch: 'main', root: 'skills/chaoxing', url: 'https://github.com/Miaozeqiu/ZError-chaoxing' }
export const ZJOOC_REPOSITORY: GitHubWebsiteSource = { owner: 'Miaozeqiu', name: 'ZError-zjooc', branch: 'main', root: 'skills/zjooc', url: 'https://github.com/Miaozeqiu/ZError-zjooc' }
export const ZHIHUISHU_REPOSITORY: GitHubWebsiteSource = { owner: 'Miaozeqiu', name: 'ZError-zhihuishu', branch: 'main', root: 'skills/zhihuishu', url: 'https://github.com/Miaozeqiu/ZError-zhihuishu' }
export type WebsiteRepositoryCandidate = { source: GitHubWebsiteSource; website: WebsiteManifest; icon: WebsiteRepositoryIcon; revision: string }
export class WebsiteRepositoryHttpError extends Error {
  constructor(message: string, public retryAt = 0) { super(message) }
}
const shaPattern = /^[0-9a-f]{40}$/
export const limitedJson = async (response: Response, limit: number) => {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('网站仓库响应过大')
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > limit) throw new Error('网站仓库响应过大')
    return JSON.parse(text)
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let text = '', size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if ((size += value.byteLength) > limit) throw new Error('网站仓库响应过大')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
const githubReader = (source: { owner: string; name: string }, request: typeof fetch, now: number) => {
  const canonical = parseGitHubWebsiteUrl(`${source.owner}/${source.name}`)
  const api = `https://api.github.com/repos/${canonical.owner}/${canonical.name}`
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000)
  const get = async (path: string, etag?: string) => {
    const response = await request(`${api}${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...(etag ? { 'If-None-Match': etag } : {}) }, signal: controller.signal, redirect: 'error', credentials: 'omit' })
    if (response.status === 304) return { response, data: null }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const retry = Number(response.headers.get('retry-after')), reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        throw new WebsiteRepositoryHttpError('网站仓库访问暂受限，将继续使用已缓存版本，请稍后更新', Math.max(now + 60_000,
          Number.isFinite(retry) ? now + retry * 1000 : 0, Number.isFinite(reset) ? reset : 0))
      }
      throw new WebsiteRepositoryHttpError(response.status === 404 ? '网站仓库不可访问，请检查仓库是否公开' : `网站仓库读取失败（HTTP ${response.status}），已保留缓存`, now + 60_000)
    }
    return { response, data: await limitedJson(response, 3 * 1024 * 1024) }
  }
  const tree = async (sha: string) => {
    if (!shaPattern.test(sha)) throw new Error('网站仓库版本无效')
    const data = (await get(`/git/trees/${sha}?recursive=1`)).data
    if (!data || data.truncated || !Array.isArray(data.tree)) throw new Error('网站仓库目录不完整，已保留旧缓存')
    return data.tree as Array<{ path: string; mode: string; type: string; sha: string; size: number }>
  }
  const blob = async (entry: { mode: string; type: string; sha: string; size: number } | undefined, max = 512 * 1024) => {
    if (!entry || entry.type !== 'blob' || entry.mode !== '100644' || !shaPattern.test(entry.sha)
      || !Number.isSafeInteger(entry.size) || entry.size > max || entry.size < 0) throw new Error('网站仓库含不支持的文件或链接')
    const data = (await get(`/git/blobs/${entry.sha}`)).data
    if (data?.encoding !== 'base64' || typeof data.content !== 'string' || data.sha !== entry.sha || data.size !== entry.size) throw new Error('网站仓库文件回执不完整')
    const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), char => char.charCodeAt(0))
    if (bytes.length !== entry.size) throw new Error('网站仓库文件长度不符')
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`), object = new Uint8Array(header.length + bytes.length)
    object.set(header); object.set(bytes, header.length)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-1', object))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== entry.sha) throw new Error('网站仓库文件校验失败')
    return bytes
  }
  return { get, tree, blob, text: (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes), close: () => clearTimeout(timer) }
}
export const discoverWebsiteRepositories = async (input: string, request: typeof fetch): Promise<WebsiteRepositoryCandidate[]> => {
  const parsed = parseGitHubWebsiteUrl(input), reader = githubReader(parsed, request, Date.now())
  try {
    const branch = parsed.branch || (await reader.get('')).data?.default_branch
    if (typeof branch !== 'string' || !branch || branch.length > 200) throw new Error('网站仓库默认分支无效')
    const head = (await reader.get(`/commits/${encodeURIComponent(branch)}`)).data
    if (!shaPattern.test(head?.sha)) throw new Error('网站仓库版本无效')
    const tree = await reader.tree(head?.commit?.tree?.sha)
    const paths = tree.filter(entry => typeof entry.path === 'string' && (parsed.root ? entry.path === `${parsed.root}/website.json`
      : /^(?:(?:skills|\.agents\/skills)\/[a-z0-9]+(?:-[a-z0-9]+)*\/)?website\.json$/.test(entry.path)))
    if (!paths.length || paths.length > 16) throw new Error('仓库需包含 website.json、SKILL.md、site-graph.json 和网站图标；最多支持 16 个网站包')
    const candidates: WebsiteRepositoryCandidate[] = []
    for (const entry of paths) {
      const root = entry.path.replace(/(?:^|\/)website\.json$/, '')
      const website = websiteManifest(JSON.parse(reader.text(await reader.blob(entry, 16 * 1024))))
      if (root && root.split('/').at(-1) !== website.id) throw new Error('网站目录名称必须与 website.json 的 id 一致')
      const iconPath = root ? `${root}/${website.icon}` : website.icon
      const icon = repositoryIcon(website.icon, await reader.blob(tree.find(item => item.path === iconPath), 256 * 1024))
      candidates.push({ source: { owner: parsed.owner, name: parsed.name, branch, root, url: parsed.url }, website, icon, revision: head.sha })
    }
    if (new Set(candidates.map(value => value.website.host)).size !== candidates.length || new Set(candidates.map(value => value.website.id)).size !== candidates.length) throw new Error('仓库包含重复的网站域名或标识')
    return candidates
  } finally { reader.close() }
}
export const downloadWebsiteRepository = async (source: GitHubWebsiteSource, previous: WebsiteSnapshot, request: typeof fetch,
  expected: { id: string; host: string }, now = Date.now()): Promise<WebsiteSnapshot> => {
  const reader = githubReader(source, request, now)
  if (source.root && !/^(?:skills|\.agents\/skills)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.root)) { reader.close(); throw new Error('网站包目录无效') }
  try {
    const head = await reader.get(`/commits/${encodeURIComponent(source.branch)}`, previous.etag)
    if (head.response.status === 304) {
      if (!shaPattern.test(previous.revision)) throw new Error('首次读取仓库不能使用空缓存')
      return { ...previous, checkedAt: now }
    }
    const revision = head.data?.sha
    if (!shaPattern.test(revision)) throw new Error('网站仓库版本无效')
    const etag = head.response.headers.get('etag') || undefined
    if (revision === previous.revision && previous.website && previous.icon) return { ...previous, etag, checkedAt: now }
    const tree = await reader.tree(head.data?.commit?.tree?.sha)
    const prefix = source.root ? `${source.root}/` : ''
    const manifest = tree.find(entry => entry.path === prefix + 'website.json')
    const website = websiteManifest(JSON.parse(reader.text(await reader.blob(manifest, 16 * 1024))))
    if (website.id !== expected.id || website.host !== expected.host) throw new Error('网站仓库变更了网站身份，已保留原缓存')
    const entries = tree.filter(entry => typeof entry.path === 'string' && entry.path.startsWith(prefix) && entry.type !== 'tree')
    const runtimeEntry = entries.find(entry => entry.path === prefix + 'runtime.json')
    const runtime = runtimeEntry ? validateWebsiteRuntime(JSON.parse(reader.text(await reader.blob(runtimeEntry, 2 * 1024 * 1024))), website.id) : undefined
    if (runtime) await verifyWebsiteRuntime(runtime)
    const files: Record<string, string> = {}
    let total = 0
    for (const entry of entries) {
      const path = entry.path.slice(prefix.length)
      if (path === 'website.json' || path === 'runtime.json' || path === website?.icon || !source.root && /^(?:README\.md|LICENSE|package\.json|\.gitignore|\.github\/|scripts\/)/.test(path)) continue
      if (!repositoryPath(path) || Object.hasOwn(files, path)) throw new Error('网站仓库含不支持的文件或链接')
      if (Object.keys(files).length >= 32 || !Number.isSafeInteger(entry.size) || (total += entry.size) > 2 * 1024 * 1024) throw new Error('网站仓库文件过多或过大')
      files[path] = reader.text(await reader.blob(entry))
    }
    const icon = repositoryIcon(website.icon, await reader.blob(tree.find(entry => entry.path === prefix + website.icon), 256 * 1024))
    const snapshot = { revision, files, etag, checkedAt: now, website, icon,
      ...(runtime ? { runtime, tools: validateWebsiteTools(website.host, undefined, runtime, website.id) } : {}) }
    validateWebsiteSnapshot(snapshot, expected)
    return snapshot
  } finally { reader.close() }
}
export const downloadChaoxingRepository = (previous: WebsiteSnapshot, request: typeof fetch, now = Date.now()) => downloadWebsiteRepository(CHAOXING_REPOSITORY, previous, request, { id: 'chaoxing', host: 'chaoxing.com' }, now)
