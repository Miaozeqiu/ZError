#!/usr/bin/env node
/** 手动回归：推送 tick / 作业 states / find_wait。不进 vitest。 */
const BASE = process.env.ZERROR_AGENT_BRIDGE || 'http://127.0.0.1:1429'
const playwrightUrl = process.env.PLAYWRIGHT_ENTRY
  || `${process.env.HOME}/.nvm/versions/node/${process.version}/lib/node_modules/playwright/index.mjs`

const rpc = async (action, args = {}, timeoutMs = 20_000) => {
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args, timeoutMs }),
  })
  if (!res.ok) throw new Error(`rpc ${action} ${res.status}`)
  return res.json()
}

const { chromium } = await import(playwrightUrl)
const goto = await rpc('goto', { url: 'http://localhost:1420/e2e/push-fixture.html' }, 45_000)
if (!goto?.ok && !goto?.url) {
  console.error('桥 goto 失败，先开 tauri:dev 和 agent:bridge')
  console.error(goto)
  process.exit(1)
}
const browserId = String(goto.browserId || goto.id || '')

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = browser.contexts().flatMap((ctx) => ctx.pages()).find((item) => /push-fixture/.test(item.url()))
  || browser.contexts().flatMap((ctx) => ctx.pages())[0]
if (!page) {
  console.error('9333 没有 fixture 页')
  process.exit(1)
}

await page.locator('video').click()
await page.locator('.questionLi .answerBg').first().click()
const started = Date.now()
const found = await rpc('protocol', {
  browserId,
  op: 'find_wait',
  locator: { by: 'text', value: '稍后按钮' },
  timeoutMs: 2500,
})
const waitMs = Date.now() - started
const last = await rpc('protocol', { browserId, op: 'push_last' })
const hw = await rpc('protocol', { browserId, op: 'push_last', kind: 'hw' })
await browser.close()

const tickOk = Boolean(last?.ok && last.ageMs < 2000 && (last.tick || last.kind === 'video'))
const hwStates = hw?.states || hw?.tick?.states || []
const hwOk = Array.isArray(hwStates) && hwStates.some((row) => row.selected)
const findOk = Boolean(found?.ok && waitMs <= 400)
const report = { tickOk, hwOk, findOk, waitMs, last, hw, found }
console.log(JSON.stringify(report, null, 2))
if (!tickOk || !hwOk || !findOk) process.exit(1)
