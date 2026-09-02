import { parse } from 'acorn'
import type { Node } from 'acorn'

type AcornNode = Node & {
  type: string
  start: number
  end: number
  name?: string
  id?: AcornNode | null
  body?: AcornNode | AcornNode[]
  expression?: AcornNode
}

const WRAP = 1
const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g

const asList = (node: AcornNode | AcornNode[] | undefined): AcornNode[] => (
  Array.isArray(node) ? node : []
)

const identName = (node?: AcornNode | null) => {
  if (!node) return ''
  if (node.type === 'Identifier') return String(node.name || '')
  return ''
}

const parseParserFn = (source: string): AcornNode | null => {
  const text = String(source || '').replace(/^\uFEFF/, '')
  if (!text.trim()) return null
  try {
    const ast = parse(`(${text})`, { ecmaVersion: 2022, sourceType: 'script' }) as AcornNode
    const expr = asList(ast.body)[0]?.expression
    if (!expr) return null
    if (expr.type === 'FunctionExpression' || expr.type === 'ArrowFunctionExpression') return expr
    return null
  } catch {
    return null
  }
}

export type ParserPackageId = 'study' | 'homework'

export type ParserPackage = {
  id: ParserPackageId
  dir: string
  legacy: string
  files: string[]
  title: string
}

export const PARSER_PACKAGES: Record<ParserPackageId, ParserPackage> = {
  study: {
    id: 'study',
    dir: 'parsers/study',
    legacy: 'parsers/study.js',
    files: ['frames.js', 'catalog.js', 'video.js', 'chapter.js', 'play.js', 'watch.js', 'captcha.js'],
    title: '刷课',
  },
  homework: {
    id: 'homework',
    dir: 'parsers/homework',
    legacy: 'parsers/homework.js',
    files: ['frames.js', 'parse.js', 'inspect.js', 'live.js', 'capture.js', 'answer.js'],
    title: '作业',
  },
}

export const parserPackageOf = (path: string): ParserPackage | null => {
  const normalized = String(path || '').replace(/\\/g, '/')
  for (const pack of Object.values(PARSER_PACKAGES)) {
    if (normalized === pack.legacy || normalized === pack.dir || normalized.startsWith(`${pack.dir}/`)) return pack
  }
  return null
}

export const parseParserFileList = (index: string, fallback: string[]) => {
  const match = String(index || '').match(/^\/\/\s*files:\s*(.+)$/m)
  if (!match) return fallback
  return match[1].split(',').map((item) => item.trim()).filter((item) => item.endsWith('.js') && item !== 'index.js')
}

export const assembleParserSource = (index: string, partSources: string[]) => {
  const text = String(index || '').replace(/^\uFEFF/, '')
  const fn = parseParserFn(text)
  const body = fn?.body
  if (!fn || !body || body.type !== 'BlockStatement') {
    throw new Error('index.js 必须是 function (page) { ... }')
  }
  const innerStart = body.start - WRAP + 1
  const prelude = partSources.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
  return `${text.slice(0, innerStart)}\n${prelude ? `${prelude}\n` : ''}${text.slice(innerStart)}`
}

/** 拼装后模块里的全部 function 声明，供 page() 按引用注入。 */
export const collectAssembledFns = (source: string): Map<string, string> => {
  const out = new Map<string, string>()
  const text = String(source || '').replace(/^\uFEFF/, '')
  const fn = parseParserFn(text)
  const body = fn?.body && fn.body.type === 'BlockStatement' ? asList(fn.body.body) : []
  for (const stmt of body) {
    if (stmt.type !== 'FunctionDeclaration') continue
    const name = identName(stmt.id)
    if (name) out.set(name, text.slice(stmt.start - WRAP, stmt.end - WRAP))
  }
  return out
}

/** 从入口函数源码收集它（及传递）用到的同模块函数名，不含自身。 */
export const inferPageHelperNames = (fnSource: string, pool: Map<string, string>, selfName = '') => {
  const seen = new Set<string>()
  if (selfName) seen.add(selfName)
  const names: string[] = []
  const queue = [String(fnSource || '')]
  while (queue.length) {
    const src = queue.shift() || ''
    const hits = src.match(IDENT_RE) || []
    for (const name of hits) {
      if (seen.has(name) || !pool.has(name)) continue
      seen.add(name)
      names.push(name)
      queue.push(pool.get(name) || '')
    }
  }
  return names
}
