import { parseFileList } from '../parser/runtime'

export type ParserPackageId = string

export type ParserPackage = {
  id: ParserPackageId
  dir: string
  legacy?: string
  files: string[]
  title: string
}

export const PARSER_PACKAGES: Record<string, ParserPackage> = {
  study: {
    id: 'study',
    dir: 'parsers/study',
    legacy: 'parsers/study.js',
    files: ['helpers.js', 'catalog.js', 'locate.js'],
    title: '刷课',
  },
  homework: {
    id: 'homework',
    dir: 'parsers/homework',
    legacy: 'parsers/homework.js',
    files: ['helpers.js', 'parse.js', 'locate.js', 'capture.js'],
    title: '作业',
  },
}

export const parserPackageOf = (path: string): ParserPackage | null => {
  const normalized = String(path || '').replace(/\\/g, '/')
  for (const pack of Object.values(PARSER_PACKAGES)) {
    if (normalized === pack.legacy || normalized === pack.dir || normalized.startsWith(`${pack.dir}/`)) return pack
  }
  const match = normalized.match(/^(parsers\/[^/]+)/)
  if (!match) return null
  const dir = match[1]
  const id = dir.slice('parsers/'.length)
  return { id, dir, files: ['helpers.js', 'parse.js', 'locate.js'], title: id }
}

export const parseParserFileList = parseFileList

/** 只拼源文件。index.js 不再是可执行入口。 */
export const assembleParserSource = (_index: string, partSources: string[]) => (
  partSources.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
)
