import { applyHomeworkParserParts, homeworkCaptureScript } from '../parser/homeworkRuntime'
import { registerSitePackage } from '../parser/registry'
import { applyStudyParserParts } from '../parser/studyRuntime'
import { listBundledSkillFiles, readBundledSkillFile } from './skills/builtinSkillAssets'
import {
  PARSER_PACKAGES,
  parseParserFileList,
  parserPackageOf,
  type ParserPackageId,
} from './parserParts'

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
export const STUDY_PARSER_PATH = PARSER_PACKAGES.study.dir
export const HOMEWORK_PARSER_PATH = PARSER_PACKAGES.homework.dir
export { parserPackageOf }

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

export const isChaoxingImplPath = (path: string) => (
  path === SITE_GRAPH_PATH || Boolean(parserPackageOf(path))
)

const applyHomeworkParts = (readFile: (path: string) => string | null) => {
  const dir = PARSER_PACKAGES.homework.dir
  const helpers = readFile(`${dir}/helpers.js`)
  const parse = readFile(`${dir}/parse.js`)
  const locate = readFile(`${dir}/locate.js`)
  const capture = readFile(`${dir}/capture.js`)
  applyHomeworkParserParts({
    ...(helpers ? { helpers } : {}),
    ...(parse ? { parse } : {}),
    ...(locate ? { locate } : {}),
    ...(capture ? { capture } : {}),
  })
}

const applyStudyParts = (readFile: (path: string) => string | null) => {
  const dir = PARSER_PACKAGES.study.dir
  const helpers = readFile(`${dir}/helpers.js`) || readFile(`${dir}/frames.js`)
  const catalog = readFile(`${dir}/catalog.js`)
  const locate = readFile(`${dir}/locate.js`)
  applyStudyParserParts({
    ...(helpers ? { helpers } : {}),
    ...(catalog ? { catalog } : {}),
    ...(locate ? { locate } : {}),
  })
}

const applyGenericParts = (siteId: string, role: string, dir: string, readFile: (path: string) => string | null) => {
  const index = readFile(`${dir}/index.js`) || ''
  const names = parseParserFileList(index, ['helpers.js', 'parse.js', 'locate.js'])
  const fileOf = (name: string) => (names.includes(name) ? readFile(`${dir}/${name}`) : null) || readFile(`${dir}/${name}`)
  registerSitePackage(siteId, role, {
    helpers: fileOf('helpers.js') || '',
    parse: fileOf('parse.js') || fileOf('catalog.js') || '',
    locate: fileOf('locate.js') || '',
  })
}

const applyParserFiles = (id: ParserPackageId, readFile: (path: string) => string | null) => {
  if (id === 'homework') applyHomeworkParts(readFile)
  else if (id === 'study') applyStudyParts(readFile)
  else {
    const pack = parserPackageOf(`parsers/${id}`) || PARSER_PACKAGES[id]
    if (pack) applyGenericParts('chaoxing', id, pack.dir, readFile)
  }
}

const loadParserPackage = async (id: ParserPackageId) => {
  const cache = new Map<string, string | null>()
  const override = async (path: string) => {
    if (!cache.has(path)) cache.set(path, await readChaoxingImplFile(path))
    return cache.get(path) || null
  }
  const pack = PARSER_PACKAGES[id] || parserPackageOf(`parsers/${id}`)
  if (!pack) return
  const names = parseParserFileList((await override(`${pack.dir}/index.js`)) || '', pack.files)
  for (const name of names) await override(`${pack.dir}/${name}`)
  applyParserFiles(id, (path) => cache.get(path) ?? readBundledChaoxingFile(path))
}

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

const loadSiteParserDir = (siteId: string, role: string, dir: string, readFile: (path: string) => string | null) => {
  applyGenericParts(siteId, role, dir, readFile)
}

export const applyLearnedParserContent = (path: string, content: string) => {
  const match = String(path || '').replace(/\\/g, '/').match(LEARNED_PARSER)
  if (!match) return false
  const host = match[1]
  const role = match[2]
  const dir = `sites/${host}/parsers/${role}`
  const readFile = (file: string) => (
    file === path ? content : readBundledSkillFile('site-learn', file)
  )
  const graph = parseGraph(readBundledSkillFile('site-learn', `sites/${host}/site-graph.json`))
  const siteId = graph?.id || host
  loadSiteParserDir(siteId, role, dir, readFile)
  if (graph?.host && graph.host !== siteId) loadSiteParserDir(graph.host, role, dir, readFile)
  return true
}

