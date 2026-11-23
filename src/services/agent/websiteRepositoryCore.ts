/** Cached cloud experience with separately stored local additions. */
import { validateWebsiteTools } from './websiteToolDefinitions'
import type { ToolDefinition } from './core/tools'
import type { WebsiteRuntimePackage } from './websiteRuntime/protocol'
import { parseSkillFrontmatter, validateSkillMarkdown } from './skillFormat'
import { websiteManifest, type WebsiteManifest, type WebsiteRepositoryIcon } from './websiteRepositoryManifest'
export type WebsiteSnapshot = { revision: string; files: Record<string, string>; etag?: string; checkedAt: number; website?: WebsiteManifest; icon?: WebsiteRepositoryIcon; scriptManifest?: string; tools?: ToolDefinition[]; runtime?: WebsiteRuntimePackage; hostApi?: 2 }
type GraphRecord = Record<string, unknown>
type GraphDelta = { nodes: Record<string, GraphRecord>; edges: GraphRecord[] }
export type WebsiteRepositoryDocument = {
  version: 3; generation: number; upstream: WebsiteSnapshot
  supplement: string; graph?: GraphDelta; migrated?: boolean
  customSource?: { url: string; snapshot: WebsiteSnapshot }
}
export type LegacyWebsiteRepositoryDocument = {
  version: 1; generation: number; upstream: WebsiteSnapshot; migrated?: boolean
  fork?: { files: Record<string, string>; bases: Record<string, string | null> }
}
type MultiFileWebsiteRepositoryDocument = Omit<WebsiteRepositoryDocument, 'version' | 'supplement'> & {
  version: 2; supplements: Record<string, string>
}
export type StoredWebsiteRepositoryDocument = WebsiteRepositoryDocument | LegacyWebsiteRepositoryDocument | MultiFileWebsiteRepositoryDocument
// 仅修复本地缓存：无运行包的旧工具定义不可执行，也不能阻断仓库重新同步。
// 网络响应仍走完整校验；保留文本、图谱及本地补充，只失效远端执行元数据。
export const recoverCachedWebsiteDocument = (stored: StoredWebsiteRepositoryDocument): StoredWebsiteRepositoryDocument => {
  const recover = (snapshot: WebsiteSnapshot): WebsiteSnapshot => {
    if (!snapshot || snapshot.runtime !== undefined || snapshot.tools === undefined
      || (Array.isArray(snapshot.tools) && snapshot.tools.length === 0)) return snapshot
    const { tools: _tools, scriptManifest: _manifest, etag: _etag, ...readable } = snapshot
    // 清掉条件更新标识，避免服务器返回 unchanged 后继续缺少运行包。
    return { ...readable, revision: 'unloaded:1', checkedAt: 0 }
  }
  const next = JSON.parse(JSON.stringify(stored)) as StoredWebsiteRepositoryDocument
  next.upstream = recover(next.upstream)
  if (next.version !== 1 && next.customSource) next.customSource.snapshot = recover(next.customSource.snapshot)
  return next
}
export const repositoryPath = (path: string) => /^(?:SKILL\.md|site-graph\.json|references\/[a-z0-9][a-z0-9-]*\.md)$/.test(path)
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
export const validateWebsiteSnapshot = (snapshot: WebsiteSnapshot, identity?: { id: string; host: string }) => {
  if (!snapshot || typeof snapshot.revision !== 'string' || !snapshot.revision || !Number.isFinite(snapshot.checkedAt)
    || !snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) throw new Error('网站仓库快照无效')
  if (snapshot.hostApi !== undefined && snapshot.hostApi !== 2) throw new Error('网站快照宿主 API 不兼容')
  const entries = Object.entries(snapshot.files)
  if (!entries.length || entries.length > 32 || !own(snapshot.files, 'SKILL.md') || !own(snapshot.files, 'site-graph.json')) throw new Error('网站仓库缺少完整入口或图谱')
  let bytes = 0
  for (const [path, content] of entries) {
    if (!repositoryPath(path) || typeof content !== 'string' || content.includes('\0')) throw new Error('网站仓库包含不支持的文件')
    const size = new TextEncoder().encode(content).length
    if (size > 512 * 1024 || (bytes += size) > 2 * 1024 * 1024) throw new Error('网站仓库文件过大')
  }
  const graph = JSON.parse(snapshot.files['site-graph.json'])
  const expected = identity || snapshot.website || { id: graph.id, host: graph.host }
  validateWebsiteTools(expected.host, snapshot.tools, snapshot.runtime, expected.id)
  const errors = validateSkillMarkdown(snapshot.files['SKILL.md'], expected.id)
  if (errors.length) throw new Error(`网站仓库入口无效：${errors.join('；')}`)
  if (snapshot.website) {
    const manifest = websiteManifest(snapshot.website)
    if (manifest.id !== expected.id || manifest.host !== expected.host || !snapshot.icon || snapshot.icon.path !== manifest.icon
      || !/^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[a-zA-Z0-9+/=]+$/.test(snapshot.icon.dataUrl) || snapshot.icon.dataUrl.length > 360000) throw new Error('网站仓库身份或图标无效')
  }
  if (graph.id !== expected.id || graph.host !== expected.host || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || graph.nodes.length > 200 || graph.edges.length > 1000) throw new Error('网站导航图谱无效')
  const ids = new Set<string>()
  new RegExp(graph.hostPattern)
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || !Array.isArray(node.patterns)
      || (node.parserIds != null && !Array.isArray(node.parserIds)) || !Number.isFinite(node.row) || !Number.isFinite(node.col)
      || typeof node.title !== 'string' || typeof node.path !== 'string' || typeof node.summary !== 'string') throw new Error('网站图谱节点无效')
    ids.add(node.id)
    for (const pattern of node.patterns) { if (typeof pattern !== 'string' || pattern.length > 2000) throw new Error('网站图谱规则无效'); new RegExp(pattern) }
  }
  if (graph.edges.some((edge: any) => !ids.has(edge.from) || !ids.has(edge.to) || typeof edge.label !== 'string')) throw new Error('网站图谱连接无效')
}

