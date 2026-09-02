import {
  fillChaoxingHomework,
  guessChaoxingHomework,
  inspectChaoxingHomework,
  openChaoxingHomeworkItem,
  openChaoxingHomeworkList,
  saveChaoxingHomework,
  startHomeworkLiveSync,
  submitChaoxingHomework,
} from '../../chaoxing/homework'
import { startChaoxingChapterParser } from '../../chaoxing/browser/chapters'
import { startChaoxingWatch, videoWatchFor } from '../../chaoxing/browser/watch'
import { clearPendingCaptcha, runAfterCaptcha } from '../../chaoxing/browser/watchAgent'
import {
  fillChaoxingCaptcha,
  openChaoxingChapters,
  openNextChaoxingChapter,
  playChaoxingVideo,
  readChaoxingVideo,
  videoIsPlaying,
} from '../../chaoxing/study'
import {
  siteGraphForUrl,
  siteGraphNodeForUrl,
  siteGraphParserIds,
} from '../../browser/siteGraphCore'
import type { HomeworkToolArgs, PlatformAdapter, PlatformRole, StudyPlayOptions } from '../types'

const isChaoxing = (url: string) => Boolean(siteGraphForUrl(url)) || /chaoxing\.com/i.test(url)

const nodeId = (url: string) => siteGraphNodeForUrl(url)?.id || ''
const parsers = (url: string) => siteGraphParserIds(url)

const isPlayerUrl = (url: string) => {
  const id = nodeId(url)
  if (id) return id === 'study'
  return isChaoxing(url) && /studentstudy/i.test(url)
}

const isCourseUrl = (url: string) => {
  const id = nodeId(url)
  if (id) return id === 'course'
  return (
    isChaoxing(url)
    && /\/mycourse\/stu|studentcourse|stucoursemiddle/i.test(url)
    && !isPlayerUrl(url)
  )
}

const isHomeworkDoUrl = (url: string) => {
  const id = nodeId(url)
  if (id) return id === 'homework-do'
  if (!isChaoxing(url)) return false
  if (/studentstudy|studentcourse|knowledge\/cards|ananas|insertcourse|passport2/i.test(url)) return false
  return /doHomeWork|\/work\/do(?:work)?(?:[/?#]|$)|\/work\/phone\/do|dowork|do-work/i.test(url)
}

const isHomeworkListUrl = (url: string) => {
  const id = nodeId(url)
  if (id) return id === 'homework-list'
  if (!isChaoxing(url) || isHomeworkDoUrl(url)) return false
  if (/studentstudy|studentcourse|knowledge\/cards|ananas|passport2/i.test(url)) return false
  if (/\/mycourse\/stu/i.test(url) && /(?:^|[?&])pageHeader=8(?:&|$)/i.test(url)) return true
  if (/\/work\/(?:list|index|view)(?:[/?#]|$)/i.test(url)) return true
  if (/mooc2-ans\.chaoxing\.com\/[^?\s]*\/work(?:\/|\?|$)/i.test(url)) return true
  return false
}

const isHomeworkUrl = (url: string) => {
  if (parsers(url).includes('homework') && nodeId(url) !== 'study') return true
  return isHomeworkDoUrl(url) || isHomeworkListUrl(url)
}
const isChapterWorkUrl = (url: string) => isPlayerUrl(url)
const canUseHomeworkTools = (url: string) => isHomeworkUrl(url) || isChapterWorkUrl(url)
const isStudyUrl = (url: string) => {
  if (parsers(url).includes('study')) return true
  return (
    (isPlayerUrl(url) || isCourseUrl(url) || (isChaoxing(url) && /knowledge/i.test(url)))
    && !isHomeworkUrl(url)
  )
}
const isLoginUrl = (url: string) => {
  if (nodeId(url) === 'login' || parsers(url).includes('login')) return true
  return /passport2\.chaoxing\.com/i.test(url)
}

const roleOf = (url: string): PlatformRole | null => {
  const first = parsers(url)[0]
  if (first) return first
  if (isLoginUrl(url)) return 'login'
  if (isHomeworkUrl(url)) return 'homework'
  if (isStudyUrl(url)) return 'study'
  if (isChaoxing(url)) return 'study'
  return null
}

const stripHwImages = (card: Awaited<ReturnType<typeof inspectChaoxingHomework>>) => {
  const brief = (src?: string) => {
    const s = String(src || '')
    return s.startsWith('data:') ? '［图，已由视觉读成文字］' : s
  }
  return {
    ...card,
    questions: (card.questions || []).map((q) => ({
      ...q,
      images: (q.images || []).map(brief),
      options: (q.options || []).map((opt) => ({
        ...opt,
        image: brief(opt.image),
        images: (opt.images || []).map(brief),
      })),
    })),
  }
}

const runHomework = async (browserId: string, args: HomeworkToolArgs) => {
  const action = args.action
  const withLive = async <T,>(card: T) => {
    await startHomeworkLiveSync(browserId).catch(() => null)
    return card
  }
  if (action === 'list') return withLive(await openChaoxingHomeworkList(browserId))
  if (action === 'inspect') return stripHwImages(await withLive(await inspectChaoxingHomework(browserId)))
  if (action === 'open') {
    const title = String(args.title || '').trim()
    if (!title) return { error: 'open 需要 title' }
    return withLive(await openChaoxingHomeworkItem(browserId, title))
  }
  if (action === 'fill') return withLive(await fillChaoxingHomework(browserId, args.answers))
  if (action === 'guess') return withLive(await guessChaoxingHomework(browserId))
  if (action === 'save') return stripHwImages(await withLive(await saveChaoxingHomework(browserId)))
  if (action === 'submit') return stripHwImages(await withLive(await submitChaoxingHomework(browserId)))
  return { error: 'action 必须是 list / open / inspect / fill / guess / save / submit' }
}

export const chaoxingPlatformAdapter: PlatformAdapter = {
  id: 'chaoxing',
  name: '学习通',
  matchHost: isChaoxing,
  roleOf,
  isPlayerUrl,
  isCourseUrl,
  isHomeworkDoUrl,
  isHomeworkListUrl,
  isHomeworkUrl,
  isChapterWorkUrl,
  canUseHomeworkTools,
  isStudyUrl,
  isLoginUrl,
  openChapters: (browserId) => openChaoxingChapters(browserId),
  playVideo: async (browserId, options?: StudyPlayOptions) => (
    await playChaoxingVideo(browserId, {
      videoIndex: options?.videoIndex,
      label: options?.label,
      skipTabClick: options?.skipTabClick ?? false,
    }) as Record<string, unknown>
  ),
  readVideo: async (browserId) => (
    (await readChaoxingVideo(browserId)) as Record<string, unknown> | null
  ),
  openNext: async (browserId) => (
    (await openNextChaoxingChapter(browserId)) as Record<string, unknown>
  ),
  videoIsPlaying: (snap) => videoIsPlaying(snap as never),
  startWatch: (browserId, sessionId, snap, options) => {
    startChaoxingWatch(browserId, sessionId, snap as never, options)
  },
  videoWatchFor: (browserId) => videoWatchFor(browserId),
  startChapterParser: (browserId) => {
    startChaoxingChapterParser(browserId)
  },
  runHomework,
  fillCaptcha: async (browserId, code) => (
    (await fillChaoxingCaptcha(browserId, code)) as Record<string, unknown>
  ),
  clearPendingCaptcha,
  runAfterCaptcha,
  roleLabel: (role) => {
    if (role === 'login') return '登录'
    if (role === 'study') return '章节'
    if (role === 'homework') return '题卡'
    return '验证码'
  },
  skillHint: 'chaoxing',
}
