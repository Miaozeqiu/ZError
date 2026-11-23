import { hasWebsiteRepository, repositoryForHost, readChaoxingRepositoryFile, onWebsiteRepositoryChanged, websiteRepositoryHosts, readWebsiteRepositoryFile } from './websiteRepository'

import type { SiteGraphData } from '../browser/siteGraphCore'
export const SITE_GRAPH_PATH = 'site-graph.json'

const OVERRIDE_DIR = '.local/share/zerror/skill-overrides'

let siteGraphSeed: SiteGraphData | null = null
let applySiteGraph: ((data: SiteGraphData) => void) | null = null

export const bindChaoxingSiteGraph = (fn: (data: SiteGraphData) => void) => {
  applySiteGraph = fn
}

const emptyGraph = (): SiteGraphData => ({
  id: 'chaoxing',
  name: '学习通',
  host: 'chaoxing.com',
  hostPattern: 'chaoxing\\.com',
  notes: [],
  nodes: [],
  edges: [],
})

const parseGraph = (raw: string | null): SiteGraphData | null => {
  if (!raw?.trim()) return null
  try {
    const data = JSON.parse(raw) as SiteGraphData
    if (!data?.id || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null
    return data
  } catch {
    return null
  }
}

export const readChaoxingImplFile = async (path: string): Promise<string | null> => (
  (await readChaoxingRepositoryFile(path)).content
)

export const isChaoxingImplPath = (path: string) => path === SITE_GRAPH_PATH

const applyGraphSource = (source: string | null, pushLive: boolean) => {
  const data = parseGraph(source)
  if (!data) return
  siteGraphSeed = data
  if (pushLive) applySiteGraph?.(data)
}

export const getChaoxingSiteGraphSeed = (): SiteGraphData => siteGraphSeed || emptyGraph()

const LEARNED_SITES_DIR = `${OVERRIDE_DIR}/site-learn/sites`
const LEARNED_GRAPH = /^sites\/[^/]+\/site-graph\.json$/
const LEARNED_PARSER = /^sites\/([^/]+)\/parsers\/([^/]+)\//

export const applyLearnedSiteGraphContent = (content: string) => {
  const data = parseGraph(content)
  if (!data || data.id === 'chaoxing') return false
  applySiteGraph?.(data)
  return true
}

export const isLearnedSiteGraphPath = (path: string) => LEARNED_GRAPH.test(String(path || '').replace(/\\/g, '/'))
export const isLearnedParserPath = (path: string) => LEARNED_PARSER.test(String(path || '').replace(/\\/g, '/'))

export const reloadLearnedSiteGraphs = async () => {
  try {
    const { readDir, readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(LEARNED_SITES_DIR, { baseDir: BaseDirectory.Home }).catch(() => [])
    for (const entry of entries || []) {
      const name = String(entry.name || '').trim()
      if (!name) continue
      try {
        const raw = await readTextFile(`${LEARNED_SITES_DIR}/${name}/site-graph.json`, {
          baseDir: BaseDirectory.Home,
        })
        applyLearnedSiteGraphContent(raw)
      } catch {
        /* 该站还没有图谱文件 */
      }
    }
  } catch {
    /* 还没有学过其它站点 */
  }
  try {
    for (const host of await websiteRepositoryHosts()) if (host !== 'chaoxing.com') {
      const file = await readWebsiteRepositoryFile(host, SITE_GRAPH_PATH)
      if (file.content) applyLearnedSiteGraphContent(file.content)
    }
  } catch { /* 缓存不可用时保留现有图谱 */ }
}

export const applyChaoxingImplContent = (path: string, content: string) => {
  if (path === SITE_GRAPH_PATH) applyGraphSource(content, true)
}

export const reloadChaoxingImpl = async (path?: string) => {
  if (path && path !== SITE_GRAPH_PATH) return
  try {
    applyGraphSource(await readChaoxingImplFile(SITE_GRAPH_PATH), Boolean(path))
  } catch (error) {
    console.warn('[chaoxing skill] 加载 site-graph.json 失败', error)
  }
}


void reloadChaoxingImpl()
onWebsiteRepositoryChanged(host => {
  const update = async () => {
    if (hasWebsiteRepository(host)) {
      const file = await repositoryForHost(host).read(SITE_GRAPH_PATH)
      if (host === 'chaoxing.com') applyGraphSource(file.content, true)
      else if (file.content) applyLearnedSiteGraphContent(file.content)
      return
    }
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(`${LEARNED_SITES_DIR}/${host}/${SITE_GRAPH_PATH}`, { baseDir: BaseDirectory.Home }).catch(() => '')
    if (hasWebsiteRepository(host)) return
    if (host === 'chaoxing.com') siteGraphSeed = null
    const { liveSiteGraphs } = await import('../browser/siteGraphCore')
    liveSiteGraphs.value = liveSiteGraphs.value.filter(site => site.host !== host)
    applyLearnedSiteGraphContent(raw)
  }
  void update().catch(() => undefined)
})
