#!/usr/bin/env node
/** CDP 切章并播：连 9333，点目录，等 video，点播放，核对进度。 */
const playwrightUrl = process.env.PLAYWRIGHT_ENTRY
  || `${process.env.HOME}/.nvm/versions/node/${process.version}/lib/node_modules/playwright/index.mjs`
const { chromium } = await import(playwrightUrl)

const want = process.argv[2] || '2.6 高阶导数'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = browser.contexts().flatMap((c) => c.pages())
  .find((p) => /chaoxing|mooc1/.test(p.url()))
  || browser.contexts().flatMap((c) => c.pages())[0]
if (!page) {
  console.error('9333 没有学习通页')
  process.exit(1)
}

const snap = async (tag) => {
  const frames = []
  for (const frame of page.frames()) {
    try {
      frames.push(await frame.evaluate(() => {
        const v = document.querySelector('video')
        const name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name')
        return {
          url: location.href,
          catalog: document.querySelectorAll('#coursetree .posCatalog_select').length,
          current: name ? String(name.getAttribute('title') || name.textContent || '').replace(/\s+/g, ' ').trim() : '',
          hasVideo: Boolean(v),
          paused: v ? v.paused : null,
          time: v ? Number(v.currentTime) || 0 : 0,
          duration: v ? Number(v.duration) || 0 : 0,
          ready: v ? Number(v.readyState) || 0 : 0,
        }
      }))
    } catch (error) {
      frames.push({ url: frame.url(), error: String(error).slice(0, 80) })
    }
  }
  const video = frames.find((f) => f.hasVideo) || {}
  const catalog = frames.find((f) => f.catalog > 0) || frames[0] || {}
  const row = {
    tag,
    href: page.url(),
    current: catalog.current || '',
    catalog: catalog.catalog || 0,
    hasVideo: Boolean(video.hasVideo),
    paused: video.paused,
    time: video.time || 0,
    duration: video.duration || 0,
    ready: video.ready || 0,
    frames: frames.length,
  }
  console.log(JSON.stringify(row))
  return { frames, video, catalog, row }
}

const before = await snap('before')
console.log('page', page.url())

const clicked = await page.evaluate((title) => {
  const want = String(title || '').replace(/\s+/g, ' ').trim()
  const nodes = document.querySelectorAll('#coursetree .posCatalog_name, #coursetree .posCatalog_title')
  for (const el of nodes) {
    const t = String(el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (t === want || t.includes(want) || want.includes(t.replace(/^\d+(?:\.\d+)+\s*/, ''))) {
      el.click()
      return { ok: true, text: t }
    }
  }
  return { ok: false, n: nodes.length }
}, want)
console.log('click', JSON.stringify(clicked))

const deadline = Date.now() + 12_000
while (Date.now() < deadline) {
  await page.waitForTimeout(400)
  const href = page.url()
  if (clicked.ok && href !== before.row.href) break
  const mid = await snap('wait')
  if (mid.catalog.current && mid.catalog.current.includes(want.replace(/^\d+(?:\.\d+)+\s*/, '').slice(0, 4))) break
}

await page.waitForTimeout(1200)
const afterOpen = await snap('after-open')

let played = { ok: false }
for (const frame of page.frames()) {
  try {
    const hit = await frame.evaluate(() => {
      const v = document.querySelector('video')
      if (!v) return null
      const btn = document.querySelector('.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster, video')
      if (btn) btn.click()
      try { v.play() } catch (e) {}
      return { paused: v.paused, time: v.currentTime, duration: v.duration || 0 }
    })
    if (hit) {
      played = { ok: true, ...hit }
      break
    }
  } catch {
    // 跨域框跳过
  }
}
console.log('play', JSON.stringify(played))

await page.waitForTimeout(3500)
const t1 = await snap('+3s')
await page.waitForTimeout(4000)
const t2 = await snap('+7s')
const advanced = (t2.row.time || 0) - (t1.row.time || 0)
console.log(JSON.stringify({
  ok: advanced > 0.8 && t2.row.paused === false,
  advanced: Number(advanced.toFixed(2)),
  current: t2.row.current,
  href: page.url(),
}))
await browser.close()
process.exit(advanced > 0.8 ? 0 : 2)
