import type { ChaoxingHomeworkInfo, HomeworkFrameSnap } from './types'

export const homeworkReady = (info: ChaoxingHomeworkInfo | null) =>
  Boolean(info && ((info.works && info.works.length) || (info.questions && info.questions.length)))

const homeworkNext = (info: ChaoxingHomeworkInfo): NonNullable<ChaoxingHomeworkInfo['next']> => {
  if (info.page === 'list') return (info.pendingCount || 0) > 0 ? 'open' : (info.works?.length ? 'done' : 'list')
  if (info.page === 'do') {
    if (!(info.questions || []).length) return 'inspect'
    if ((info.filledCount || 0) < (info.questionCount || info.questions?.length || 0)) return 'fill'
    return 'save'
  }
  if (info.page === 'view') return 'done'
  if (info.page === 'course') return 'list'
  return 'inspect'
}

export const toHomeworkCard = (info: ChaoxingHomeworkInfo): ChaoxingHomeworkInfo => {
  const next = homeworkNext(info)
  const unread = (info.questions || [])
    .filter((q) => {
      const stem = String(q.stem || '').replace(/[（()）\s]/g, '')
      const optsBlind = (q.options || []).some((o) => !String(o.text || '').trim())
      return !stem || optsBlind
    })
    .map((q) => q.index)
  const unreadNote = unread.length
    ? `第 ${unread.join('、')} 题的公式还没读全，先跳过答其他题，稍后再 inspect 一次会自动补读，不要猜。`
    : ''
  const hints: Record<string, string> = {
    list: '先 list，再 open 待做作业。',
    open: info.pending?.[0]?.title ? `open，title 填「${info.pending[0].title}」。` : 'open 打开一份待做作业。',
    inspect: '还没读到题目。打开作业页后再 inspect。',
    fill: `已读到 ${info.questionCount || 0} 道题，已填 ${info.filledCount || 0} 道。一题一题来：答出一道就立刻 fill 这一道，再看下一道。${unreadNote}`,
    save: '答案已填。用户要交用 submit，否则 save 暂存。',
    submit: '用户要提交时再 submit。',
    done: '这份作业不用再做。',
  }
  return {
    ok: true,
    ...info,
    next,
    hint: info.hint && !/不在作业页|作业列表还没读到/.test(info.hint) ? info.hint : hints[next],
  }
}

const parseChoiceChunk = (text: string) => {
  const options: NonNullable<ChaoxingHomeworkInfo['questions']>[number]['options'] = []
  const chunks = String(text || '').split(/(?=[A-H](?:[.、．)\s]|$))/).map((item) => item.trim()).filter(Boolean)
  for (const chunk of chunks) {
    const hit = chunk.match(/^([A-H])(?:[.、．)\s]*)(.*)$/)
    if (!hit) continue
    options.push({ letter: hit[1], text: (hit[2] || '').replace(/\s+/g, ' ').trim().slice(0, 80), selected: false })
  }
  return options
}

export const parseHomeworkText = (text: string): NonNullable<ChaoxingHomeworkInfo['questions']> => {
  const blocks = String(text || '').split(/(?=\d+\.\s*[（(])/)
  const out: NonNullable<ChaoxingHomeworkInfo['questions']> = []
  for (const block of blocks) {
    const flat = block.replace(/\s+/g, ' ').trim()
    if (!/^\d+\./.test(flat)) continue
    const typeName = (flat.match(/[（(](单选题|多选题|填空题|判断题|简答题|单选|多选|填空|判断)[）)]/) || [])[1] || '单选题'
    const afterType = flat.replace(/^\d+\.\s*[（(][^）)]+[）)]\s*/, '')
    const optAt = afterType.search(/(?:^|\s)([A-H])(?:[.、．)\s]|$)/)
    const stemRaw = (optAt >= 0 ? afterType.slice(0, optAt) : afterType).replace(/\(\s*\)/g, ' ').trim()
    const options = parseChoiceChunk(optAt >= 0 ? afterType.slice(optAt) : '')
    out.push({
      id: String(out.length + 1),
      index: out.length + 1,
      type: /多选/.test(typeName) ? 'multi' : /填空/.test(typeName) ? 'blank' : /判断/.test(typeName) ? 'judge' : 'single',
      typeName,
      stem: stemRaw.slice(0, 180),
      options,
      filled: false,
      needsVision: stemRaw.length < 8 || options.filter((item) => item.text).length < 2,
    })
  }
  return out
}

