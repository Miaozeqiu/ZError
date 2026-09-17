#!/usr/bin/env node
/** 软件外 Agent → 应用内浏览器 / 解析器。只绑 127.0.0.1。 */
import http from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.ZERROR_AGENT_BRIDGE_PORT || 1429)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const liveFile = resolve(root, 'logs/agent-chat/browser-live.md')

const cmds = []
const results = new Map()
let lastResult = null
let live = null

const HELP = {
  ok: true,
  endpoint: `http://127.0.0.1:${PORT}/rpc`,
  hint: 'POST /rpc { action, args }。应用须在 Tauri 窗口打开浏览页。',
  actions: [
    { name: 'help', group: 'meta' },
    { name: 'list', group: 'meta' },
    { name: 'state', group: 'meta', hint: '当前页 + 章节解析器全文' },
    { name: 'goto', group: 'browser', args: 'url' },
    { name: 'reload', group: 'browser' },
    { name: 'back', group: 'browser' },
    { name: 'forward', group: 'browser' },
    { name: 'click', group: 'browser', args: 'selector | text' },
    { name: 'click_text', group: 'browser', args: 'text' },
    { name: 'type', group: 'browser', args: 'selector, text' },
    { name: 'hover', group: 'browser', args: 'selector | text' },
    { name: 'press', group: 'browser', args: 'key' },
    { name: 'scroll', group: 'browser', args: 'amount' },
    { name: 'wait', group: 'browser', args: 'ms | selector | text | url' },
    { name: 'screenshot', group: 'browser' },
    { name: 'snapshot', group: 'browser', hint: '无障碍快照，类似 Playwright' },
    { name: 'eval', group: 'browser', args: 'script' },
    { name: 'chapter', group: 'parser', hint: '完整目录 + 本节任务点' },
    { name: 'chapter_open', group: 'parser', args: 'title | index | chapterId' },
    { name: 'play', group: 'parser', args: 'videoIndex | label | title' },
    { name: 'pause', group: 'parser' },
    { name: 'next', group: 'parser' },
    { name: 'probe', group: 'parser' },
    { name: 'inspect', group: 'parser' },
    { name: 'homework', group: 'parser', args: 'action, title?, answers?' },
    { name: 'captcha', group: 'parser', args: 'code' },
  ],
}

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const readBody = (req) => new Promise((done) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw.trim()) {
      done({})
      return
    }
    try {
      done(JSON.parse(raw))
    } catch {
      done({ raw })
    }
  })
})

const sendJson = (res, code, body) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const writeLiveFile = (row) => {
  try {
    mkdirSync(dirname(liveFile), { recursive: true })
    writeFileSync(liveFile, [
      '# 浏览器实时',
      `ts: ${row.ts || new Date().toISOString()}`,
      `browserId: ${row.browserId || ''}`,
      `url: ${row.url || ''}`,
      `title: ${row.title || ''}`,
      '',
      row.lastText || '',
      '',
    ].join('\n'))
  } catch {
    // 写日志失败不挡桥
  }
}

const pathOf = (req) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  return { path: url.pathname.replace(/^\/__agent-bridge/, '') || '/', query: url.searchParams }
}

const rememberResult = (body) => {
  lastResult = body
  if (body?.id) {
    results.set(String(body.id), body)
    if (results.size > 40) {
      const first = results.keys().next().value
      if (first) results.delete(first)
    }
  }
}

const waitResult = (id, timeoutMs) => new Promise((resolve, reject) => {
  const started = Date.now()
  const tick = () => {
    const hit = results.get(id)
    if (hit) {
      results.delete(id)
      resolve(hit)
      return
    }
    if (Date.now() - started >= timeoutMs) {
      reject(new Error('桥超时：应用没接到命令。打开 Tauri 窗口的浏览页再试。'))
      return
    }
    setTimeout(tick, 50)
  }
  tick()
})

const queueCmd = (body) => {
  const id = String(body.id || `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  const cmd = { id, action: String(body.action || 'help'), args: body.args || {} }
  cmds.push(cmd)
  return cmd
}

const server = http.createServer(async (req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const { path, query } = pathOf(req)
  try {
    if ((path === '/help' || path === '/') && req.method === 'GET') {
      sendJson(res, 200, HELP)
      return
    }
    if (path === '/rpc' && req.method === 'POST') {
      const body = await readBody(req)
      if (body.action === 'help' || !body.action) {
        sendJson(res, 200, HELP)
        return
      }
      const cmd = queueCmd(body)
      const timeout = Number(body.timeoutMs) || (/screenshot|chapter_open|play|next|goto/.test(cmd.action) ? 45_000 : 20_000)
      try {
        sendJson(res, 200, await waitResult(cmd.id, timeout))
      } catch (error) {
        sendJson(res, 504, { ok: false, id: cmd.id, action: cmd.action, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (path === '/cmd' && req.method === 'POST') {
      const body = await readBody(req)
      if (body?.id) cmds.push(body)
      res.statusCode = 204
      res.end()
      return
    }
    if (path === '/cmd' && req.method === 'GET') {
      const cmd = cmds.shift()
      if (!cmd) {
        res.statusCode = 204
        res.end()
        return
      }
      sendJson(res, 200, cmd)
      return
    }
    if (path === '/result' && req.method === 'POST') {
      rememberResult(await readBody(req))
      res.statusCode = 204
      res.end()
      return
    }
    if (path === '/result' && req.method === 'GET') {
      const want = query.get('id')
      const hit = want ? results.get(want) : lastResult
      if (!hit) {
        res.statusCode = 204
        res.end()
        return
      }
      sendJson(res, 200, hit)
      return
    }
    if (path === '/live' && req.method === 'POST') {
      live = { ...(await readBody(req)), ts: new Date().toISOString() }
      writeLiveFile(live)
      res.statusCode = 204
      res.end()
      return
    }
    if (path === '/live' && req.method === 'GET') {
      sendJson(res, 200, live || {})
      return
    }
    res.statusCode = 404
    res.end('not found')
  } catch (error) {
    res.statusCode = 500
    res.end(error instanceof Error ? error.message : String(error))
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`[agent-bridge] 127.0.0.1:${PORT} 已在跑`)
    process.exit(0)
  }
  console.error('[agent-bridge]', err)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-bridge] http://127.0.0.1:${PORT}/rpc  外接 Agent 入口`)
})
