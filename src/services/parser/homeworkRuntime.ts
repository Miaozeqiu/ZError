import captureSrc from '../agent/skills/bundled/chaoxing/parsers/homework/capture.js?raw'
import helpersSrc from '../agent/skills/bundled/chaoxing/parsers/homework/helpers.js?raw'
import locateSrc from '../agent/skills/bundled/chaoxing/parsers/homework/locate.js?raw'
import parseSrc from '../agent/skills/bundled/chaoxing/parsers/homework/parse.js?raw'
import { bindReadScript } from '../browser/protocol'
import type { HomeworkQuestion } from '../chaoxing/homework/types'
import { evalLocalApi, joinParts, pageScript } from './runtime'
import type { ParserHandle } from './types'

export type HomeworkParserParts = {
  helpers: string
  parse: string
  locate: string
  capture: string
}

export type HomeworkParseApi = {
  __hwParseQuestions: (doc: Document) => HomeworkQuestion[] & { total?: number; truncated?: boolean }
  __hwParseWorks: (doc: Document, href?: string) => Array<{ title: string; status: string; score?: string; due?: string; href?: string }>
  __hwPageOf: (href: string, text: string, questions: unknown[], works: unknown[]) => string
  __hwActions: (doc: Document) => { canSave: boolean; canSubmit: boolean }
  __hwBoxes: (doc: Document) => Element[]
  __hwPickedOf: (box: Element) => string
  __hwFindOption: (box: Element, want: string) => { el: Element; letter: string } | null
}

let parts: HomeworkParserParts = {
  helpers: helpersSrc,
  parse: parseSrc,
  locate: locateSrc,
  capture: captureSrc,
}

export const applyHomeworkParserParts = (next: Partial<HomeworkParserParts>) => {
  parts = {
    helpers: next.helpers ?? parts.helpers,
    parse: next.parse ?? parts.parse,
    locate: next.locate ?? parts.locate,
    capture: next.capture ?? parts.capture,
  }
}

export const homeworkParseSource = () => joinParts(parts.helpers, parts.parse)

export const homeworkLocateSource = () => joinParts(parts.helpers, parts.locate)

export const homeworkParseApi = (): HomeworkParseApi => (
  evalLocalApi(homeworkParseSource(), [
    '__hwParseQuestions', '__hwParseWorks', '__hwPageOf', '__hwActions', '__hwBoxes', '__hwPickedOf', '__hwFindOption',
  ])
)

const locatePage = (body: string) => pageScript(homeworkLocateSource(), body)

/** 返回 capture 函数本身，调用方再 `(index)`。 */
export const homeworkCaptureScript = () => pageScript(joinParts(parts.helpers, parts.capture), 'return capture;')

export const homeworkLocateScript = (handle: ParserHandle) => (
  locatePage(`return locate(${JSON.stringify(handle)});`)
)

export const homeworkInvokeScript = (handle: ParserHandle) => (
  locatePage(`return invoke(${JSON.stringify(handle)});`)
)

export const homeworkReadDomScript = () => locatePage('return readDom();')
export const homeworkReadLiveScript = () => locatePage('return readLive();')
export const homeworkProbeScript = () => locatePage('return probe();')
export const homeworkReadFillStateScript = () => locatePage('return readFillState();')
export const homeworkReadPickedScript = (index: number) => locatePage(`return readPicked(${Number(index) || 1});`)
export const homeworkDebugBoxScript = (index: number) => locatePage(`return debugBox(${Number(index) || 1});`)

bindReadScript('homework', homeworkReadDomScript)

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (typeof window === 'undefined' || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    window.setTimeout(() => {
      void import('../chaoxing/homework/inspect').then((mod) => mod.retrySelectedHomeworkInspect()).catch(() => undefined)
    }, 300)
  })
}