export const seedBundledLearnedSites = () => {
  for (const path of listBundledSkillFiles('site-learn')) {
    if (LEARNED_GRAPH.test(path)) applyLearnedSiteGraphContent(readBundledSkillFile('site-learn', path) || '')
  }
  const roles = new Map<string, { host: string; role: string }>()
  for (const path of listBundledSkillFiles('site-learn')) {
    const match = path.match(LEARNED_PARSER)
    if (!match) continue
    roles.set(`${match[1]}/${match[2]}`, { host: match[1], role: match[2] })
  }
  for (const { host, role } of roles.values()) {
    const dir = `sites/${host}/parsers/${role}`
    const graph = parseGraph(readBundledSkillFile('site-learn', `sites/${host}/site-graph.json`))
    const siteId = graph?.id || host
    const readFile = (file: string) => readBundledSkillFile('site-learn', file)
    loadSiteParserDir(siteId, role, dir, readFile)
    if (graph?.host && graph.host !== siteId) loadSiteParserDir(graph.host, role, dir, readFile)
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
      try {
        const parserDirs = await readDir(`${LEARNED_SITES_DIR}/${name}/parsers`, { baseDir: BaseDirectory.Home }).catch(() => [])
        for (const roleEntry of parserDirs || []) {
          const role = String(roleEntry.name || '').trim()
          if (!role) continue
          const dir = `sites/${name}/parsers/${role}`
          const graph = parseGraph(readBundledSkillFile('site-learn', `sites/${name}/site-graph.json`))
          const siteId = graph?.id || name
          const readFile = (file: string) => readBundledSkillFile('site-learn', file)
          loadSiteParserDir(siteId, role, dir, readFile)
        }
      } catch {
        /* 该站还没有解析器 */
      }
    }
  } catch {
    /* 还没有学过其它站点 */
  }
}

export const applyChaoxingImplContent = (path: string, content: string) => {
  if (path === SITE_GRAPH_PATH) {
    applyGraphSource(content, true)
    return
  }
  const pack = parserPackageOf(path)
  if (!pack) return
  applyParserFiles(pack.id, (file) => (file === path ? content : readBundledChaoxingFile(file)))
}

export const reloadChaoxingImpl = async (path?: string) => {
  if (!path || path === SITE_GRAPH_PATH) {
    try {
      applyGraphSource(await readChaoxingImplFile(SITE_GRAPH_PATH), Boolean(path))
    } catch (error) {
      console.warn('[chaoxing skill] 加载 site-graph.json 失败', error)
    }
    if (path === SITE_GRAPH_PATH) return
  }
  const ids: ParserPackageId[] = path
    ? ([parserPackageOf(path)?.id].filter(Boolean) as ParserPackageId[])
    : ['study', 'homework']
  for (const id of ids) {
    try {
      await loadParserPackage(id)
    } catch (error) {
      console.warn(`[chaoxing skill] 加载 ${id} 解析器失败`, error)
    }
  }
}

try {
  applyParserFiles('study', readBundledChaoxingFile)
} catch (error) {
  console.warn('[chaoxing skill] 内置刷课解析器加载失败', error)
}
try {
  applyParserFiles('homework', readBundledChaoxingFile)
} catch (error) {
  console.warn('[chaoxing skill] 内置作业解析器加载失败', error)
}

void reloadChaoxingImpl()
try { seedBundledLearnedSites() } catch (error) {
  console.warn('[site-learn] 内置站点解析器加载失败', error)
}

if (import.meta.hot) {
  import.meta.hot.accept('./skills/builtinSkillAssets.ts', (mod) => {
    if (!mod) return
    const read = (path: string) => mod.readBundledSkillFile(CHAOXING_SKILL_ID, path)
    try { applyParserFiles('study', read) } catch (error) {
      console.warn('[chaoxing skill] HMR 刷课解析器失败', error)
    }
    try { applyParserFiles('homework', read) } catch (error) {
      console.warn('[chaoxing skill] HMR 作业解析器失败', error)
    }
  })
}
