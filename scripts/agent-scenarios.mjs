#!/usr/bin/env node
/**
 * 五个固定场景。桥接 127.0.0.1:1429 不在时只列出场景并退出 0。
 * 在的时候逐个发 prompt，把每段结果写成 JSON。
 */
const BASE = process.env.ZERROR_AGENT_BRIDGE || 'http://127.0.0.1:1429'

const scenarios = [
  { id: 'zjooc-login', prompt: '只登录在浙学，不要进课。登录页离开了就 finish。' },
  { id: 'zjooc-catalog', prompt: '打开在浙学成衣工艺学的章节目录，停在目录页。' },
  { id: 'zjooc-first-video', prompt: '在浙学成衣工艺学只播第一条视频并 browser_watch，然后 finish(watching)。' },
  { id: 'cx-video-2', prompt: '学习通当前这一节切到第 2 个视频并确认在播。' },
  { id: 'cx-next-chapter', prompt: '学习通切到下一节后再播当前未完成视频。' },
  {
    id: 'zjooc-course-plan',
    prompt: '在浙学成衣工艺学用 browser_course_plan from_snapshot 然后 start。一条视频播起来后 finish(watching)，不要用 eval 盯进度。',
    accept: 'eval 不超过 2 次且没有 SyntaxError，用了 course_plan，一条视频播放期间模型轮次不超过 3，播完由 runner 打开下一节。',
  },
]

const ping = async () => {
  try {
    const res = await fetch(`${BASE}/live`)
    return res.ok
  } catch {
    return false
  }
}

const up = await ping()
if (!up) {
  console.log(JSON.stringify({
    bridge: BASE,
    skipped: true,
    reason: '桥接没开',
    scenarios: scenarios.map((item) => item.id),
  }, null, 2))
  process.exit(0)
}

const results = []
for (const scenario of scenarios) {
  const started = Date.now()
  try {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: scenario.prompt }),
    })
    const body = await res.json().catch(() => ({}))
    results.push({
      id: scenario.id,
      ok: res.ok,
      ms: Date.now() - started,
      status: body.status || body.finished || '',
    })
  } catch (error) {
    results.push({ id: scenario.id, ok: false, error: String(error) })
  }
}
console.log(JSON.stringify({ bridge: BASE, results }, null, 2))
