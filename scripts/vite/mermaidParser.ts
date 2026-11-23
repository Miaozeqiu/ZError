import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { normalizePath, type Plugin } from 'vite'

const prefixId = 'virtual:zerror-mermaid-protocol'
const grammarId = 'virtual:zerror-mermaid-grammars'

/** Restore module boundaries flattened by the published parser bundle. */
export function mermaidParser(): Plugin {
  const directory = resolve('node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core')
  const candidates = readdirSync(directory).filter(name => name.endsWith('.mjs')).map(name => {
    const path = normalizePath(resolve(directory, name))
    return { path, source: readFileSync(path, 'utf8') }
  }).filter(item => item.source.includes('function loadGrammarFromJson('))
  if (candidates.length !== 1) throw new Error('Unsupported Mermaid parser layout: expected one grammar runtime')
  const { path, source } = candidates[0]
  const boundary = /^\/\/ .*\/node_modules\/langium\/lib\/index\.js$/m.exec(source)?.index
  if (!boundary) throw new Error('Unsupported Mermaid parser layout: missing protocol boundary')

  const program = ts.createProgram([path], { allowJs: true, noResolve: true, noLib: true })
  const ast = program.getSourceFile(path)!
  const checker = program.getTypeChecker()
  const prefixSymbols = new Set<ts.Symbol>()
  const suffixSymbols = new Set<ts.Symbol>()
  const prefixNames: string[] = []
  const bindingNames = (name: ts.BindingName): ts.Identifier[] => ts.isIdentifier(name)
    ? [name]
    : name.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : [])
  for (const statement of ast.statements) {
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.flatMap(declaration => bindingNames(declaration.name))
      : (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name
        ? [statement.name] : []
    for (const name of names) {
      const symbol = checker.getSymbolAtLocation(name)
      if (!symbol) throw new Error('Unsupported Mermaid parser binding')
      if (statement.end <= boundary) {
        prefixSymbols.add(symbol)
        prefixNames.push(name.text)
      } else suffixSymbols.add(symbol)
    }
  }
  // A dependency from the protocol back into the parser would introduce a cycle.
  const validate = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      if (node.getStart(ast) < boundary && suffixSymbols.has(symbol)) {
        throw new Error('Unsupported Mermaid parser layout: protocol depends on parser')
      }
      const parent = node.parent
      const written = (ts.isBinaryExpression(parent) && parent.left === node
        && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
        || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
          && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken))
      if (node.getStart(ast) >= boundary && prefixSymbols.has(symbol) && written) {
        throw new Error('Unsupported Mermaid parser layout: parser writes a protocol binding')
      }
    }
    ts.forEachChild(node, validate)
  }
  validate(ast)

  const grammars: string[] = []
  const replacements: Array<{ start: number; end: number; index: number }> = []
  const collect = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && node.text.startsWith('{"$type":"Grammar"')) {
      // Check the upstream data contract before replacing a literal.
      if (JSON.parse(node.text).$type !== 'Grammar') throw new Error('Invalid Mermaid grammar')
      replacements.push({ start: node.getStart(ast), end: node.end, index: grammars.length })
      grammars.push(node.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(ast)
  if (!grammars.length) throw new Error('Unsupported Mermaid parser layout: no grammar data')
  let runtime = source
  for (const item of replacements.reverse()) {
    runtime = runtime.slice(0, item.start) + `mermaidGrammars[${item.index}]` + runtime.slice(item.end)
  }
  runtime = `import { ${prefixNames.join(', ')} } from '${prefixId}';\n`
    + `import { grammars as mermaidGrammars } from '${grammarId}';\n` + runtime.slice(boundary)

  return {
    name: 'mermaid-parser-modules',
    enforce: 'pre',
    resolveId(id) {
      if (id === prefixId || id === grammarId) return '\0' + id
    },
    load(id) {
      if (id === '\0' + prefixId) return source.slice(0, boundary) + `\nexport { ${prefixNames.join(', ')} };\n`
      if (id === '\0' + grammarId) return 'export const grammars = ' + JSON.stringify(grammars)
    },
    transform(code, id) {
      if (normalizePath(id.split('?')[0]) !== path) return
      if (code !== source) throw new Error('Mermaid parser changed before module splitting')
      return { code: runtime, map: null }
    },
  }
}
