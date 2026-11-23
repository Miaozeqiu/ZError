import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mermaidParser } from '../../scripts/vite/mermaidParser'

const fixtures: Record<string, string> = {
  info: 'info', packet: 'packet-beta\n0-7: "Header"', pie: 'pie\n"A": 1',
  treeView: 'treeView-beta\nroot\n    child', architecture: 'architecture-beta\nservice api(server)[API]',
  gitGraph: 'gitGraph\ncommit', eventmodeling: 'eventmodeling\ntf 01 cmd Save',
  radar: 'radar-beta', railroad: 'railroad-beta\nroot = terminal("a");',
  railroadEbnf: 'railroad-ebnf-beta\nroot = "a";', railroadAbnf: 'railroad-abnf-beta\nroot = "a";',
  railroadPeg: 'railroad-peg-beta\nroot <- "a";', treemap: 'treemap-beta', wardley: 'wardley-beta', cynefin: 'cynefin-beta',
}
const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$') || key === '$type')
      .map(([key, item]) => [key, normalize(item)]))
    : value
let temporary: string
let original: { parse: (type: string, text: string) => Promise<unknown> }
let split: typeof original

beforeAll(async () => {
  const directory = resolve('node_modules/@mermaid-js/parser/dist')
  temporary = mkdtempSync(join(tmpdir(), 'zerror-mermaid-'))
  cpSync(directory, temporary, { recursive: true, filter: path => statSync(path).isDirectory() || path.endsWith('.mjs') })
  const chunkDirectory = join(directory, 'chunks/mermaid-parser.core')
  const runtimePath = readdirSync(chunkDirectory).map(name => join(chunkDirectory, name))
    .find(path => path.endsWith('.mjs') && readFileSync(path, 'utf8').includes('function loadGrammarFromJson('))!
  const plugin = mermaidParser()
  const runtime = (plugin.transform as Function)(readFileSync(runtimePath, 'utf8'), runtimePath).code as string
  const target = join(temporary, relative(directory, runtimePath))
  for (const [id, file] of [['protocol', '__zerror-protocol.mjs'], ['grammars', '__zerror-grammars.mjs']]) {
    writeFileSync(join(dirname(target), file), (plugin.load as Function)('\0virtual:zerror-mermaid-' + id))
  }
  writeFileSync(target, runtime.replaceAll('virtual:zerror-mermaid-protocol', './__zerror-protocol.mjs')
    .replaceAll('virtual:zerror-mermaid-grammars', './__zerror-grammars.mjs'))
  original = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'mermaid-parser.core.mjs')).href)
  split = await import(/* @vite-ignore */ pathToFileURL(join(temporary, 'mermaid-parser.core.mjs')).href)
})
afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }) })

describe('published Mermaid parser module splitting', () => {
  for (const [type, text] of Object.entries(fixtures)) {
    it('preserves the ' + type + ' syntax tree and parse errors', async () => {
      expect(normalize(await split.parse(type, text))).toEqual(normalize(await original.parse(type, text)))
      const failure = async (parser: typeof original) => {
        try { await parser.parse(type, 'this is not a diagram'); throw new Error('Unexpected parse success') }
        catch (error) { return (error as Error).message }
      }
      const expected = await failure(original)
      expect(expected).not.toBe('Unexpected parse success')
      expect(await failure(split)).toBe(expected)
    })
  }
})
