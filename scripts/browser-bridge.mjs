#!/usr/bin/env node
/** 软件外 Agent CLI：node scripts/browser-bridge.mjs <action> [--id] [--url] ... */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const inbox = resolve(root, 'public/__agent-inbox.json')
const resultFiles = [
  resolve(root, 'logs/agent-chat/bridge-result.json'),
  resolve(root, 'logs/agent-chat/bridge-result.txt'),
]
const BASE = process.env.ZERROR_AGENT_BRIDGE || 'http://127.0.0.1:1429'

const raw = process.argv.slice(2)
const args = {}
const leftover = []
for (let i = 0; i < raw.length; i += 1) {
  const token = raw[i]
  if (!token.startsWith('--')) {
    leftover.push(token)
    continue
  }
  const key = token.slice(2)
  const next = raw[i + 1]
  if (next && !next.startsWith('--')) {
    args[key === 'id' ? 'browserId' : key] = next
    i += 1
    continue
  }
  args[key] = true
}

const action = leftover[0] || 'help'
const rest = leftover.slice(1)
if (action === 'goto' || action === 'navigate') args.url = args.url || rest.join(' ')
else if (action === 'click_text' || action === 'click' || action === 'send' || action === 'prompt') {
  args.text = args.text || rest.join(' ')
}
else if (action === 'eval') args.script = args.script || rest.join(' ')
else if (action === 'type' || action === 'fill') {
  args.text = args.text || rest.join(' ')
}
else if (action === 'chapter_open') args.title = args.title || rest.join(' ')
else if (action === 'press') args.key = args.key || rest[0]
else if (action === 'captcha') args.code = args.code || rest[0]
else if (action === 'homework') args.action = args.action || rest[0] || 'inspect'
else if (action === 'wait' && rest[0] && !args.ms) args.ms = rest[0]
else if (rest[0] && !args.browserId && !args.url) args.browserId = rest[0]

const send = async (path, init) => {
  try {
    const res = await fetch(`${BASE}${path}`, init)
    if (res.status === 204) return null
    const type = res.headers.get('content-type') || ''
    if (type.includes('json')) return res.json()
    return res.text()
  } catch {
    return null
  }
}

const print = (out) => {
  if (!out || typeof out !== 'object') {
    console.log(out == null ? '' : String(out))
    return
  }
  const { image: _i, ...restOut } = out
  console.log(JSON.stringify(restOut, null, 2))
  if (out.image) console.log(`截图: data URL ${String(out.image).length} 字`)
}

if (action === 'live') {
  const out = await send('/live')
  print(out && Object.keys(out).length ? out : { error: '还没有实时数据' })
  process.exit(0)
}

if (action === 'help') {
  const remote = await send('/help')
  print(remote || { error: '桥没起来。先 npm run tauri:dev' })
  process.exit(0)
}

if (action === 'cdp') {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [new URL('./cef-live.mjs', import.meta.url).pathname], { stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 1))
  await new Promise(() => {})
}

const rpc = await send('/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, args }),
})
if (rpc && typeof rpc === 'object' && (rpc.ok != null || rpc.action || rpc.error)) {
  print(rpc)
  process.exit(rpc.ok === false && rpc.error?.includes('桥超时') ? 1 : 0)
}

const id = `cli-${Date.now()}`
const payload = { id, action, args }
mkdirSync(dirname(inbox), { recursive: true })
writeFileSync(inbox, `${JSON.stringify(payload)}\n`)
await send('/cmd', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

const readResultFile = () => {
  for (const file of resultFiles) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // 试下一个
    }
  }
  return null
}

let out = null
for (let i = 0; i < 50; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  const file = readResultFile()
  if (file && file.id === id) {
    out = file
    break
  }
  const remote = await send(`/result?id=${encodeURIComponent(id)}`)
  if (remote && remote.id === id) {
    out = remote
    break
  }
}
if (!out || out.id !== id) {
  console.error('桥超时：应用没接到命令。请切到「浏览」页等一秒再试。')
  process.exit(1)
}
print(out)
