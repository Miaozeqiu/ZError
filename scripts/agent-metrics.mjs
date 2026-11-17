#!/usr/bin/env node
/** 从 logs/agent-chat 统计浏览器 Agent：轮数、工具失败、重复失败、结局。 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentMetrics, finishAgentMetrics, noteAgentRow } from './agent-metrics-core.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'logs/agent-chat')
const files = readdirSync(dir).filter((name) => name.endsWith('-model-io.jsonl') || name.startsWith('browser-') && name.endsWith('.jsonl'))

const sessions = new Map()
const toolFails = new Map()
let guardHits = 0
let missingTools = 0
const repeat = new Map()

const known = new Set([
  'browser_get_state', 'browser_site_graph', 'browser_get_page', 'browser_find',
  'browser_navigate', 'browser_reload', 'browser_go_back', 'browser_go_forward',
  'browser_click', 'browser_click_text', 'browser_type', 'browser_scroll',
  'browser_eval', 'browser_screenshot', 'browser_watch', 'browser_wait',
  'browser_todo', 'browser_task', 'browser_finish', 'browser_course_plan',
])

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1)
const agentMetrics = createAgentMetrics()

for (const name of files) {
  const lines = readFileSync(resolve(dir, name), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    let row
    try { row = JSON.parse(line) } catch { continue }
    noteAgentRow(agentMetrics, row, name)
    const id = String(row.sessionId || row.session || name)
    const bucket = sessions.get(id) || { rounds: 0, outcome: '', firstPlayRound: 0 }
    if (row.kind === 'model_request') bucket.rounds += 1
    const calls = row.toolCalls || row.tool_calls || []
    for (const call of calls) {
      const tool = String(call.name || '')
      if (tool.startsWith('browser_') && !known.has(tool)) {
        missingTools += 1
        bump(toolFails, `${tool}:missing`)
      }
    }
    const text = JSON.stringify(row)
    if (/当前页 eval 只读|不要用页面脚本|已有解析卡/.test(text)) guardHits += 1
    if (/ok"\s*:\s*false|ok":false|"error"/.test(text) && row.kind === 'model_request') {
      const tool = text.match(/browser_[a-z0-9_]+/)?.[0]
      if (tool) bump(toolFails, tool)
    }
    if (row.kind === 'model_response') {
      const args = JSON.stringify(calls)
      const key = `${id}:${args}`
      if (args.includes('browser_') && repeat.has(key)) bump(repeat, 'dup')
      repeat.set(key, true)
    }
    if (/finish\(done\)|"status":"done"|status=done/.test(text)) bucket.outcome = 'done'
    else if (/blocked/.test(text) && !bucket.outcome) bucket.outcome = 'blocked'
    else if (/已终止|AbortError|对话中断/.test(text)) bucket.outcome = bucket.outcome || 'terminated'
    if (!bucket.firstPlayRound && /正在播|playing":true|"paused":false/.test(text)) {
      bucket.firstPlayRound = bucket.rounds
    }
    sessions.set(id, bucket)
  }
}

const outcomes = { done: 0, blocked: 0, terminated: 0, open: 0 }
for (const bucket of sessions.values()) outcomes[bucket.outcome || 'open'] += 1
const report = {
  files: files.length,
  sessions: sessions.size,
  ...finishAgentMetrics(agentMetrics),
  outcomes,
  missingToolCalls: missingTools,
  guardHits,
  toolFails: Object.fromEntries([...toolFails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
  rounds: [...sessions.values()].map((item) => item.rounds).sort((a, b) => a - b),
}
console.log(JSON.stringify(report, null, 2))
