/** 读和做共用的页面实体。Agent 只看见题号/节名，内部用 Handle 去 locate。 */

export type ParserHandle =
  | { kind: 'question'; index: number }
  | { kind: 'option'; index: number; letter: string }
  | { kind: 'blank'; index: number; slot?: number }
  | { kind: 'work'; title: string }
  | { kind: 'chapter'; title?: string; chapterId?: string }
  | { kind: 'step'; label?: string; mid?: string; jobid?: string; videoIndex?: number; index?: number }
  | { kind: 'control'; name: ParserControlName }

export type ParserControlName =
  | 'save'
  | 'submit'
  | 'confirm'
  | 'play'
  | 'video-tab'
  | 'chapter-tab'
  | 'next'
  | 'homework-tab'

export type SiteCard = {
  ok: boolean
  page: string
  next?: string
  confidence?: number
  handles?: ParserHandle[]
  error?: string
  hint?: string
  url?: string
  title?: string
}

export type SiteParser = {
  parse: (doc: Document, href?: string) => SiteCard
  locate?: (handle: ParserHandle) => { found: boolean; x?: number; y?: number; text?: string }
  invoke?: (handle: ParserHandle) => { ok: boolean; via?: string; text?: string; error?: string }
}
