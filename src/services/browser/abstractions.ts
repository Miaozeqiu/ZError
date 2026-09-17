import { computed, ref, shallowRef, watch } from 'vue'
import {
  ensurePlatformAdapters,
  listPlatformAdapters,
  resolvePlatformAdapter,
  type PlatformRole,
} from '../platform'

ensurePlatformAdapters()

/** 抽象层角色（跨平台稳定）。旧 id 如 chaoxing-study 已废弃，请用 role。 */
export type BrowserAbstractionRole = PlatformRole
export type BrowserAbstractionId = BrowserAbstractionRole

export type BrowserAbstraction = {
  id: BrowserAbstractionId
  role: BrowserAbstractionRole
  platformId: string
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

const withAdapter = <T,>(url: string, fn: (adapter: NonNullable<ReturnType<typeof resolvePlatformAdapter>>) => T, fallback: T): T => {
  const adapter = resolvePlatformAdapter(url)
  if (!adapter) return fallback
  return fn(adapter)
}

export const isPlayerUrl = (url: string) => withAdapter(url, (a) => a.isPlayerUrl(url), false)
export const isCourseUrl = (url: string) => withAdapter(url, (a) => a.isCourseUrl(url), false)
export const isHomeworkDoUrl = (url: string) => withAdapter(url, (a) => a.isHomeworkDoUrl(url), false)
export const isHomeworkListUrl = (url: string) => withAdapter(url, (a) => a.isHomeworkListUrl(url), false)
export const isHomeworkUrl = (url: string) => withAdapter(url, (a) => a.isHomeworkUrl(url), false)
export const isChapterWorkUrl = (url: string) => withAdapter(url, (a) => a.isChapterWorkUrl(url), false)
export const canUseHomeworkTools = (url: string) => withAdapter(url, (a) => a.canUseHomeworkTools(url), false)
export const isStudyUrl = (url: string) => withAdapter(url, (a) => a.isStudyUrl(url), false)
export const isLoginUrl = (url: string) => withAdapter(url, (a) => a.isLoginUrl(url), false)

const ROLE_META: Record<BrowserAbstractionRole, { name: string; tool: string; extraTools?: string[]; summary: string }> = {
  homework: {
    name: '作业',
    tool: 'browser_homework',
    summary: '题卡：list / open / inspect / fill / save / submit',
  },
  study: {
    name: '刷课',
    tool: 'browser_click_text / browser_study_play',
    extraTools: ['browser_study_chapters', 'browser_study_watch', 'browser_study_next'],
    summary: '点章节 → 点节名 → play → watch → next',
  },
  captcha: {
    name: '验证码',
    tool: 'browser_captcha',
    summary: '认图填写图片验证码',
  },
  login: {
    name: '登录',
    tool: 'browser_type / browser_click',
    summary: '账号密码登录',
  },
}

const buildAbstractionsForRole = (role: BrowserAbstractionRole, platformId: string, platformName: string): BrowserAbstraction => {
  const meta = ROLE_META[role]
  const label = listPlatformAdapters().find((a) => a.id === platformId)?.roleLabel(role) || meta.name
  return {
    id: role,
    role,
    platformId,
    name: platformName ? `${platformName}${label}` : label,
    tool: meta.tool,
    extraTools: meta.extraTools,
    summary: meta.summary,
    match: (url: string) => {
      const adapter = resolvePlatformAdapter(url)
      if (!adapter || adapter.id !== platformId) return false
      if (role === 'captcha') return false
      return adapter.roleOf(url) === role
    },
  }
}

/** 由已注册平台生成抽象层；当前仅学习通。 */
export const BROWSER_ABSTRACTIONS: BrowserAbstraction[] = listPlatformAdapters().flatMap((adapter) => (
  (['homework', 'study', 'captcha', 'login'] as BrowserAbstractionRole[]).map((role) => (
    buildAbstractionsForRole(role, adapter.id, adapter.name)
  ))
))

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

export const abstractionRole = (layer: { id?: string; role?: BrowserAbstractionRole } | null | undefined): BrowserAbstractionRole | null => {
  if (!layer) return null
  if (layer.role) return layer.role
  const id = String(layer.id || '')
  if (id === 'homework' || id.endsWith('-homework') || id === 'chaoxing-homework') return 'homework'
  if (id === 'study' || id.endsWith('-study') || id === 'chaoxing-study') return 'study'
  if (id === 'login' || id.endsWith('-login') || id === 'chaoxing-login') return 'login'
  if (id === 'captcha' || id.endsWith('-captcha') || id === 'chaoxing-captcha') return 'captcha'
  return null
}

export const primaryAbstraction = (url: string) => (
  BROWSER_ABSTRACTIONS.find((item) => item.role !== 'captcha' && item.match(url))
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
  const adapter = resolvePlatformAdapter(url)
  const visible = BROWSER_ABSTRACTIONS.filter((item) => !adapter || item.platformId === adapter.id)
  return visible.map((item) => {
    const current = primary?.id === item.id && primary?.platformId === item.platformId
    let preview = item.summary
    if (item.role === 'homework' && homework) {
      const count = homework.questionCount || homework.questions?.length || 0
      const filled = homework.filledCount || 0
      const pending = homework.pendingCount || homework.pending?.length || 0
      if (count) preview = `${homework.title || '题卡'} · ${count} 道，已填 ${filled}`
      else if (pending) preview = `待做 ${pending} 份`
      else if (homework.hint) preview = homework.hint
    }
    if (item.role === 'study' && extras) {
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
  const role = abstractionRole(hit)
  if (!hit || !role) return '解析'
  if (role === 'study') return '章节'
  if (role === 'homework') return '题卡'
  return hit.name.replace(/^学习通|^智慧树/, '') || '解析'
})

/** 仅章节/题卡等有内容解析的页面显示入口；登录、空间等无解析页隐藏。 */
export const abstractionButtonVisible = computed(() => {
  const role = abstractionRole(primaryAbstraction(currentBrowserUrl.value))
  return role === 'study' || role === 'homework'
})

watch(abstractionButtonVisible, (visible) => {
  if (!visible) {
    abstractionMenuOpen.value = false
    abstractionDrill.value = null
  }
})

/** 章节面板钻进本节测验等子页时的面包屑 / 返回状态 */
export type AbstractionDrill = {
  browserId: string
  kind: 'chapter-quiz'
  sectionIndex?: string
  sectionTitle: string
  jobLabel: string
}

export const abstractionDrill = ref<AbstractionDrill | null>(null)

export const setAbstractionDrill = (next: AbstractionDrill | null) => {
  abstractionDrill.value = next
}

export const clearAbstractionDrill = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (!id || abstractionDrill.value?.browserId === id) abstractionDrill.value = null
}

watch(currentBrowserUrl, (url) => {
  const drill = abstractionDrill.value
  if (!drill) return
  if (!/studentstudy/i.test(url || '')) clearAbstractionDrill(drill.browserId)
})

export const abstractionPanelTitle = computed(() => {
  const hit = primaryAbstraction(currentBrowserUrl.value)
  const role = abstractionRole(hit)
  if (!hit || !role) return '解析'
  if (role === 'study') return '章节'
  if (role === 'homework') return '题卡'
  if (role === 'login') return '登录'
  if (role === 'captcha') return '验证码'
  return hit.name.replace(/^学习通|^智慧树/, '') || '解析'
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
  const role = abstractionRole(layer)
  const homework = lastHomeworkCard.value
  const parsing = abstractionParsing.value
  if (!layer || !role) {
    return `<div class="ze-abs-empty">${parsing ? '正在识别当前页…' : '当前页没有可解析的题卡'}</div>`
  }

  if (role === 'homework') {
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

  if (role === 'study') {
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
