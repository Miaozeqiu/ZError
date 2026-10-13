import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
  it('不直接 import chaoxing/browser 或 chaoxing/study', () => {
    const allowed = new Set([
      'bridgeApi.ts',
      'chatLoop.ts',
      'chatWatch.ts',
      'finishGate.ts',
      'task.ts',
      'page.ts',
    ])
    const hits: string[] = []
    for (const file of walk(agentRoot)) {
      const text = readFileSync(file, 'utf8')
      const name = file.split('/').pop() || ''
      if (allowed.has(name)) continue
      if (/from ['"][^'"]*chaoxing\/(browser|study)/.test(text)) hits.push(file)
      if (/import\(['"][^'"]*chaoxing\/(browser|study)/.test(text)) hits.push(file)
    }
    expect(hits).toEqual([])
  })

  it('通用浏览器工具不直接 import 学习通', () => {
    const tools = join(agentRoot, 'tools')
    const hits: string[] = []
    for (const name of ['nav.ts', 'act.ts']) {
      const text = readFileSync(join(tools, name), 'utf8')
      if (/platform\/chaoxing\//.test(text)) hits.push(name)
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
      if (text.includes("invoke('browser_protocol'")) protocolHits.push(file.replace(process.cwd(), ''))
      if (/invoke\(['"]browser_cdp_/.test(text)) cdpHits.push(file.replace(process.cwd(), ''))
    }
    expect(cdpHits).toEqual([])
    expect(protocolHits).toEqual(['/src/services/browser/protocol.ts'])
  })
})
