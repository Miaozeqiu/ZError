#!/usr/bin/env node
/** 连 CEF :9333，把当前页写到 logs/agent-chat/cef-live.md */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const playwrightUrl = process.env.PLAYWRIGHT_ENTRY
  || `${process.env.HOME}/.nvm/versions/node/${process.version}/lib/node_modules/playwright/index.mjs`
const { chromium } = await import(playwrightUrl)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'logs/agent-chat/cef-live.md')
const shot = resolve(root, 'logs/agent-chat/cef-live.png')

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const pages = browser.contexts().flatMap((c) => c.pages())
const page = pages.find((p) => /chaoxing|mooc1|mooc2|passport2/.test(p.url())) || pages[0]
if (!page) {
  console.error('9333 上没有 page')
  process.exit(1)
}

const frames = []
for (const frame of page.frames()) {
  try {
    frames.push(await frame.evaluate(() => ({
      url: location.href,
      title: document.title || '',
      questionLi: document.querySelectorAll('.questionLi, .singleQuesId').length,
      catalogLi: document.querySelectorAll('#coursetree .posCatalog_select, .catalog_title, a.clicktitle').length,
      hasVideo: Boolean(document.querySelector('video')),
      duration: Number(document.querySelector('video')?.duration) || 0,
      current: Number(document.querySelector('video')?.currentTime) || 0,
      paused: Boolean(document.querySelector('video')?.paused),
      text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 400),
    })))
  } catch (error) {
    frames.push({ url: frame.url(), error: String(error).slice(0, 120) })
  }
}

const best = [...frames].sort((a, b) => (
  ((b.questionLi || 0) * 10 + (b.catalogLi || 0) * 8 + (b.hasVideo ? 15 : 0))
  - ((a.questionLi || 0) * 10 + (a.catalogLi || 0) * 8 + (a.hasVideo ? 15 : 0))
))[0] || {}

await page.screenshot({ path: shot }).catch(() => {})
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, [
  '# CEF 实时',
  `ts: ${new Date().toISOString()}`,
  `page: ${page.url()}`,
  `title: ${await page.title().catch(() => '')}`,
  `frames: ${frames.length}`,
  '',
  `questionLi: ${best.questionLi || 0}  catalogLi: ${best.catalogLi || 0}  video: ${best.hasVideo ? `${best.current}/${best.duration} ${best.paused ? 'paused' : 'playing'}` : 'no'}`,
  '',
  best.text || '',
  '',
  '## frames',
  ...frames.map((f, i) => `${i}. q=${f.questionLi || 0} cat=${f.catalogLi || 0} v=${f.hasVideo ? 1 : 0} ${String(f.url || '').slice(0, 120)}`),
  '',
].join('\n'))

const summary = {
  url: page.url(),
  title: await page.title().catch(() => ''),
  questionLi: best.questionLi || 0,
  catalogLi: best.catalogLi || 0,
  hasVideo: Boolean(best.hasVideo),
  current: best.current || 0,
  duration: best.duration || 0,
  paused: best.paused,
  text: best.text || '',
  shot,
}
console.log(JSON.stringify(summary, null, 2))
await browser.close()
