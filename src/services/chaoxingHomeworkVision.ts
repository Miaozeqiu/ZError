import { askFrames, evalBrowserView, waitMs } from './browserEval'
import type { ChaoxingHomeworkInfo } from './chaoxingHomework'
import { runTextModel } from './modelRunner'

const CHUNK = 7000

const asObject = (value: unknown) =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {}

const questionNeedsVision = (question: NonNullable<ChaoxingHomeworkInfo['questions']>[number]) => {
  if (question.needsVision || Number(question.imageCount) > 0) return true
  const stem = String(question.stem || '')
  const optText = (question.options || []).map((item) => item.text).join('')
  if (stem.length < 12) return true
  if (/（图像）|\(图像\)|公式图|显示不全/.test(stem + optText)) return true
  const opts = question.options || []
  if (opts.length && opts.every((item) => !item.text || item.text.length < 4 || /^[A-H][.、．)]?$/.test(item.text))) {
    return true
  }
  return false
}

const parseVisionJson = (raw: string) => {
  const text = String(raw || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced?.[1] || text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as {
      stem?: string
      options?: Array<{ letter?: string; text?: string }>
    }
  } catch {
    return null
  }
}

const readStoredShot = async (id: string, expr: string) => {
  const meta = asObject(await evalBrowserView(id, `(function(){
    var slot = ${expr};
    var s = slot && slot.data != null ? String(slot.data) : (typeof slot === 'string' ? slot : '');
    return { ready: !!(slot && (slot.ready || s)), len: s.length };
  })()`).catch(() => null))
  if (!meta.ready) return ''
  const len = Number(meta.len) || 0
  if (len <= 0) return ''
  if (len <= CHUNK) {
    const one = await evalBrowserView(id, `(function(){
      var slot = ${expr};
      return slot && slot.data != null ? String(slot.data) : String(slot || '');
    })()`).catch(() => '')
    return String(one || '')
  }
  let out = ''
  for (let start = 0; start < len; start += CHUNK) {
    const chunk = await evalBrowserView(id, `(function(){
      var slot = ${expr};
      var s = slot && slot.data != null ? String(slot.data) : String(slot || '');
      return s.slice(${start}, ${start + CHUNK});
    })()`).catch(() => '')
    out += String(chunk || '')
  }
  return out
}

const startLocalCapture = async (id: string, index: number) => {
  const { CHAOXING_HOMEWORK_CAPTURE } = await import('./browserSkills/chaoxingHomework')
  return asObject(await evalBrowserView(id, `${CHAOXING_HOMEWORK_CAPTURE}(${index})`).catch(() => null))
}

export const captureHomeworkQuestionImage = async (id: string, index: number) => {
  const zero = Math.max(0, index)
  let local = await startLocalCapture(id, zero)
  if (local.pending) {
    for (let i = 0; i < 8 && !local.ready; i += 1) {
      await waitMs(350)
      local = await startLocalCapture(id, zero)
    }
  }
  if (local.ready) {
    const image = await readStoredShot(id, `(window.__ZE_HW_LOCAL_SHOTS__ || {})[${zero}]`)
    if (image.startsWith('data:image/')) return image
  }

  await evalBrowserView(id, `(function(){
    window.__ZE_HW_SHOTS__ = window.__ZE_HW_SHOTS__ || {};
    window.__ZE_HW_SHOTS__[${zero}] = { ready: false, data: '', parts: {}, got: 0, total: 0 };
    return true;
  })()`).catch(() => null)
  await askFrames(id, 'hwshot', { index: String(zero) })
  for (let i = 0; i < 10; i += 1) {
    await waitMs(350)
    const image = await readStoredShot(id, `(window.__ZE_HW_SHOTS__ || {})[${zero}]`)
    if (image.startsWith('data:image/')) return image
  }
  return ''
}

const transcribeOne = async (images: string[], question: NonNullable<ChaoxingHomeworkInfo['questions']>[number]) => {
  const raw = await runTextModel('读出作业题目', undefined, {
    useVisionModel: true,
    timeoutMs: 25000,
    systemPrompt: '你在看学习通作业题的公式/题目图。只把图中题干和选项读成 JSON，不要解题，不要解释。公式用 LaTeX。',
    userContent: [
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'high' as const } })),
      {
        type: 'text',
        text: [
          `这是第 ${question.index} 题，类型 ${question.typeName || question.type || ''}。图按顺序：先题干公式，再选项里的公式。`,
          '页面文字（可能残缺）：',
          question.stem || '（题干是图）',
          ...(question.options || []).map((item) => `${item.letter || ''} ${item.text || (item.image || item.images?.length ? '（这个选项是图）' : '')}`.trim()),
          '把图里的内容嵌回残缺处，只回复 JSON：{"stem":"题干","options":[{"letter":"A","text":"选项"}]}',
        ].join('\n'),
      },
    ],
  })
  return parseVisionJson(raw)
}

