import { computed, ref, shallowRef } from 'vue'

export type BrowserAbstractionId =
  | 'chaoxing-homework'
  | 'chaoxing-study'
  | 'chaoxing-captcha'
  | 'chaoxing-login'

export type BrowserAbstraction = {
  id: BrowserAbstractionId
  name: string
  tool: string
  extraTools?: string[]
  summary: string
  match: (url: string) => boolean
}

export type HomeworkCardSnap = {
  page?: string
  title?: string
  url?: string
  next?: string
  hint?: string
  questionCount?: number
  filledCount?: number
  pendingCount?: number
  questions?: Array<{
    index: number
    type?: string
    typeName?: string
    stem: string
    images?: string[]
    filled?: boolean
    needsVision?: boolean
    imageCount?: number
    options?: Array<{ letter: string; text: string; selected?: boolean; image?: string; images?: string[] }>
    readBy?: string
  }>
  pending?: Array<{ title: string; status: string }>
  works?: Array<{ title: string; status: string }>
}

const isChaoxing = (url: string) => /chaoxing\.com/i.test(url)
export const isPlayerUrl = (url: string) => isChaoxing(url) && /studentstudy/i.test(url)
export const isCourseUrl = (url: string) => (
  isChaoxing(url)
  && /\/mycourse\/stu|studentcourse|stucoursemiddle/i.test(url)
  && !isPlayerUrl(url)
)
export const isHomeworkUrl = (url: string) => {
  if (!isChaoxing(url) || isPlayerUrl(url) || /studentcourse/i.test(url)) return false
  return /doHomeWork|\/work\/|workId=|workid=|pageHeader=8/i.test(url)
}
export const isStudyUrl = (url: string) => (
  (isPlayerUrl(url) || isCourseUrl(url) || (isChaoxing(url) && /knowledge/i.test(url)))
  && !isHomeworkUrl(url)
)
export const isLoginUrl = (url: string) => /passport2\.chaoxing\.com/i.test(url)

export const BROWSER_ABSTRACTIONS: BrowserAbstraction[] = [
  {
    id: 'chaoxing-homework',
    name: '学习通作业',
    tool: 'browser_chaoxing_homework',
    summary: '题卡：list / open / inspect / fill / save / submit',
    match: isHomeworkUrl,
  },
  {
    id: 'chaoxing-study',
    name: '学习通刷课',
    tool: 'browser_click_text / browser_chaoxing_play',
    extraTools: ['browser_chaoxing_chapters', 'browser_chaoxing_watch', 'browser_chaoxing_next'],
    summary: '点章节 → 点节名 → play → watch → next',
    match: isStudyUrl,
  },
  {
    id: 'chaoxing-captcha',
    name: '学习通验证码',
    tool: 'browser_chaoxing_captcha',
    summary: '认图填写 9010 图片验证码',
    match: () => false,
  },
  {
    id: 'chaoxing-login',
    name: '学习通登录',
    tool: 'browser_type / browser_click',
    summary: 'passport2：#phone、#pwd、#loginBtn',
    match: isLoginUrl,
  },
]

export const lastHomeworkCard = shallowRef<HomeworkCardSnap | null>(null)
export const abstractionParsing = ref(false)
export const abstractionMenuOpen = ref(false)
export const currentBrowserUrl = ref('')
export const currentBrowserId = ref('')

export const publishHomeworkCard = (card: HomeworkCardSnap | null) => {
  lastHomeworkCard.value = card
}

export const setCurrentBrowserPage = (id: string, url: string) => {
  currentBrowserId.value = id
  currentBrowserUrl.value = url
}

export const primaryAbstraction = (url: string) => (
  BROWSER_ABSTRACTIONS.find((item) => item.id !== 'chaoxing-captcha' && item.match(url))
  || BROWSER_ABSTRACTIONS.find((item) => item.match(url))
  || null
)

export type AbstractionRow = BrowserAbstraction & {
  current: boolean
  preview: string
}

