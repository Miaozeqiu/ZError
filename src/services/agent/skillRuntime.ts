import { homeworkCaptureScript } from '../chaoxing/host/homeworkHost'
import '../chaoxing/host'
import { listBundledSkillFiles, readBundledSkillFile } from './skills/builtinSkillAssets'

type SiteGraphData = {
  id: string
  name: string
  host: string
  hostPattern: string
  notes?: string[]
  nodes: unknown[]
  edges: unknown[]
}

export const CHAOXING_SKILL_ID = 'chaoxing'
export const SITE_GRAPH_PATH = 'site-graph.json'
export const STUDY_PARSER_PATH = 'parsers/study'
export const HOMEWORK_PARSER_PATH = 'parsers/homework'

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

export const readBundledChaoxingFile = (path: string) => readBundledSkillFile(CHAOXING_SKILL_ID, path)

export const readOverrideChaoxingFile = async (path: string): Promise<string | null> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(`${OVERRIDE_DIR}/${CHAOXING_SKILL_ID}/${path}`, { baseDir: BaseDirectory.Home })
  } catch {
    return null
  }
}

export const readChaoxingImplFile = async (path: string): Promise<string | null> => (
  (await readOverrideChaoxingFile(path)) || readBundledChaoxingFile(path)
)

export const isChaoxingImplPath = (path: string) => path === SITE_GRAPH_PATH

const applyGraphSource = (source: string | null, pushLive: boolean) => {
  const data = parseGraph(source)
  if (!data) return
  siteGraphSeed = data
  if (pushLive) applySiteGraph?.(data)
}

export const seedChaoxingSiteGraph = (): SiteGraphData => {
  const data = parseGraph(readBundledChaoxingFile(SITE_GRAPH_PATH)) || emptyGraph()
  siteGraphSeed = data
  return data
}

export const getChaoxingSiteGraphSeed = (): SiteGraphData => siteGraphSeed || seedChaoxingSiteGraph()

export const homeworkScript = (name: string) => {
  if (name === 'capture') return homeworkCaptureScript()
  throw new Error(`作业解析器没有注入脚本 ${name}`)
}

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

export const applyLearnedParserContent = (_path: string, _content: string) => false

export const seedBundledLearnedSites = () => {
  for (const path of listBundledSkillFiles('site-learn')) {
    if (LEARNED_GRAPH.test(path)) applyLearnedSiteGraphContent(readBundledSkillFile('site-learn', path) || '')
  }
}

export const reloadLearnedSiteGraphs = async () => {
  seedBundledLearnedSites()
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
try { seedBundledLearnedSites() } catch (error) {
  console.warn('[site-learn] 内置站点解析器加载失败', error)
}

if (import.meta.hot) {
  import.meta.hot.accept('./skills/builtinSkillAssets.ts', () => {
    void reloadChaoxingImpl()
  })
}
