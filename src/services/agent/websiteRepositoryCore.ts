/** A local copy-on-write repository, independent of git executables and UI. */
import { validateSkillMarkdown } from './skillFormat'
import { websiteManifest, type WebsiteManifest, type WebsiteRepositoryIcon } from './websiteRepositoryManifest'
export type WebsiteSnapshot = { revision: string; files: Record<string, string>; etag?: string; checkedAt: number; website?: WebsiteManifest; icon?: WebsiteRepositoryIcon }
export type WebsiteFork = {
  id: string; parentRevision: string; updatedAt: number
  files: Record<string, string>; bases: Record<string, string | null>; conflicts: string[]
}
export type WebsiteLocalCommit = {
  id: string; parent: string; upstreamRevision: string; createdAt: number
  kind: 'write' | 'migrate' | 'reset' | 'resolve-local' | 'resolve-upstream' | 'update'
  paths: string[]
}
export type WebsiteRepositoryDocument = {
  version: 1; generation: number; upstream: WebsiteSnapshot; fork?: WebsiteFork
  migrated?: boolean; history?: WebsiteLocalCommit[]; historyTruncated?: boolean
  selection?: { id: string; snapshot: WebsiteSnapshot }
  checkpoints?: Record<string, WebsiteSnapshot>
}
export const repositoryPath = (path: string) => /^(?:SKILL\.md|site-graph\.json|references\/[a-z0-9][a-z0-9-]*\.md)$/.test(path)
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
export const validateWebsiteSnapshot = (snapshot: WebsiteSnapshot, identity?: { id: string; host: string }) => {
  if (!snapshot || typeof snapshot.revision !== 'string' || !snapshot.revision || !Number.isFinite(snapshot.checkedAt)
    || !snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) throw new Error('网站仓库快照无效')
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

export const createWebsiteRepository = (deps: {
  fallback: WebsiteSnapshot
  load: () => Promise<WebsiteRepositoryDocument | null>
  save: (document: WebsiteRepositoryDocument) => Promise<unknown>
  download: (previous: WebsiteSnapshot) => Promise<WebsiteSnapshot>
  legacy?: () => Promise<Record<string, string>>
  changed?: (document: WebsiteRepositoryDocument) => void
  now?: () => number
}) => {
  const now = deps.now || Date.now
  const identity = JSON.parse(deps.fallback.files['site-graph.json']) as { id: string; host: string }
  const validate = (snapshot: WebsiteSnapshot) => validateWebsiteSnapshot(snapshot, identity)
  let document: WebsiteRepositoryDocument = { version: 1, generation: 0, upstream: copy(deps.fallback) }
  let loaded: Promise<void> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let refreshing: Promise<void> | undefined
  const mutate = <T>(fn: () => Promise<T>) => {
    const next = queue.catch(() => undefined).then(fn)
    queue = next
    return next
  }
  const workingSnapshot = () => ({ ...document.upstream, files: { ...document.upstream.files, ...document.fork?.files } })
  const activeSnapshot = () => document.selection?.snapshot ?? workingSnapshot()
  const latestCheckpoint = () => {
    const entry = document.history?.at(-1)
    return entry?.upstreamRevision === document.upstream.revision ? entry.id : undefined
  }
  const workingId = () => Object.keys(document.fork?.files || {}).length
    ? latestCheckpoint() ?? document.upstream.revision : document.upstream.revision
  const requireWorkingVersion = () => {
    if (document.selection) throw new Error('正在使用历史版本，请先回到工作版本再编辑。')
  }
  const publish = () => deps.changed?.(copy(document))
  const commit = async (next: WebsiteRepositoryDocument, kind?: WebsiteLocalCommit['kind'], paths?: string[]) => {
    const workingChanged = next.upstream.revision !== document.upstream.revision
      || JSON.stringify(next.upstream.files) !== JSON.stringify(document.upstream.files) || JSON.stringify(next.fork) !== JSON.stringify(document.fork)
    const changed = workingChanged || next.selection?.id !== document.selection?.id
    next.generation = document.generation + Number(changed)
    validate({ ...next.upstream, files: { ...next.upstream.files, ...next.fork?.files } })
    if (workingChanged && kind) {
      const entry = { parent: document.history?.at(-1)?.id || document.fork?.parentRevision || document.upstream.revision,
        upstreamRevision: next.upstream.revision, createdAt: now(), kind,
        paths: [...new Set(paths || [])].sort() }
      // A local revision identifier, not a fabricated upstream Git commit SHA.
      const bytes = new TextEncoder().encode(JSON.stringify({ host: identity.host, ...entry, generation: next.generation,
        files: { ...next.upstream.files, ...next.fork?.files }, conflicts: next.fork?.conflicts || [] }))
      const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      next.history = [...(document.history || []), { id, ...entry }]
      if (next.history.length > 200) { next.history = next.history.slice(-200); next.historyTruncated = true }
    }
    const checkpoint = latestCheckpoint()
    if (workingChanged && checkpoint && !next.checkpoints?.[checkpoint]) {
      next.checkpoints = { ...next.checkpoints, [checkpoint]: workingSnapshot() }
    }
    if (workingChanged && next.checkpoints) {
      const ids = Object.keys(next.checkpoints)
      while (ids.length > 8 || new TextEncoder().encode(JSON.stringify(next.checkpoints)).length > 4 * 1024 * 1024) {
        delete next.checkpoints[ids.shift()!]
      }
    }
    await deps.save(copy(next))
    document = next
    publish()
  }
  const setFile = (next: WebsiteRepositoryDocument, path: string, content: string) => {
    if (content === next.upstream.files[path]) {
      if (next.fork) { delete next.fork.files[path]; delete next.fork.bases[path]; next.fork.conflicts = next.fork.conflicts.filter(value => value !== path) }
      return
    }
    next.fork ||= { id: `local-${now().toString(36)}`, parentRevision: next.upstream.revision, updatedAt: now(), files: {}, bases: {}, conflicts: [] }
    if (!own(next.fork.files, path) || next.fork.conflicts.includes(path)) next.fork.bases[path] = next.upstream.files[path] ?? null
    next.fork.files[path] = content
    next.fork.conflicts = next.fork.conflicts.filter(value => value !== path)
    next.fork.updatedAt = now()
  }
  const ready = async () => {
    loaded ||= mutate(async () => {
      const stored = await deps.load()
      if (stored) {
        if (stored.version !== 1 || !Number.isSafeInteger(stored.generation) || stored.generation < 0) throw new Error('网站仓库缓存版本无效')
        validate(stored.upstream)
        if (stored.fork) {
          const fork = stored.fork
          if (typeof fork.id !== 'string' || typeof fork.parentRevision !== 'string' || !fork.files || !fork.bases || !Array.isArray(fork.conflicts)
            || Object.keys(fork.files).some(path => !repositoryPath(path) || !own(fork.bases, path)
              || (fork.bases[path] !== null && typeof fork.bases[path] !== 'string'))
            || fork.conflicts.some(path => !own(fork.files, path))) throw new Error('本地网站分支无效，已保留原数据')
          validate({ ...stored.upstream, files: { ...stored.upstream.files, ...fork.files } })
        }
        if (stored.history !== undefined && (!Array.isArray(stored.history) || stored.history.length > 200
          || stored.history.some(entry => !entry || !/^[a-f0-9]{64}$/.test(entry.id) || typeof entry.parent !== 'string'
            || typeof entry.upstreamRevision !== 'string' || !Number.isFinite(entry.createdAt)
            || !['write', 'migrate', 'reset', 'resolve-local', 'resolve-upstream', 'update'].includes(entry.kind)
            || !Array.isArray(entry.paths) || entry.paths.length > 64 || entry.paths.some(path => !repositoryPath(path)))
          || new Set(stored.history.map(entry => entry.id)).size !== stored.history.length)) throw new Error('本地提交历史无效，已保留原数据')
        if (stored.selection) {
          const { id, snapshot } = stored.selection
          validate(snapshot)
          const valid = /^[a-f0-9]{40}$/.test(id)
            ? id === snapshot.revision
            : stored.history?.some(entry => entry.id === id && entry.upstreamRevision === snapshot.revision)
          if (!valid) throw new Error('选中的网站版本无效，已保留原数据')
        }
        if (stored.checkpoints) {
          const entries = Object.entries(stored.checkpoints)
          if (entries.length > 8) throw new Error('本地网站快照无效，已保留原数据')
          for (const [id, snapshot] of entries) {
            if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('本地网站快照无效，已保留原数据')
            validate(snapshot)
          }
        }
        document = copy(stored)
      }
      // Older versions only retained the current fork. Record a checkpoint without inventing its earlier edits.
      if (!document.history && Object.keys(document.fork?.files || {}).length) {
        const next = copy(document)
        const entry = { parent: next.fork!.parentRevision, upstreamRevision: next.upstream.revision,
          createdAt: Number.isFinite(next.fork!.updatedAt) ? next.fork!.updatedAt : now(), kind: 'migrate' as const, paths: Object.keys(next.fork!.files).sort() }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ host: identity.host, ...entry, files: next.fork!.files })))
        next.history = [{ id: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), ...entry }]
        await commit(next)
      }
      if (!document.migrated && deps.legacy) {
        const legacy = await deps.legacy()
        const next = copy(document)
        for (const [path, content] of Object.entries(legacy)) {
          if (!repositoryPath(path)) continue
          if (own(next.fork?.files || {}, path)) continue
          setFile(next, path, content)
        }
        next.migrated = true
        await commit(next, 'migrate', Object.keys(next.fork?.files || {}))
      }
      publish()
    }).catch(error => { loaded = undefined; throw error })
    await loaded
  }
  const inspect = () => copy(document)
  const version = () => `${identity.host}:${document.upstream.revision}:${document.generation}`
  const read = async (path: string) => {
    if (!repositoryPath(path)) throw new Error('无效的网站仓库文件路径')
    await ready()
    return { content: activeSnapshot().files[path] ?? null, version: version(), readonly: Boolean(document.selection) }
  }
  return {
    ready, inspect, read,
    versionSelection: () => {
      const working = workingId()
      const restorable = Object.keys(document.checkpoints || {})
      const latest = latestCheckpoint()
      if (latest && !restorable.includes(latest)) restorable.push(latest)
      return { currentId: document.selection?.id ?? working, workingId: working, pinned: Boolean(document.selection), restorable }
    },
    selectVersion: async (id: string | null, downloaded?: WebsiteSnapshot) => {
      await ready()
      await mutate(async () => {
        if (id === workingId()) id = null
        if (id === (document.selection?.id ?? null)) return
        const next = copy(document)
        if (id === null) delete next.selection
        else {
          const local = document.history?.find(entry => entry.id === id)
          const snapshot = local
            ? document.checkpoints?.[id] ?? (id === latestCheckpoint() ? workingSnapshot() : undefined)
            : downloaded ?? (document.upstream.revision === id ? document.upstream : undefined)
          if (!snapshot) throw new Error('该历史版本没有可恢复的快照。')
          if (snapshot.revision !== (local?.upstreamRevision ?? id)) throw new Error('下载的网站版本与所选提交不一致。')
          validate(snapshot)
          next.selection = { id, snapshot: copy(snapshot) }
        }
        await commit(next)
      })
    },
    list: async () => { await ready(); return Object.keys(activeSnapshot().files).sort() },
    write: async (path: string, content: string, expectedVersion?: string) => {
      if (!repositoryPath(path)) throw new Error('无效的网站仓库文件路径')
      await ready()
      const expected = expectedVersion || version()
      await mutate(async () => {
        requireWorkingVersion()
        if (expected !== version()) throw new Error('网站经验版本已更新，请重新读取原文并合并后保存；未覆盖现有内容')
        if ((document.fork?.files[path] ?? document.upstream.files[path]) === content) return
        const next = copy(document)
        setFile(next, path, content)
        await commit(next, 'write', [path])
      })
    },
    reset: async (path?: string) => {
      await ready()
      await mutate(async () => {
        requireWorkingVersion()
        const next = copy(document)
        if (!path) delete next.fork
        else {
          if (!repositoryPath(path)) throw new Error('无效的网站仓库文件路径')
          if (next.fork) { delete next.fork.files[path]; delete next.fork.bases[path]; next.fork.conflicts = next.fork.conflicts.filter(value => value !== path) }
        }
        await commit(next, 'reset', path ? [path] : Object.keys(document.fork?.files || {}))
      })
    },
    resolve: async (path: string, choice: 'local' | 'upstream') => {
      await ready()
      await mutate(async () => {
        const next = copy(document)
        requireWorkingVersion()
        if (!next.fork?.conflicts.includes(path)) throw new Error('该文件没有待处理的冲突')
        if (choice === 'upstream') { delete next.fork.files[path]; delete next.fork.bases[path] }
        else if (choice === 'local') next.fork.bases[path] = next.upstream.files[path] ?? null
        else throw new Error('无效的冲突处理方式')
        next.fork.conflicts = next.fork.conflicts.filter(value => value !== path)
        await commit(next, choice === 'local' ? 'resolve-local' : 'resolve-upstream', [path])
      })
    },
    refresh: async () => {
      await ready()
      if (document.selection) return
      if (refreshing) return refreshing
      refreshing = (async () => {
        const snapshot = await deps.download(copy(document.upstream))
        validate(snapshot)
        await mutate(async () => {
          if (document.selection) return
          // Download is outside the write queue: rebase the latest local edits,
          // including writes made while the network request was in progress.
          const next = copy(document)
          next.upstream = copy(snapshot)
          if (next.fork) for (const [path, local] of Object.entries(next.fork.files)) {
            const remote = snapshot.files[path] ?? null
            if (local === remote) { delete next.fork.files[path]; delete next.fork.bases[path]; next.fork.conflicts = next.fork.conflicts.filter(value => value !== path) }
            else if (next.fork.bases[path] !== remote && !next.fork.conflicts.includes(path)) next.fork.conflicts.push(path)
          }
          const paths = [...new Set([...Object.keys(document.upstream.files), ...Object.keys(snapshot.files)])]
            .filter(path => document.upstream.files[path] !== snapshot.files[path])
          await commit(next, document.fork && Object.keys(document.fork.files).length ? 'update' : undefined, paths)
        })
      })().finally(() => { refreshing = undefined })
      return refreshing
    },
  }
}