export const abstractionRows = (
  url: string,
  extras?: {
    unfinished?: string[]
    unfinishedCount?: number
    currentTitle?: string
    progress?: { done: number; total: number } | null
  },
): AbstractionRow[] => {
  const primary = primaryAbstraction(url)
  const homework = lastHomeworkCard.value
  return BROWSER_ABSTRACTIONS.map((item) => {
    const current = primary?.id === item.id
    let preview = item.summary
    if (item.id === 'chaoxing-homework' && homework) {
      const count = homework.questionCount || homework.questions?.length || 0
      const filled = homework.filledCount || 0
      const pending = homework.pendingCount || homework.pending?.length || 0
      if (count) preview = `${homework.title || '题卡'} · ${count} 道，已填 ${filled}`
      else if (pending) preview = `待做 ${pending} 份`
      else if (homework.hint) preview = homework.hint
    }
    if (item.id === 'chaoxing-study' && extras) {
      const left = extras.unfinishedCount || extras.unfinished?.length || 0
      const bits = [
        left ? `未完成 ${left}` : '',
        extras.currentTitle ? `当前「${extras.currentTitle}」` : '',
        extras.progress ? `${extras.progress.done}/${extras.progress.total}` : '',
      ].filter(Boolean)
      if (bits.length) preview = bits.join(' · ')
    }
    return { ...item, current, preview }
  })
}

export const abstractionButtonLabel = computed(() => {
  const hit = primaryAbstraction(currentBrowserUrl.value)
  if (!hit) return '解析'
  if (hit.id === 'chaoxing-study') return '章节'
  if (hit.id === 'chaoxing-homework') return '题卡'
  return hit.name.replace(/^学习通/, '') || '解析'
})

export const abstractionPanelTitle = computed(() => {
  const hit = primaryAbstraction(currentBrowserUrl.value)
  if (!hit) return '解析'
  if (hit.id === 'chaoxing-study') return '章节'
  if (hit.id === 'chaoxing-homework') return '题卡'
  if (hit.id === 'chaoxing-login') return '登录'
  if (hit.id === 'chaoxing-captcha') return '验证码'
  return hit.name.replace(/^学习通/, '') || '解析'
})

const esc = (value: string) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const typeLabel = (raw?: string, fallback?: string) => {
  const text = String(raw || fallback || '').trim()
  if (/多选|multi/i.test(text)) return '多选题'
  if (/判断|judge/i.test(text)) return '判断题'
  if (/填空|blank/i.test(text)) return '填空题'
  if (/简答|论述|计算|text/i.test(text)) return '简答题'
  if (/单选|single/i.test(text)) return '单选题'
  return text || '题目'
}

const renderImages = (images?: string[]) => (
  (images || []).filter(Boolean).map((src) => (
    `<img class="ze-abs-img" src="${esc(src)}" alt="" referrerpolicy="no-referrer">`
  )).join('')
)

const questionHtml = (item: NonNullable<HomeworkCardSnap['questions']>[number]) => {
  const stem = String(item.stem || '').replace(/\s+/g, ' ').trim()
  const stemImgs = (item.images || []).filter(Boolean)
  const options = item.options || []
  const image = Boolean(item.needsVision || Number(item.imageCount) > 0 || stemImgs.length || !stem)
  const marks = [
    item.filled ? '<em class="is-done">已填</em>' : '',
    image && !stem && !stemImgs.length ? '<em class="is-img">图片题</em>' : '',
  ].filter(Boolean).join('')
  const opts = options.length
    ? `<div class="ze-abs-opts">${options.map((opt) => {
        const pics = [opt.image, ...(opt.images || [])].filter(Boolean)
        const unique = pics.filter((src, idx) => pics.indexOf(src) === idx)
        const text = unique.length ? '' : String(opt.text || '').replace(/^[A-H][.、．)\s]*/, '').trim()
        const body = [
          text ? `<span class="ze-abs-opt-text">${esc(text)}</span>` : '',
          ...unique.map((src) => `<img class="ze-abs-img" src="${esc(src)}" alt="" referrerpolicy="no-referrer">`),
          !text && !unique.length ? '<span class="ze-abs-opt-empty">—</span>' : '',
        ].join('')
        return `<span class="${opt.selected ? 'is-on' : ''}"><b>${esc(opt.letter || '')}</b>${body}</span>`
      }).join('')}</div>`
    : ''
  const stemHtml = stemImgs.length
    ? `<p class="ze-abs-stem">${renderImages(stemImgs)}</p>`
    : stem
      ? `<p class="ze-abs-stem">${esc(stem)}</p>`
      : image ? '<p class="ze-abs-stem is-muted">题目在图里</p>' : ''
  return `<li class="ze-abs-q">
    <div class="ze-abs-q-meta">
      <b>第 ${item.index} 题</b>
      <i>${esc(typeLabel(item.typeName, item.type))}</i>
      ${marks}
    </div>
    ${stemHtml}
    ${opts}
  </li>`
}

