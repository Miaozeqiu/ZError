import helpersSrc from '../agent/skills/bundled/chaoxing/parsers/study/helpers.js?raw'
import locateSrc from '../agent/skills/bundled/chaoxing/parsers/study/locate.js?raw'
import catalogSrc from '../agent/skills/bundled/chaoxing/parsers/study/catalog.js?raw'
import { bindReadScript } from '../browser/protocol'
import { READ_PAGE_DOM } from '../browser/pageDom'
import type { ChaoxingChapterSnap } from '../chaoxing/study/types'
import { evalLocalApi, joinParts, locateTickScript, pageScript, tickScript } from './runtime'
import type { ParserHandle } from './types'

let controlApiCache: { source: string; api: StudyControlApi } | null = null

export type StudyParserParts = {
  helpers: string
  catalog: string
  locate: string
}

export type StudyParseApi = {
  __zeScanOne: (win: { location: { href: string; pathname: string; host: string }; document: Document }) => (ChaoxingChapterSnap & { score?: number }) | null
  __cxFindChapterEl: (doc: Document, title: string, chapterId?: string) => Element | null
  collectSteps: (doc: Document) => Array<{ label: string; video: boolean; quiz: boolean; active: boolean; jobDone?: boolean }>
}

export type StudyControlApi = StudyParseApi & {
  collectAllSteps: () => Array<{ label: string; video: boolean; quiz: boolean; active: boolean; jobDone?: boolean }>
  locate: (handle: ParserHandle) => Record<string, unknown>
}

let parts: StudyParserParts = {
  helpers: helpersSrc,
  catalog: catalogSrc,
  locate: locateSrc,
}

let parseApiCache: { source: string; api: StudyParseApi } | null = null

export const applyStudyParserParts = (next: Partial<StudyParserParts>) => {
  parts = {
    helpers: next.helpers ?? parts.helpers,
    catalog: next.catalog ?? parts.catalog,
    locate: next.locate ?? parts.locate,
  }
  parseApiCache = null
  controlApiCache = null
}

export const studyHelpersSource = () => parts.helpers
export const studyParseSource = () => joinParts(parts.helpers, parts.catalog)
export const studyLocateSource = () => joinParts(parts.helpers, parts.locate)

export const studyParseApi = (): StudyParseApi => {
  const source = studyParseSource()
  if (parseApiCache?.source === source) return parseApiCache.api
  const api = evalLocalApi(source, ['__zeScanOne', '__cxFindChapterEl', 'collectSteps'])
  parseApiCache = { source, api }
  return api
}

/** 宿主侧解析器接口：目录 + 任务点 + locate。不注入页面。 */
export const studyControlApi = (): StudyControlApi => {
  const source = joinParts(parts.helpers, parts.catalog, parts.locate)
  if (controlApiCache?.source === source) return controlApiCache.api
  const api = evalLocalApi(source, [
    '__zeScanOne',
    '__cxFindChapterEl',
    'collectSteps',
    'collectAllSteps',
    'locate',
  ]) as StudyControlApi
  controlApiCache = { source, api }
  return api
}

export const studyLocateScript = (handle: ParserHandle) => (
  locateTickScript(studyHelpersSource(), parts.locate, `return locate(${JSON.stringify(handle)});`)
)

export const studyPageScript = (body: string) => pageScript(studyHelpersSource(), body)

export const studyTickScript = (body: string) => tickScript(studyHelpersSource(), body)

bindReadScript('catalog', READ_PAGE_DOM)