export const questionImageCount = (list: NonNullable<ChaoxingHomeworkInfo['questions']>) =>
  list.reduce((sum, item) => (
    sum
    + (item.images?.length || 0)
    + Number(item.imageCount || 0)
    + (item.options || []).reduce((n, opt) => n + (opt.images?.length || 0) + (opt.image ? 1 : 0), 0)
  ), 0)

const stripOptsFromStemText = (stem: string) => {
  const s = String(stem || '')
    .replace(/^\d+[.、．\s]*/, '')
    .replace(/^[（(]\s*(单选题|多选题|判断题|填空题|简答题|问答题|计算题|论述题|不定项)\s*[）)]\s*/, '')
    .trim()
  if (/^[（(]\s*[）)]$/.test(s)) return s
  const cut = s.split(/(?=[A-H][.、．\s])/)[0]?.trim()
  return cut || s
}

export const rebalanceHomeworkQuestion = (
  item: NonNullable<ChaoxingHomeworkInfo['questions']>[number],
) => {
  const opts = item.options || []
  const stem = stripOptsFromStemText(String(item.stem || ''))
  let stemImgs = [...(item.images || [])]
  if (!opts.length) {
    return stem === item.stem ? item : { ...item, stem }
  }
  const optsHaveText = opts.some((o) => String(o.text || '').trim())
  const optsHaveImgs = opts.some((o) => o.image || o.images?.length)
  const optsNeedImages = opts.every((o) => !String(o.text || '').trim() && !o.image && !(o.images?.length))
  if (optsNeedImages && !optsHaveImgs && stemImgs.length >= opts.length && !optsHaveText) {
    let keep = 0
    if (/^[（(]\s*[）)]$/.test(stem) && stemImgs.length === opts.length + 1) keep = 1
    else if (stem.length > 10 && stemImgs.length > opts.length) keep = stemImgs.length - opts.length
    const give = stemImgs.slice(keep)
    stemImgs = stemImgs.slice(0, keep)
    return {
      ...item,
      stem,
      images: stemImgs,
      options: opts.map((o, i) => ({
        ...o,
        image: give[i] || o.image || '',
        images: give[i] ? [give[i]] : (o.images || []),
      })),
      imageCount: stemImgs.length + opts.length,
    }
  }
  if (optsHaveText && !optsHaveImgs && stemImgs.length >= opts.length + 1) {
    const keep = stemImgs.length - opts.length
    const give = stemImgs.slice(keep)
    stemImgs = stemImgs.slice(0, keep)
    return {
      ...item,
      stem,
      images: stemImgs,
      options: opts.map((o, i) => ({
        ...o,
        image: give[i] || o.image || '',
        images: give[i] ? [give[i]] : (o.images || []),
      })),
      imageCount: stemImgs.length + give.filter(Boolean).length,
    }
  }
  return stem === item.stem ? item : { ...item, stem }
}

const pruneWrapperImages = (
  list: NonNullable<ChaoxingHomeworkInfo['questions']>,
) => {
  if (list.length < 2) return list
  const first = list[0].images?.length || 0
  const rest = list.slice(1)
  const restMax = Math.max(0, ...rest.map((row) => row.images?.length || 0))
  if (first >= 6 && first > restMax + 2) {
    return rest.map((row, index) => ({ ...row, index: index + 1 }))
  }
  return list
}

const mergeQuestionImages = (
  base: NonNullable<ChaoxingHomeworkInfo['questions']>,
  rich: NonNullable<ChaoxingHomeworkInfo['questions']>,
) => {
  if (!rich.length) return base
  const aligned = pruneWrapperImages(rich)
  return base.map((item, index) => {
    const hit = aligned.find((row) => row.index === item.index) || aligned[index]
    if (!hit) return item
    const images = item.images?.length ? item.images : hit.images
    const options = (item.options || []).map((opt, optIndex) => {
      const src = hit.options?.[optIndex]
      const pics = opt.images?.length || opt.image ? [opt.image, ...(opt.images || [])] : [src?.image, ...(src?.images || [])]
      const unique = pics.filter((src, idx) => src && pics.indexOf(src) === idx) as string[]
      return {
        ...opt,
        text: opt.text || src?.text || '',
        image: unique[0] || opt.image || src?.image || '',
        images: unique,
      }
    })
    return {
      ...item,
      type: item.type || hit.type,
      typeName: item.typeName || hit.typeName,
      stem: item.stem || hit.stem,
      images,
      options: options.length ? options : hit.options,
      imageCount: item.imageCount || hit.imageCount,
      needsVision: item.needsVision || hit.needsVision,
    }
  })
}

