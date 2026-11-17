import { homeworkParseApi } from '../host/homeworkHost'
import { createPageDocument } from '../../browser/pageDom'
import type { ChaoxingHomeworkInfo, HomeworkQuestion } from './types'

export const parseHomeworkDocument = (doc: Document, href = '') => {
  const api = homeworkParseApi()
  const questions = api.__hwParseQuestions(doc)
  const works = api.__hwParseWorks(doc, href)
  const actions = api.__hwActions(doc)
  return { questions, works, page: api.__hwPageOf(href, '', questions, works), ...actions }
}

export const parseHomeworkHtml = (html: string, href = '') => (
  parseHomeworkDocument(createPageDocument(html, href), href)
)

const compactHomeworkQuestion = (item: HomeworkQuestion): HomeworkQuestion => ({
  id: item.id,
  index: item.index,
  type: item.type,
  typeName: item.typeName,
  stem: String(item.stem || '').slice(0, 400),
  images: (item.images || []).slice(0, 8),
  options: (item.options || []).slice(0, 8).map((opt) => ({
    letter: opt.letter,
    text: String(opt.text || '').slice(0, 80),
    selected: !!opt.selected,
    image: opt.image || '',
    images: opt.images || [],
  })),
  filled: !!item.filled,
  imageCount: item.imageCount || 0,
  needsVision: !!item.needsVision,
})

/** CDP 只取回 HTML，parse.js 在本地跑，不注入作答页。 */
export const cardFromHomeworkHtml = (raw: Record<string, unknown>): ChaoxingHomeworkInfo => {
  const href = String(raw.url || '')
  const title = String(raw.title || '').replace(/^ZRRESULT:.*/, '')
  const html = String(raw.html || '')
  if (!html.trim()) return { page: 'other' }
  const parsed = parseHomeworkHtml(html, href)
  const questions = parsed.questions.map(compactHomeworkQuestion)
  // 章节页误扫目录链接时清掉假 works
  const onChapterShell = /\/mycourse\/studentstudy|\/mycourse\/stu/i.test(href) && !/\/work\//i.test(href)
  const works = onChapterShell && !questions.length ? [] : (parsed.works || [])
  const pending = works.filter((item) => /待做|未做|未完成|未交|未提交|待交/.test(item.status || ''))
  return {
    ok: true,
    page: parsed.page || (questions.length ? 'do' : works.length ? 'list' : 'other'),
    url: href,
    title: (title.match(/作业[^\n]{0,40}/)?.[0] || title).slice(0, 40),
    works,
    pending,
    pendingCount: pending.length,
    questions,
    questionCount: questions.length,
    questionTotal: parsed.questions.total || questions.length,
    truncated: !!parsed.questions.truncated,
    filledCount: questions.filter((item) => item.filled).length,
    canSave: Boolean(parsed.canSave),
    canSubmit: Boolean(parsed.canSubmit),
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (typeof window === 'undefined' || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    void import('./inspect').then((mod) => mod.retrySelectedHomeworkInspect()).catch(() => undefined)
  })
}

export const isBlankHomeworkStem = (stem?: string) => {
  const text = String(stem || '').replace(/[\s\u00a0\u3000]+/g, '')
  return !text || /^[（()）]+$/.test(text)
}

export const questionHasContent = (
  item?: NonNullable<ChaoxingHomeworkInfo['questions']>[number],
) => {
  if (!item) return false
  if (!isBlankHomeworkStem(item.stem)) return true
  if ((item.images || []).length) return true
  return (item.options || []).some((opt) => (
    Boolean(String(opt.text || '').trim())
    || Boolean(opt.image)
    || Boolean(opt.images?.length)
  ))
}

export const homeworkQuestionsHollow = (
  questions?: ChaoxingHomeworkInfo['questions'],
) => Boolean(questions?.length) && !questions.some(questionHasContent)

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
    ? (info.skippedVision
      ? `第 ${unread.join('、')} 题是图像/公式，当前没有视觉模型，已跳过，不要猜。`
      : `第 ${unread.join('、')} 题的公式还没读全，先跳过答其他题，稍后再 inspect 一次会自动补读，不要猜。`)
    : ''
  const hints: Record<string, string> = {
    list: '待做作业已在 works 里。直接 open 第一份未交，不要再 list / get_page。',
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
    hint: [
      info.error || (info.hint && !/不在作业页|作业列表还没读到/.test(info.hint) ? info.hint : hints[next]),
      info.truncated && info.questionTotal
        ? `只显示前 ${info.questionCount || info.questions?.length || 0} 道，页上共 ${info.questionTotal} 道。`
        : '',
    ].filter(Boolean).join(' '),
  }
}

export const enrichQuestionsFromLiveText = (
  questions: NonNullable<ChaoxingHomeworkInfo['questions']>,
  rows: Array<{ i?: number; t?: string }>,
) => questions.map((item) => {
  const row = rows.find((entry) => Number(entry.i) === Number(item.index))
  const text = String(row?.t || '').replace(/\s+/g, ' ').trim()
  if (!text) return item
  const parsed = parseChoiceChunk(text)
  const options = (item.options || []).map((opt) => {
    if (String(opt.text || '').trim()) return opt
    const hit = parsed.find((entry) => entry.letter === opt.letter)
    return hit?.text ? { ...opt, text: hit.text } : opt
  })
  let stem = item.stem
  if (isBlankHomeworkStem(stem)) {
    const afterType = text.replace(/^\d+\.\s*[（(][^）)]+[）)]\s*/, '')
    const optAt = afterType.search(/(?:^|\s)([A-H])(?:[.、．)\s]|$)/)
    const stemRaw = (optAt >= 0 ? afterType.slice(0, optAt) : afterType).replace(/\(\s*\)/g, ' ').trim()
    if (!isBlankHomeworkStem(stemRaw)) stem = stemRaw.slice(0, 400)
  }
  return { ...item, stem, options }
})

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

const WORK_STATUS = '待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交'
const WORK_LINE = new RegExp(`^(.*?)(?:\\s*[;；|]\\s*|\\s+)(${WORK_STATUS})\\s*$`)
const WORK_SKIP = /^(作业|测验|考试|章节|任务|讨论|资料|错题集|学习记录|默认班级)$/

export const parseHomeworkWorks = (text: string): NonNullable<ChaoxingHomeworkInfo['works']> => {
  const out: NonNullable<ChaoxingHomeworkInfo['works']> = []
  const seen: Record<string, 1> = {}
  const add = (title: string, status: string) => {
    const name = String(title || '').replace(/\s+/g, ' ').trim()
    if (!name || name.length < 2 || name.length > 80 || WORK_SKIP.test(name) || seen[name]) return
    seen[name] = 1
    const raw = String(status || '')
    out.push({
      title: name,
      status: /待批阅/.test(raw)
        ? '待批阅'
        : (/已完成|已批阅|已交/.test(raw) && !/未交|未提交|待交/.test(raw) ? '已完成' : '待做'),
    })
  }
  for (const line of String(text || '').split(/\n+/).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const hit = line.match(WORK_LINE)
    if (hit) add(hit[1], hit[2])
  }
  return out
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
      type: /多选/.test(typeName) ? 'multi'
        : /填空/.test(typeName) ? 'blank'
        : /判断/.test(typeName) ? 'judge'
        : /简答|论述|计算|解答/.test(typeName) ? 'text'
        : /单选/.test(typeName) ? 'single'
        : 'other',
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

