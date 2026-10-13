import { computed, ref, shallowRef, watch } from 'vue'
import { contentParserIdsOf, parserPageKindOf, siteGraphForUrl, siteGraphNodeForUrl } from './siteGraphCore'
import {
  isChaoxingCourseUrl,
  isChaoxingHomeworkDoUrl,
  isChaoxingHomeworkListUrl,
  isChaoxingHomeworkUrl,
  isChaoxingLoginUrl,
  isChaoxingPlayerUrl,
  isChaoxingStudyUrl,
  pageRoleForUrl,
} from '../platform/chaoxing/nav'
import '../platform'

/** 抽象层角色跟网站地图节点走。旧 id 如 chaoxing-study 已废弃，请用 role。 */
export type BrowserAbstractionRole = string
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
  canSave?: boolean
  canSubmit?: boolean
}

export const isPlayerUrl = (url: string) => isChaoxingPlayerUrl(url)
export const isCourseUrl = (url: string) => isChaoxingCourseUrl(url)
export const isHomeworkDoUrl = (url: string) => isChaoxingHomeworkDoUrl(url)
export const isHomeworkListUrl = (url: string) => isChaoxingHomeworkListUrl(url)
export const isHomeworkUrl = (url: string) => isChaoxingHomeworkUrl(url)
export const isChapterWorkUrl = (url: string) => isPlayerUrl(url)
export const canUseHomeworkTools = (url: string) => isHomeworkUrl(url) || isChapterWorkUrl(url)
export const isStudyUrl = (url: string) => isChaoxingStudyUrl(url)
export const isLoginUrl = (url: string) => isChaoxingLoginUrl(url)

const ROLE_META: Record<string, { name: string; tool: string; extraTools?: string[]; summary: string }> = {
  homework: {
    name: '作业',
    tool: 'browser_click',
    summary: '看快照点选项，填完再保存',
  },
  study: {
    name: '刷课',
    tool: 'browser_click / browser_watch',
    summary: '侧栏「章节」只是目录。点节名进播放页，再点播放，browser_watch 挂进度',
  },
  captcha: {
    name: '验证码',
    tool: 'browser_type',
    summary: '认图后填进输入框',
  },
  login: {
    name: '登录',
    tool: 'browser_type / browser_click',
    summary: '账号密码登录',
  },
  list: {
    name: '名单',
    tool: 'browser_click',
    summary: '看快照点要打开的那一行',
  },
  course: {
    name: '课程',
    tool: 'browser_click',
    extraTools: ['browser_click_text'],
    summary: '侧栏页签：任务 / 章节 / 作业。章节只是目录，作业才是名单。',
  },
}

export type SiteCard = {
  ok?: boolean
  url?: string
  role?: string
  page?: string
  title?: string
  current?: string
  hint?: string
  next?: string
  confidence?: number
  questionCount?: number
  filledCount?: number
  handles?: Array<{ kind?: string; label?: string; title?: string }>
  jobs?: unknown[]
  chapters?: unknown[]
  works?: Array<{ title?: string; status?: string }>
  questions?: unknown[]
  controls?: Record<string, string>
}

const roleMetaOf = (role: string) => (
  ROLE_META[role] || { name: role, tool: 'browser_click', summary: '看快照点' }
)

const GRAPH_ROLES = ['homework', 'study', 'course', 'list', 'login'] as const

const buildAbstractionsForRole = (role: BrowserAbstractionRole): BrowserAbstraction => {
  const meta = roleMetaOf(role)
  return {
    id: role,
    role,
    platformId: 'graph',
    name: meta.name,
    tool: meta.tool,
    extraTools: meta.extraTools,
    summary: meta.summary,
    match: (url: string) => role !== 'captcha' && pageRoleForUrl(url) === role,
  }
}

/** 抽象层跟网站地图的页面身份走，不跟站点适配器。 */
export const BROWSER_ABSTRACTIONS: BrowserAbstraction[] = GRAPH_ROLES.map((role) => buildAbstractionsForRole(role))

export const lastHomeworkCard = shallowRef<HomeworkCardSnap | null>(null)
export const lastSiteCard = shallowRef<SiteCard | null>(null)
export const abstractionParsing = ref(false)
export const abstractionMenuOpen = ref(false)
export const currentBrowserUrl = ref('')
export const currentBrowserId = ref('')