export const cardFromSnaps = (raw: Record<string, unknown>): ChaoxingHomeworkInfo => {
  const extras = (Array.isArray(raw.extras) ? raw.extras : []) as HomeworkFrameSnap[]
  const topQuestions = (Array.isArray(raw.topQuestions) ? raw.topQuestions : []) as NonNullable<ChaoxingHomeworkInfo['questions']>
  let questions: NonNullable<ChaoxingHomeworkInfo['questions']> = []
  let works: NonNullable<ChaoxingHomeworkInfo['works']> = []
  let text = String(raw.text || '')
  let url = String(raw.url || '')
  let title = String(raw.title || '').replace(/^ZRRESULT:.*/, '')
  for (const item of extras) {
    if ((item.questions?.length || 0) > questions.length) questions = item.questions || []
    if ((item.works?.length || 0) > works.length) works = item.works || []
    if (item.kind === 'work' || /work|doHomeWork|作业/.test(`${item.href || ''}${item.text || ''}`)) {
      if (item.text && item.text.length > text.length) text = item.text
      if (item.href) url = item.href
      if (item.title) title = item.title
    }
  }
  if (topQuestions.some((item) => item.stem) && (!questions.length || questionImageCount(topQuestions) > questionImageCount(questions))) {
    questions = topQuestions
  } else if (questions.length && topQuestions.length) {
    questions = mergeQuestionImages(questions, topQuestions)
  }
  if (!questions.length) {
    const parsed = parseHomeworkText(text)
    if (parsed.length) questions = mergeQuestionImages(parsed, topQuestions)
  }
  const pending = works.filter((item) => /待做|未做|未完成/.test(item.status || ''))
  const page = questions.length
    ? (/view|已批阅|正确答案/.test(`${url}${text}`) ? 'view' : 'do')
    : works.length || /作业列表|work\/list|mooc2\/work/.test(`${url}${text}`)
      ? 'list'
      : /\/mycourse\/stu/.test(url) && /作业/.test(text)
        ? 'course'
        : 'other'
  return {
    ok: true,
    page,
    url,
    title: (title.match(/作业[^\n]{0,40}/)?.[0] || text.match(/作业\d*[（(][^）)]+[）)]/)?.[0] || title).slice(0, 40),
    works,
    pending,
    pendingCount: pending.length,
    questions,
    questionCount: questions.length,
    filledCount: questions.filter((item) => item.filled).length,
    hint: questions.length || works.length
      ? undefined
      : raw.asked === false
        ? '这一页还没接上题卡，刷新后再看。'
        : extras.length
          ? '作业框回来了，但还没解析到题目。'
          : '还没读到题目。打开作业后再看。',
  }
}

const hwImageKeys = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((key): key is string => typeof key === 'string')
  if (raw && typeof raw === 'object' && Array.isArray((raw as { keys?: unknown }).keys)) {
    return (raw as { keys: unknown[] }).keys.filter((key): key is string => typeof key === 'string')
  }
  return []
}

const hwImageSrcs = (raw: unknown, fallback?: string[]) => {
  const listed = (fallback || []).filter(Boolean)
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { srcs?: unknown }).srcs)) {
    return (raw as { srcs: unknown[] }).srcs.filter((src): src is string => typeof src === 'string' && !!src)
  }
  return listed
}

const pickHwImages = (keys: string[], fallback: string[], map: Record<string, string>) => {
  if (keys.length) {
    return keys.map((key, index) => map[key] || fallback[index] || '').filter(Boolean)
  }
  return fallback.filter(Boolean)
}

export const applyHwImageMap = (
  questions: NonNullable<ChaoxingHomeworkInfo['questions']>,
  map: Record<string, string>,
) => questions.map((item) => {
  const keys = hwImageKeys(item.imageKeys)
  const fallback = hwImageSrcs(item.imageKeys, item.images)
  const images = pickHwImages(keys, fallback, map)
  const options = (item.options || []).map((opt) => {
    const optKeys = hwImageKeys(opt.imageKeys)
    const optFallback = hwImageSrcs(opt.imageKeys, opt.images)
    const pics = pickHwImages(optKeys, optFallback, map)
    return {
      ...opt,
      image: pics[0] || opt.image || '',
      images: pics,
    }
  })
  return {
    ...item,
    images,
    options,
    imageCount: images.length + options.reduce((n, opt) => n + (opt.images?.length || 0), 0),
  }
})