const supplementHeading = '## 本地补充经验'
const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
const blocks = (text: string) => {
  const result: string[] = []
  let block: string[] = [], fence = ''
  for (const line of normalize(text).split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (!line.trim() && !fence) {
      if (block.length) result.push(block.join('\n'))
      block = []
      continue
    }
    block.push(line)
    if (marker && !fence) fence = marker
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = ''
  }
  if (block.length) result.push(block.join('\n'))
  return result
}
const markdownBody = (path: string, text: string) => path === 'SKILL.md' ? parseSkillFrontmatter(text).rawBody : text
const extraMarkdown = (path: string, cloud: string, edited: string) => {
  const base = normalize(markdownBody(path, cloud)), body = normalize(markdownBody(path, edited))
  const baseline = new Set(blocks(base))
  const candidate = base && body.startsWith(base + '\n') ? body.slice(base.length) : body
  return blocks(candidate).filter(block => block !== supplementHeading && !baseline.has(block)).join('\n\n')
}
const combineMarkdown = (path: string, cloud: string | undefined, supplement: string | undefined) => {
  if (!supplement) return cloud
  if (cloud === undefined) return supplement + '\n'
  const remaining = extraMarkdown(path, cloud, supplement)
  return remaining ? `${cloud.trimEnd()}\n\n${supplementHeading}\n\n${remaining}\n` : cloud
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const graphOf = (raw: string) => JSON.parse(raw) as { nodes: GraphRecord[]; edges: GraphRecord[] }
const edgeKey = (edge: GraphRecord) => JSON.stringify([edge.from, edge.to, edge.label])
const graphDelta = (base: string, text: string): GraphDelta | undefined => {
  const cloud = graphOf(base), edited = graphOf(text)
  const cloudNodes = new Map(cloud.nodes.map(node => [node.id, node]))
  const nodes = Object.fromEntries(edited.nodes.flatMap(node => {
    const original = cloudNodes.get(node.id)
    const changes = Object.fromEntries(Object.entries(node).filter(([key, value]) => key !== 'id' && !equal(original?.[key], value)))
    return Object.keys(changes).length ? [[String(node.id), changes]] : []
  }))
  const cloudEdges = new Set(cloud.edges.map(edgeKey))
  const edges = edited.edges.filter(edge => !cloudEdges.has(edgeKey(edge)))
  return Object.keys(nodes).length || edges.length ? { nodes, edges } : undefined
}
const combineGraph = (base: string, delta: GraphDelta) => {
  const graph = graphOf(base)
  const nodes = new Map(graph.nodes.map(node => [String(node.id), node]))
  for (const [id, fields] of Object.entries(delta.nodes)) {
    const cloud = nodes.get(id)
    // A patch for a cloud node can become orphaned when the node is removed.
    if (cloud || Array.isArray(fields.patterns) && typeof fields.title === 'string' && typeof fields.path === 'string'
      && typeof fields.summary === 'string' && Number.isFinite(fields.row) && Number.isFinite(fields.col)) {
      nodes.set(id, { ...cloud, ...fields, id })
    }
  }
  const edges = new Map(graph.edges.map(edge => [edgeKey(edge), edge]))
  for (const edge of delta.edges) {
    if (nodes.has(String(edge.from)) && nodes.has(String(edge.to))) edges.set(edgeKey(edge), edge)
  }
  return JSON.stringify({ ...graph, nodes: [...nodes.values()], edges: [...edges.values()] }, null, 2) + '\n'
}
const experiencePath = 'SKILL.md'
const graphPath = 'site-graph.json'
const activeSnapshot = (document: WebsiteRepositoryDocument) => document.customSource?.snapshot ?? document.upstream
const effectiveFile = (document: WebsiteRepositoryDocument, path: string) => {
  const base = activeSnapshot(document).files[path]
  if (path === graphPath && document.graph && !document.customSource) return combineGraph(base, document.graph)
  return path === experiencePath ? combineMarkdown(path, base, document.supplement) : base
}
const collectLegacyNotes = (files: Record<string, string>) => {
  const notes = [files[experiencePath]]
  for (const path of Object.keys(files).sort()) {
    if (path !== experiencePath && files[path].trim()) {
      notes.push(`### ${path.split('/').at(-1)!.replace(/\.md$/, '')}\n\n${normalize(files[path])}`)
    }
  }
  return notes.filter(Boolean).join('\n\n')
}

export const createWebsiteRepository = (deps: {
  fallback: WebsiteSnapshot
  replaceBundledSnapshot?: boolean
  load: () => Promise<StoredWebsiteRepositoryDocument | null>
  save: (document: WebsiteRepositoryDocument) => Promise<unknown>
  download: (previous: WebsiteSnapshot) => Promise<WebsiteSnapshot>
  legacy?: () => Promise<Record<string, string>>
  readCustomSource?: (url: string, previous: WebsiteSnapshot) => Promise<WebsiteSnapshot>
  changed?: (document: WebsiteRepositoryDocument) => void
}) => {
  const identity = JSON.parse(deps.fallback.files['site-graph.json']) as { id: string; host: string }
  const validate = (snapshot: WebsiteSnapshot) => validateWebsiteSnapshot(snapshot, identity)
  const validateDocument = (next: WebsiteRepositoryDocument) => {
    // Notes are separate from the cloud package's file budget. Older installs
    // can have notes spread over several reference files.
    if (next.supplement.includes('\0') || new TextEncoder().encode(next.supplement).length > 4 * 1024 * 1024) {
      throw new Error('本地经验过长或包含无效字符，现有内容已保留')
    }
    validate(next.graph
      ? { ...next.upstream, files: { ...next.upstream.files, [graphPath]: combineGraph(next.upstream.files[graphPath], next.graph) } }
      : next.upstream)
    if (next.customSource) {
      if (typeof next.customSource.url !== 'string' || !next.customSource.url.trim()) throw new Error('网站经验自定义地址无效')
      validate(next.customSource.snapshot)
    }
  }
  let document: WebsiteRepositoryDocument = { version: 3, generation: 0, upstream: copy(deps.fallback), supplement: '' }
  let loaded: Promise<void> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let refreshing: { revision: number; task: Promise<void> } | undefined
  let sourceRevision = 0
  const mutate = <T>(fn: () => Promise<T>) => {
    const next = queue.catch(() => undefined).then(fn)
    queue = next
    return next
  }
  const version = () => `${identity.host}:${activeSnapshot(document).revision}:${document.generation}`
  const publish = () => deps.changed?.(copy(document))
  const commit = async (next: WebsiteRepositoryDocument) => {
    const changed = next.upstream.revision !== document.upstream.revision || !equal(next.upstream.files, document.upstream.files)
      || !equal(next.upstream.tools, document.upstream.tools) || next.upstream.scriptManifest !== document.upstream.scriptManifest
      || next.supplement !== document.supplement || !equal(next.graph, document.graph) || !equal(next.customSource, document.customSource)
    next.generation = document.generation + Number(changed)
    validateDocument(next)
    await deps.save(copy(next))
    document = next
    publish()
  }
  const setGraph = (next: WebsiteRepositoryDocument, text: string, base = next.upstream.files[graphPath]) => {
    validate({ ...next.upstream, files: { ...next.upstream.files, [graphPath]: text } })
    const delta = graphDelta(base, text)
    if (delta) next.graph = delta
    else delete next.graph
  }
  const ready = async () => {
    loaded ||= mutate(async () => {
      const cached = await deps.load()
      const stored = cached ? recoverCachedWebsiteDocument(cached) : null
      const next = copy(document)
      const oldNotes: Record<string, string> = {}
      if (stored) {
        if (![1, 2, 3].includes(stored.version) || !Number.isSafeInteger(stored.generation) || stored.generation < 0) throw new Error('网站经验缓存无效')
        validate(stored.upstream)
        next.generation = stored.generation
        next.upstream = copy(stored.upstream)
        next.migrated = stored.migrated
        if (stored.version === 1) {
          for (const [path, text] of Object.entries(stored.fork?.files || {})) {
            if (!repositoryPath(path) || typeof text !== 'string') throw new Error('旧的本地经验无效，已保留原数据')
            const base = stored.fork?.bases?.[path]
            if (path === graphPath) setGraph(next, text, base ?? undefined)
            else oldNotes[path] = extraMarkdown(path, base === null ? '' : base ?? stored.upstream.files[path] ?? '', text)
          }
        } else {
          next.graph = stored.graph && copy(stored.graph)
          if (stored.version === 2) {
            if (!stored.supplements || typeof stored.supplements !== 'object' || Array.isArray(stored.supplements)
              || Object.entries(stored.supplements).some(([path, text]) => !repositoryPath(path) || path === graphPath || typeof text !== 'string')) {
              throw new Error('本地补充无效，已保留原数据')
            }
            Object.assign(oldNotes, stored.supplements)
          } else {
            if (typeof stored.supplement !== 'string') throw new Error('本地补充无效，已保留原数据')
            next.supplement = stored.supplement
            if (stored.customSource) {
              const { url, snapshot } = stored.customSource
              next.customSource = { url, snapshot: copy(snapshot) }
            }
          }
        }
      }
      const needsLegacy = !next.migrated && Boolean(deps.legacy)
      if (needsLegacy) {
        for (const [path, text] of Object.entries(await deps.legacy!())) {
          if (!repositoryPath(path) || own(oldNotes, path) || (path === graphPath && next.graph)) continue
          if (path === graphPath) setGraph(next, text)
          else oldNotes[path] = extraMarkdown(path, next.upstream.files[path] ?? '', text)
        }
        next.migrated = true
      }
      next.supplement = [next.supplement, collectLegacyNotes(oldNotes)].filter(Boolean).join('\n\n')
      const replacedBundle = deps.replaceBundledSnapshot && next.upstream.revision === 'bundled:1'
      if (replacedBundle) next.upstream = copy(deps.fallback)
      validateDocument(next)
      const oldScriptSetting = stored?.version === 3 && stored.customSource && own(stored.customSource, 'scriptsEnabled')
      if ((stored && stored.version !== 3) || needsLegacy || oldScriptSetting || replacedBundle) {
        next.generation++
        await deps.save(copy(next))
      }
      document = next
      publish()
    }).catch(error => { loaded = undefined; throw error })
    await loaded
  }
  const read = async (path: string) => {
    if (!repositoryPath(path)) throw new Error('无效的网站经验文件路径')
    await ready()
    return { content: effectiveFile(document, path) ?? null, supplement: path === experiencePath ? document.supplement : '', version: version() }
  }
  return {
    ready, read, inspect: () => copy(document),
    list: async () => { await ready(); return Object.keys(activeSnapshot(document).files).sort() },
    setCustomSource: async (customSource: WebsiteRepositoryDocument['customSource']) => {
      await ready()
      await mutate(async () => {
        if (!customSource && !document.customSource) return
        await commit({ ...document, customSource })
        sourceRevision++
      })
    },
    write: async (path: string, content: string, expectedVersion?: string) => {
      if (!repositoryPath(path)) throw new Error('无效的网站经验文件路径')
      if (path !== experiencePath && path !== graphPath) throw new Error('云端参考文件为只读。请在网站 SKILL.md 中添加简短的本地补充。')
      await ready()
      const expected = expectedVersion || version()
      return mutate(async () => {
        if (expected !== version()) throw new Error('网站经验已更新，请重新读取后保存，现有内容已保留')
        if (document.customSource) throw new Error('自定义 HTTP 来源的文件为只读，应用内可保存「本地经验」。')
        if (effectiveFile(document, path)?.trim() === content.trim()) return false
        const next = copy(document)
        if (path === graphPath) setGraph(next, content)
        else {
          const base = document.upstream.files[experiencePath]
          // Notes already shown by the cloud still belong to the local note.
          const cloudBlocks = new Set(blocks(markdownBody(experiencePath, base)))
          const hiddenNotes = blocks(document.supplement).filter(block => cloudBlocks.has(block))
          next.supplement = [...hiddenNotes, extraMarkdown(experiencePath, base, content)].filter(Boolean).join('\n\n')
        }
        if (next.supplement === document.supplement && equal(next.graph, document.graph)) return false
        await commit(next)
        return true
      })
    },
    writeSupplement: async (content: string, expected: string | { version: string }) => {
      await ready()
      return mutate(async () => {
        const current = document.supplement
        const text = normalize(content)
        if (typeof expected !== 'string' && expected.version !== version()) {
          throw new Error('网站经验已更新，请重新读取后保存，现有内容已保留')
        }
        if (current === text) return false
        if (typeof expected === 'string' && current !== expected) throw new Error('本地补充已在别处修改，请复制当前草稿后重新打开。')
        const next = copy(document)
        next.supplement = text
        await commit(next)
        return true
      })
    },
    reset: async (path?: string) => {
      await ready()
      await mutate(async () => {
        const next = copy(document)
        if (document.customSource) throw new Error('自定义 HTTP 来源的文件为只读。')
        if (path && !repositoryPath(path)) throw new Error('无效的网站经验文件路径')
        if (!path || path === experiencePath) next.supplement = ''
        if (!path || path === graphPath) delete next.graph
        await commit(next)
      })
    },
    refresh: async () => {
      await ready()
      const revision = sourceRevision
      if (refreshing?.revision === revision) return refreshing.task
      const task = (async () => {
        const customSource = document.customSource
        if (customSource) {
          if (!deps.readCustomSource) throw new Error('此环境无法读取自定义网站经验')
          const snapshot = await deps.readCustomSource(customSource.url, customSource.snapshot)
          validate(snapshot)
          await mutate(async () => {
            if (revision !== sourceRevision) return
            if (equal({ ...customSource.snapshot, checkedAt: 0 }, { ...snapshot, checkedAt: 0 })) return
            await commit({ ...document, customSource: { ...customSource, snapshot } })
          })
          return
        }
        const snapshot = await deps.download(copy(document.upstream))
        validate(snapshot)
        await mutate(async () => {
          if (revision === sourceRevision) await commit({ ...document, upstream: snapshot })
        })
      })().finally(() => { if (refreshing?.task === task) refreshing = undefined })
      refreshing = { revision, task }
      return task
    },
  }
}