export const publishHomeworkCard = (card: HomeworkCardSnap | null) => {
  lastHomeworkCard.value = card
}

const clickableCount = (card: SiteCard | null) => {
  if (!card || card.ok === false) return 0
  return (card.handles?.length || 0) + (card.jobs?.length || 0) + (card.chapters?.length || 0)
    + (card.questions?.length || 0) + (card.works?.length || 0) + (Number(card.questionCount) || 0)
}

export const publishSiteCard = (card: SiteCard | null) => {
  if (card && clickableCount(card) === 0) {
    const prev = lastSiteCard.value
    if (prev && clickableCount(prev) > 0) {
      const same = !card.url || !prev.url || card.url === prev.url
      if (same) return
    }
    lastSiteCard.value = null
    return
  }
  lastSiteCard.value = card
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

export const setCurrentBrowserPage = (id: string, url: string) => {
  const prevHost = hostOf(currentBrowserUrl.value)
  currentBrowserId.value = id
  currentBrowserUrl.value = url
  const nextHost = hostOf(url)
  if (prevHost && nextHost && prevHost !== nextHost) lastSiteCard.value = null
}

export const abstractionRole = (layer: { id?: string; role?: BrowserAbstractionRole } | null | undefined): BrowserAbstractionRole | null => {
  if (!layer) return null
  if (layer.role) return layer.role
  const id = String(layer.id || '')
  if (id === 'homework' || id.endsWith('-homework') || id === 'chaoxing-homework') return 'homework'
  if (id === 'study' || id.endsWith('-study') || id === 'chaoxing-study') return 'study'
  if (id === 'login' || id.endsWith('-login') || id === 'chaoxing-login') return 'login'
  if (id === 'course' || id.endsWith('-course') || id === 'chaoxing-course') return 'course'
  if (id === 'captcha' || id.endsWith('-captcha') || id === 'chaoxing-captcha') return 'captcha'
  return null
}

/** 跟页面身份走。播放页是章节；本节测验靠 abstractionDrill 钻入，不改主角色。 */
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
  const onGraph = Boolean(siteGraphForUrl(url))
  const visible = onGraph ? BROWSER_ABSTRACTIONS : (primary ? [primary] : [])
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
    if (item.role === 'course' && lastSiteCard.value?.current) {
      preview = `当前「${lastSiteCard.value.current}」`
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

export const parserPageKind = (url: string) => parserPageKindOf(siteGraphNodeForUrl(url))

export const abstractionButtonLabel = computed(() => {
  const href = currentBrowserUrl.value
  const kind = parserPageKind(href)
  if (kind === 'study') return '章节'
  if (kind === 'homework') return '题卡'
  const site = lastSiteCard.value
  if (site?.ok) return site.title || site.page || '解析'
  const node = siteGraphNodeForUrl(href)
  if (kind === 'site') return node?.title || '解析'
  return '解析'
})

/** 有内容解析器的节点才显示入口。登录、验证码、没写 parserIds 的页隐藏。 */
export const abstractionButtonVisible = computed(() => {
  if (lastSiteCard.value?.ok) return true
  return contentParserIdsOf(siteGraphNodeForUrl(currentBrowserUrl.value)).length > 0
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
  const href = currentBrowserUrl.value
  const kind = parserPageKind(href)
  if (kind === 'study') return '章节'
  if (kind === 'homework') return '题卡'
  const site = lastSiteCard.value
  if (site?.ok) return site.title || site.page || '解析'
  return siteGraphNodeForUrl(href)?.title || '解析'
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
  const site = lastSiteCard.value
  if ((!layer || !role) && site?.ok) {
    const works = (site.works || []).slice(0, 16)
    const title = String(site.title || site.page || '解析')
    const list = works.length
      ? `<ul class="ze-abs-works">${works.map((work) =>
          `<li><span>${esc(String(work.title || ''))}</span><span>${esc(String(work.status || ''))}</span></li>`).join('')}</ul>`
      : `<div class="ze-abs-empty">${esc(String(site.hint || '看快照，用 ref 点'))}</div>`
    return `<article class="ze-abs-card is-current">
      <header class="ze-abs-head">
        <div>
          <div class="ze-abs-title">${esc(title)}</div>
          <div class="ze-abs-sub">${works.length ? `${works.length} 项` : esc(site.hint || '')}</div>
        </div>
      </header>
      ${list}
    </article>`
  }
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
