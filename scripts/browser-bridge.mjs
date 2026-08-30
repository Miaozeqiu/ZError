#!/usr/bin/env node
const BASE = 'http://localhost:1420/__agent-bridge'
const raw = process.argv.slice(2)
const args = {}
const leftover = []
for (let i = 0; i < raw.length; i += 1) {
  if (raw[i] === '--id' && raw[i + 1]) {
    args.browserId = raw[++i]
    continue
  }
  leftover.push(raw[i])
}
const action = leftover[0] || 'snapshot'
const rest = leftover.slice(1)
if (action === 'click_text' || action === 'click' || action === 'send' || action === 'prompt') args.text = rest.join(' ')
else if (action === 'eval') args.script = rest.join(' ')
else if (rest[0] && !args.browserId) args.browserId = rest[0]

const id = `cli-${Date.now()}`
const send = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, init)
  if (res.status === 204) return null
  const type = res.headers.get('content-type') || ''
  if (type.includes('json')) return res.json()
  return res.text()
}

const cmd = action === 'click' ? 'click_text' : action
await send('/cmd', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, action: cmd, args }),
})

let out = null
for (let i = 0; i < 40; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  out = await send('/result')
  if (out && out.id === id) break
}
if (!out || out.id !== id) {
  console.error('桥超时：应用没接到命令。确认 tauri:dev 开着，并且在哪浏览器页。')
  process.exit(1)
}
const { image: _i, ...restOut } = out
console.log(JSON.stringify(restOut, null, 2))
if (out.image) console.log(`截图: ${out.image}`)
