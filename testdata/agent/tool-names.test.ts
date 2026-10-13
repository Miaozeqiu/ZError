import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROWSER_PRIMITIVE_TOOLS } from '../../src/services/agent/toolDefs/browserPrimitiveTools'

const src = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../src')
const roots = [
  resolve(src, 'services/agent'),
  resolve(src, 'services/chaoxing'),
  resolve(src, 'services/platform'),
]
const skip = new Set(['activity.ts', 'agentIcons.ts'])

const walk = (dir: string, out: string[] = []) => {
  for (const name of readdirSync(dir)) {
    if (skip.has(name) || name === 'node_modules') continue
    const path = resolve(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|vue|js|md)$/.test(name)) out.push(path)
  }
  return out
}

describe('browser tool names', () => {
  it('模型能看见的 browser_* 都是已注册工具', () => {
    const registered = new Set(
      BROWSER_PRIMITIVE_TOOLS.map((tool) => tool.function.name),
    )
    const allow = new Set([
      'browser_id',
      'browser_protocol',
      'browser_read_agent_skill',
      'browser_read_agent_skill_file',
      'browser_write_agent_skill_file',
      'browser_list_agent_skills',
      'browser_reset_agent_skill_file',
    ])
    const unknown = new Map<string, string>()
    const pattern = /browser_[a-z][a-z0-9_]*/g
    for (const file of roots.flatMap((dir) => walk(dir))) {
      const text = readFileSync(file, 'utf8')
      for (const hit of text.match(pattern) || []) {
        if (hit.endsWith('_')) continue
        if (registered.has(hit) || allow.has(hit)) continue
        if (!unknown.has(hit)) unknown.set(hit, file)
      }
    }
    expect([...unknown.entries()]).toEqual([])
  })
})
