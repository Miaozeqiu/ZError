import { parse } from 'acorn'

// This is an effect classification, not a security sandbox. Unknown syntax or
// calls retain the mutation journal; passing the page's eval policy is separate.
type Syntax = { type: string; [key: string]: any }
const domReads = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName', 'getAttribute', 'hasAttribute', 'getBoundingClientRect'])
const forbiddenProperties = new Set(['constructor', '__proto__', 'prototype'])
const property = (node: Syntax) => node.computed
  ? node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : ''
  : node.property.name

/** Only positively recognised read expressions are exempt from the journal. */
export const isReadOnlyBrowserScript = (script: string): boolean => {
  if (!script.trim() || script.length > 20_000) return false
  try {
    const root = parse(script, { ecmaVersion: 'latest' }) as unknown as Syntax
    const dom = (node: Syntax): boolean => {
      if (node.type === 'ChainExpression') return dom(node.expression)
      if (node.type === 'Identifier') return node.name === 'document'
      if (node.type === 'MemberExpression') return dom(node.object) && ['body', 'head', 'documentElement', 'parentElement', 'firstElementChild', 'nextElementSibling', 'ownerDocument'].includes(property(node))
      return node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && dom(node.callee.object) && domReads.has(property(node.callee))
    }
    const safe = (node: Syntax, locals: Set<string>, inFunction = false): boolean => {
      if (!node) return true
      const child = (value: Syntax) => safe(value, locals, inFunction)
      switch (node.type) {
        case 'Program': case 'BlockStatement': {
          const scope = new Set(locals)
          return node.body.every((item: Syntax) => safe(item, scope, inFunction))
        }
        case 'ExpressionStatement': return child(node.expression)
        case 'ReturnStatement': return child(node.argument)
        case 'Literal': return true
        case 'Identifier': return locals.has(node.name) || ['document', 'window', 'undefined', 'NaN', 'Infinity'].includes(node.name)
        case 'VariableDeclaration': return inFunction && node.declarations.every((item: Syntax) => {
          if (item.id.type !== 'Identifier' || ['document', 'window', 'undefined', 'NaN', 'Infinity'].includes(item.id.name) || !child(item.init)) return false
          locals.add(item.id.name); return true
        })
        case 'ChainExpression': return child(node.expression)
        case 'MemberExpression': return child(node.object) && Boolean(property(node)) && !forbiddenProperties.has(property(node))
        case 'UnaryExpression': return node.operator !== 'delete' && child(node.argument)
        case 'BinaryExpression': case 'LogicalExpression': return child(node.left) && child(node.right)
        case 'ConditionalExpression': return child(node.test) && child(node.consequent) && child(node.alternate)
        case 'ArrayExpression': return node.elements.every(child)
        case 'ObjectExpression': return node.properties.every((item: Syntax) => item.type === 'Property' && item.kind === 'init' && !item.computed && !item.method && child(item.value))
        case 'TemplateLiteral': return node.expressions.every(child)
        case 'CallExpression': {
          if (!node.arguments.every(child)) return false
          const callee = node.callee
          if (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') {
            return !callee.async && !callee.generator && !callee.id && callee.params.length === 0 && safe(callee.body, new Set(locals), true)
          }
          // Only actual document-rooted DOM reads. Arbitrary objects with the
          // same method names, aliases, computed calls and callbacks are unknown.
          return callee.type === 'MemberExpression' && dom(callee.object)
            && domReads.has(property(callee)) && child(callee.object)
        }
        default: return false
      }
    }
    return safe(root, new Set())
  } catch { return false }
}
