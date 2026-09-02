import { readBundledSkillFile } from './skills/builtinSkillAssets'
import {
  PARSER_PACKAGES,
  assembleParserSource,
  collectAssembledFns,
  inferPageHelperNames,
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

type ParserFn = (...args: unknown[]) => string
type ParserMap = Record<string, string | ParserFn>

const parsers: Record<'study' | 'homework', ParserMap> = {
  study: {},
  homework: {},
}

let siteGraphSeed: SiteGraphData | null = null
let applySiteGraph: ((data: SiteGraphData) => void) | null = null

export const bindChaoxingSiteGraph = (fn: (data: SiteGraphData) => void) => {
  applySiteGraph = fn
}

const isFn = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function'

const flattenPageArgs = (rest: unknown[]) => {
  const helpers: Array<(...args: unknown[]) => unknown> = []
  let bindings: Record<string, unknown> | null = null
  for (const item of rest) {
    if (!item) continue
    if (isFn(item)) helpers.push(item)
    else if (Array.isArray(item)) {
      for (const entry of item) {
        if (isFn(entry)) helpers.push(entry)
      }
    } else if (typeof item === 'object' && !bindings) {
      bindings = item as Record<string, unknown>
    }
  }
  return { helpers, bindings }
}

const helperNameOf = (fn: (...args: unknown[]) => unknown) => (
  fn.name || (fn.toString().match(/^function\s+([A-Za-z_$][\w$]*)/) || [])[1] || ''
)

const buildPageScript = (
  fn: (...args: unknown[]) => unknown,
  helperTexts: string[],
  bindings: Record<string, unknown> | null,
) => {
  const prelude = helperTexts.join('\n')
  const assigns = bindings
    ? Object.entries(bindings).map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`).join('\n')
    : ''
  const invoke = fn.length && !bindings ? '' : '()'
  return `(function(){\n${prelude}\n${assigns}\nreturn (${fn.toString()})${invoke};\n})()`
}

/** 把 Skill 里的真函数拼成页面 IIFE。有参数的函数返回函数本身，供外面 `(args)` 调用。 */
export const compilePageScript = (fn: unknown, ...rest: unknown[]) => {
  if (!isFn(fn)) return String(fn ?? '')
  const { helpers, bindings } = flattenPageArgs(rest)
  return buildPageScript(fn, helpers.map((item) => item.toString()), bindings)
}

const compilePageWithPool = (source: string) => {
  const pool = collectAssembledFns(source)
  return (fn: unknown, ...rest: unknown[]) => {
    if (!isFn(fn)) return String(fn ?? '')
    const { helpers, bindings } = flattenPageArgs(rest)
    const used = new Set<string>()
    const texts: string[] = []
    for (const name of inferPageHelperNames(fn.toString(), pool, fn.name)) {
      const text = pool.get(name)
      if (!text || used.has(name)) continue
      used.add(name)
      texts.push(text)
    }
    for (const extra of helpers) {
      const name = helperNameOf(extra)
      if (name && used.has(name)) continue
      if (name) used.add(name)
      texts.push(extra.toString())
    }
    return buildPageScript(fn, texts, bindings)
  }
}

export const evalSkillModule = (source: string): Record<string, unknown> => {
  const text = String(source || '').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('Skill 模块为空')
  const result = new Function(`"use strict"; return (${text});`)()
  const raw = isFn(result) ? result(compilePageWithPool(text)) : result
  if (!raw || typeof raw !== 'object') throw new Error('Skill 模块必须返回对象')
  return raw as Record<string, unknown>
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

const asParserMap = (raw: unknown): ParserMap => {
  if (!raw || typeof raw !== 'object') return {}
  const out: ParserMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'function') out[key] = value as string | ParserFn
  }
  return out
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

const applyParserSource = (id: ParserPackageId, source: string | null) => {
  if (!source?.trim()) return
  parsers[id] = asParserMap(evalSkillModule(source))
}

const applyParserFiles = (id: ParserPackageId, readFile: (path: string) => string | null) => {
  const pack = PARSER_PACKAGES[id]
  const index = readFile(`${pack.dir}/index.js`)
  if (index?.trim()) {
    const names = parseParserFileList(index, pack.files)
    applyParserSource(id, assembleParserSource(index, names.map((name) => readFile(`${pack.dir}/${name}`) || '')))
    return
  }
  const legacy = readFile(pack.legacy)
  if (legacy?.trim()) applyParserSource(id, legacy)
}

const loadParserPackage = async (id: ParserPackageId) => {
  const cache = new Map<string, string | null>()
  const readFile = async (path: string) => {
    if (!cache.has(path)) cache.set(path, await readChaoxingImplFile(path))
    return cache.get(path) || null
  }
  const pack = PARSER_PACKAGES[id]
  const index = await readFile(`${pack.dir}/index.js`)
  if (index?.trim()) {
    const names = parseParserFileList(index, pack.files)
    const parts: string[] = []
    for (const name of names) parts.push((await readFile(`${pack.dir}/${name}`)) || '')
    applyParserSource(id, assembleParserSource(index, parts))
    return
  }
  applyParserSource(id, await readFile(pack.legacy))
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

const parserScript = (id: 'study' | 'homework', name: string, args: unknown[]) => {
  const value = parsers[id][name]
  if (typeof value === 'function') return String(value(...args) ?? '')
  if (typeof value === 'string') return value
  throw new Error(`学习通 Skill 缺少解析器脚本 ${id}.${name}`)
}

export const studyScript = (name: string, ...args: unknown[]) => parserScript('study', name, args)
export const homeworkScript = (name: string, ...args: unknown[]) => parserScript('homework', name, args)

export const applyChaoxingImplContent = (path: string, content: string) => {
  if (path === SITE_GRAPH_PATH) {
    applyGraphSource(content, true)
    return
  }
  const pack = parserPackageOf(path)
  if (!pack) return
  if (path === pack.legacy) {
    applyParserSource(pack.id, content)
    return
  }
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
