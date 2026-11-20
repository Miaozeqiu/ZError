import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { normalizePath, type Plugin } from 'vite'

const moduleId = 'virtual:zerror-d2-assets'
const resolvedId = '\0' + moduleId

/** Keep D2's embedded payloads out of JavaScript parsing and minification. */
export function d2Assets(): Plugin {
  const runtimePath = normalizePath(resolve('node_modules/@terrastruct/d2/dist/browser/index.js'))
  const source = readFileSync(runtimePath, 'utf8')
  const ast = ts.createSourceFile(runtimePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const payloads: Array<{ start: number; end: number; text: string }> = []
  function collect(node: ts.Node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.length > 20_000) {
      payloads.push({ start: node.getStart(ast), end: node.end, text: node.text })
    }
    ts.forEachChild(node, collect)
  }
  collect(ast)
  let production = false

  return {
    name: 'd2-payload-assets',
    enforce: 'pre',
    configResolved(config) {
      production = config.command === 'build'
    },
    resolveId(id) {
      if (id === moduleId) return resolvedId
    },
    load(id) {
      if (id !== resolvedId) return
      if (!production) {
        return 'export const payloads = ' + JSON.stringify(payloads.map(item => item.text))
          + '; export async function prepareD2Assets() {}'
      }
      const urls = payloads.map((payload, index) => {
        const reference = this.emitFile({
          type: 'asset', name: 'd2-payload-' + index + '.txt', source: payload.text,
        })
        return 'import.meta.ROLLUP_FILE_URL_' + reference
      })
      return `
export const payloads = [];
let pending;
export function prepareD2Assets() {
  pending ||= Promise.all([${urls.join(',')}].map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('D2 resource request failed (' + response.status + ')');
    return response.text();
  })).then(values => { payloads.splice(0, payloads.length, ...values); })
    .catch(error => { pending = undefined; throw error; });
  return pending;
}`
    },
    transform(code, id) {
      if (id.split('?')[0] !== runtimePath) return
      // D2's public API remains intact. Its configured loader prepares these
      // payloads before evaluating the runtime, including its worker source.
      let result = code
      for (let index = payloads.length - 1; index >= 0; index--) {
        const payload = payloads[index]
        result = result.slice(0, payload.start) + 'd2Payloads[' + index + ']' + result.slice(payload.end)
      }
      return { code: 'import { payloads as d2Payloads } from "' + moduleId + '";\n' + result, map: null }
    },
  }
}
