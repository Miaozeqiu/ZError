import ts from 'typescript'
import { staticServiceCycles } from '../../scripts/architecture-graph.mjs'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const agentRoot = join(process.cwd(), 'src/services/agent')
const engineRoot = join(process.cwd(), 'src/services/browser/engine')
const servicesRoot = join(process.cwd(), 'src/services')

const walk = (dir: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('agent 层边界', () => {
  it('新网站运行器不直接依赖旧站点脚本或平台业务实现', () => {
    const hits: string[] = []
    for (const file of walk(join(agentRoot, 'websiteRuntime'))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
        if (specifier && ts.isStringLiteral(specifier)
          && /(?:websiteScripts|legacyWebsiteTools|\/platform\/|\/chaoxing\/|\/zjooc\/)/.test(specifier.text)) hits.push(file)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(hits).toEqual([])
  })
  it('service runtime imports contain no static dependency cycle', () => {
    expect(staticServiceCycles()).toEqual([])
  })

  it('generic tool dispatch and core contracts do not import concrete site implementations', () => {
    const generic = [
      ...walk(join(agentRoot, 'core')),
      ...['browserTools.ts', 'hostCapabilities.ts', 'tools/nav.ts', 'tools/act.ts', 'tools/page.ts', 'tools/course.ts']
        .map(file => join(agentRoot, file)),
    ]
    const hits: string[] = []
    for (const file of generic) {
      const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
        if (specifier && ts.isStringLiteral(specifier) && /(?:chaoxing|zjooc)\//.test(specifier.text)) hits.push(file)
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(hits).toEqual([])
  })

  it('engine 不含学习通业务字符串', () => {
    const hits: string[] = []
    for (const file of walk(engineRoot)) {
      const text = readFileSync(file, 'utf8')
      if (/pageHeader|我学的课|studentcourse|chaoxing/i.test(text)) hits.push(file)
    }
    expect(hits).toEqual([])
  })

  it('只有 protocol.ts 走 browser_protocol，不再 invoke browser_cdp_*', () => {
    const protocolHits: string[] = []
    const cdpHits: string[] = []
    for (const file of walk(servicesRoot)) {
      const text = readFileSync(file, 'utf8')
      const sourcePath = '/' + relative(process.cwd(), file).split(sep).join('/')
      if (text.includes("invoke('browser_protocol'")) protocolHits.push(sourcePath)
      if (/invoke\(['"]browser_cdp_/.test(text)) cdpHits.push(sourcePath)
    }
    expect(cdpHits).toEqual([])
    expect(protocolHits).toEqual(['/src/services/browser/protocol.ts'])
  })
})