export const abstractionOverlayHtml = (
  url: string,
  extras?: Parameters<typeof abstractionRows>[1],
) => {
  const layer = primaryAbstraction(url)
  const homework = lastHomeworkCard.value
  const parsing = abstractionParsing.value
  if (!layer) {
    return `<div class="ze-abs-empty">${parsing ? '正在识别当前页…' : '当前页没有可解析的题卡'}</div>`
  }

  if (layer.id === 'chaoxing-homework') {
    const questions = (homework?.questions || []).slice(0, 40)
    const works = ((homework?.pending?.length ? homework.pending : homework?.works) || []).slice(0, 16)
    const count = homework?.questionCount || questions.length
    const filled = homework?.filledCount || 0
    const pending = homework?.pendingCount || homework?.pending?.length || 0
    const agentHint = /不要 eval|调用 browser_|inspect 读题卡/.test(homework?.hint || '')
    const title = String(homework?.title || '').replace(/^作业作答$/, '').trim() || '作业'
    const percent = count ? Math.round((filled / count) * 100) : 0
    const head = `<header class="ze-abs-head">
      <div>
        <div class="ze-abs-title">${esc(title)}</div>
        <div class="ze-abs-sub">${count ? `${count} 道题` : pending ? `待做 ${pending} 份` : parsing ? '正在读取…' : '还没读到题目'}</div>
      </div>
      ${count ? `<div class="ze-abs-progress"><span>${filled} / ${count}</span><i class="ze-abs-bar"><i style="width:${percent}%"></i></i></div>` : ''}
    </header>`
    const body = questions.length
      ? `<ol class="ze-abs-list">${questions.map(questionHtml).join('')}</ol>`
      : works.length
        ? `<ul class="ze-abs-works">${works.map((work) =>
            `<li><span>${esc(work.title)}</span><span>${esc(work.status)}</span></li>`).join('')}</ul>`
        : `<div class="ze-abs-empty">${esc(agentHint ? '正在读题目…' : (homework?.hint || '还没读到题目'))}</div>`
    return `<article class="ze-abs-card is-current">${head}${body}</article>`
  }

  if (layer.id === 'chaoxing-study') {
    const unfinished = extras?.unfinished || []
    const left = extras?.unfinishedCount || unfinished.length
    const progress = extras?.progress
    const status = [
      extras?.currentTitle ? `当前「${extras.currentTitle}」` : '',
      left ? `未完成 ${left}` : '',
      progress ? `${progress.done}/${progress.total}` : '',
    ].filter(Boolean).join(' · ') || (parsing ? '正在解析章节…' : '还没读到未完成章节')
    const list = unfinished.slice(0, 12)
    return `<article class="ze-abs-card is-current">
      <header class="ze-abs-head">
        <div>
          <div class="ze-abs-title">${esc(layer.name)}</div>
          <div class="ze-abs-sub">${esc(status)}</div>
        </div>
      </header>
      ${list.length ? `<ul class="ze-abs-works">${list.map((title) => `<li>${esc(title)}</li>`).join('')}</ul>` : ''}
    </article>`
  }

  return `<article class="ze-abs-card is-current">
    <header class="ze-abs-head">
      <div>
        <div class="ze-abs-title">${esc(layer.name)}</div>
        <div class="ze-abs-sub">${esc(layer.summary)}</div>
      </div>
    </header>
  </article>`
}