const questionDataImages = (question: NonNullable<ChaoxingHomeworkInfo['questions']>[number]) => {
  const list = [
    ...(question.images || []),
    ...(question.options || []).flatMap((opt) => [opt.image || '', ...(opt.images || [])]),
  ].filter((src) => String(src || '').startsWith('data:image/'))
  return [...new Set(list)].slice(0, 8)
}

type VisionParsed = { stem?: string; options?: Array<{ letter?: string; text?: string }> }

// 视觉转写按题缓存：同一份作业反复 inspect 不重跑模型，面板刷新也能补上文字。
// 落到 localStorage，热更新 / 重启应用后也不用重转写。
const VISION_STORE_KEY = 'ze-hw-vision-cache-v1'

const loadVisionStore = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(VISION_STORE_KEY) || '{}') as Record<string, VisionParsed>
    return new Map(Object.entries(raw))
  } catch {
    return new Map<string, VisionParsed>()
  }
}

const visionCache = loadVisionStore()

const saveVisionStore = () => {
  try {
    const entries = [...visionCache.entries()].slice(-300)
    localStorage.setItem(VISION_STORE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* 存不下就算了，内存缓存还在 */ }
}

const visionCacheKey = (question: NonNullable<ChaoxingHomeworkInfo['questions']>[number]) =>
  `${question.id || ''}#${question.index || 0}`

const applyParsed = (
  hit: NonNullable<ChaoxingHomeworkInfo['questions']>[number],
  parsed: VisionParsed,
) => {
  if (parsed.stem) hit.stem = String(parsed.stem).slice(0, 800)
  if (parsed.options?.length) {
    hit.options = parsed.options.map((item, idx) => {
      const letter = String(item.letter || String.fromCharCode(65 + idx)).toUpperCase().slice(0, 1)
      const old = (hit.options || []).find((o) => o.letter === letter) || hit.options?.[idx]
      return {
        letter,
        text: String(item.text || '').slice(0, 240),
        selected: old?.selected,
        image: old?.image,
        images: old?.images,
      }
    })
  }
  hit.needsVision = false
  hit.readBy = 'vision'
}

export const applyHomeworkVisionCache = (info: ChaoxingHomeworkInfo): ChaoxingHomeworkInfo => {
  const questions = info.questions || []
  if (!questions.length || !visionCache.size) return info
  let applied = 0
  const next = questions.map((item) => {
    const parsed = visionCache.get(visionCacheKey(item))
    if (!parsed) return item
    const copy = { ...item, options: (item.options || []).map((o) => ({ ...o })) }
    // 选中状态以页面实时为准，只补文字
    const selectedByLetter = new Map((item.options || []).map((o) => [o.letter, o.selected]))
    applyParsed(copy, parsed)
    copy.options = (copy.options || []).map((o) => ({ ...o, selected: selectedByLetter.get(o.letter) ?? o.selected }))
    applied += 1
    return copy
  })
  return applied ? { ...info, questions: next } : info
}

// 转写失败计数：失败 2 次的题不再反复重试（每次都是 25s 超时，白等）
const visionFails = new Map<string, number>()

export const enrichHomeworkWithVision = async (id: string, info: ChaoxingHomeworkInfo) => {
  const questions = info.questions || []
  if (!questions.length) return info
  const targets = questions.filter((item) => {
    const key = visionCacheKey(item)
    return !visionCache.has(key) && (visionFails.get(key) || 0) < 2 && questionNeedsVision(item)
  })
  const next = questions.map((item) => ({ ...item }))

  // 取图（eval 通道不能并发，串行）；模型转写纯网络请求，3 路并行
  const jobs: Array<{ question: (typeof questions)[number]; images: string[] }> = []
  for (const question of targets) {
    let images = questionDataImages(question)
    if (!images.length) {
      const shot = await captureHomeworkQuestionImage(id, Math.max(0, Number(question.index) - 1)).catch(() => '')
      if (shot) images = [shot]
    }
    if (images.length) jobs.push({ question, images })
    else visionFails.set(visionCacheKey(question), (visionFails.get(visionCacheKey(question)) || 0) + 1)
  }
  let read = 0
  const queue = [...jobs]
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const key = visionCacheKey(job.question)
      try {
        const parsed = await transcribeOne(job.images, job.question)
        if (!parsed?.stem && !(parsed?.options || []).length) {
          visionFails.set(key, (visionFails.get(key) || 0) + 1)
          continue
        }
        visionCache.set(key, parsed)
        saveVisionStore()
        read += 1
      } catch {
        visionFails.set(key, (visionFails.get(key) || 0) + 1)
      }
    }
  }))
  const merged = applyHomeworkVisionCache({ ...info, questions: next })
  return {
    ...merged,
    visionRead: read,
    hint: read
      ? `已用视觉模型读出 ${read} 道公式/题目图。按 stem/options 作答，不要再说看不清。`
      : info.hint,
  }
}
