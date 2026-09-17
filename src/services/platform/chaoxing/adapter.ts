import { chaoxingHomeworkEngine } from '../../chaoxing/homework'
import { runPanelHomework } from '../../chaoxing/homework/panelHomework'
import { startChaoxingChapterParser } from '../../chaoxing/browser/chapters'
import { nextPanelStudy, playPanelStudy } from '../../chaoxing/browser/panelStudy'
import { startChaoxingWatch, videoWatchFor } from '../../chaoxing/browser/watch'
import { clearPendingCaptcha, runAfterCaptcha } from '../../chaoxing/browser/watchAgent'
import {
  fillChaoxingCaptcha,
  openChaoxingChapters,
  readChaoxingVideo,
  videoIsPlaying,
} from '../../chaoxing/study'
import {
  siteGraphForUrl,
  siteGraphNodeForUrl,
  activeFrameOf,
} from '../../browser/siteGraphCore'
import type { HomeworkToolArgs, PlatformAdapter, PlatformRole, StudyPlayOptions } from '../types'

const isChaoxing = (url: string) => {
  const site = siteGraphForUrl(url)
  if (site) return site.id === 'chaoxing'
  return /chaoxing\.com/i.test(url)
}

const nodeId = (url: string) => siteGraphNodeForUrl(url)?.id || ''

const courseTab = (url: string) => {
  const node = siteGraphNodeForUrl(url)
  if (node?.id !== 'course') return ''
  return String(activeFrameOf(node, url)?.id || activeFrameOf(node, url)?.tab || '')
}

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
  // 播放页内嵌测验不是独立作答页
  if (/studentstudy|studentcourse|knowledge\/cards|ananas|insertcourse|passport2/i.test(url)) return false
  return /doHomeWork|\/work\/do(?:work)?(?:[/?#]|$)|\/work\/phone\/do|dowork|do-work/i.test(url)
}

const isHomeworkListUrl = (url: string) => {
  if (!isChaoxing(url) || isHomeworkDoUrl(url) || isPlayerUrl(url)) return false
  const id = nodeId(url)
  if (id === 'course') {
    const tab = courseTab(url)
    if (tab === 'homework' || tab === '作业') return true
  }
  if (id === 'homework-list') return true
  if (/\/mycourse\/stu/i.test(url) && /(?:^|[?&])pageHeader=8(?:&|$)/i.test(url)) return true
  if (/\/work\/(?:list|index|view)(?:[/?#]|$)/i.test(url)) return true
  if (/mooc2-ans\.chaoxing\.com\/[^?\s]*\/work(?:\/|\?|$)/i.test(url)) return true
  return false
}

const isHomeworkUrl = (url: string) => {
  if (isHomeworkDoUrl(url) || isHomeworkListUrl(url)) return true
  const node = siteGraphNodeForUrl(url)
  if (node) return node.parserIds.includes('homework') && node.id !== 'study'
  return false
}
const isChapterWorkUrl = (url: string) => isPlayerUrl(url)
const canUseHomeworkTools = (url: string) => isHomeworkUrl(url) || isChapterWorkUrl(url)
const isCourseChapterTab = (url: string) => {
  if (isPlayerUrl(url) || !isCourseUrl(url)) return false
  const tab = courseTab(url)
  if (tab === 'chapters' || tab === '章节') return true
  return /(?:^|[?&])pageHeader=1(?:&|$)|studentcourse/i.test(url)
}

const isStudyUrl = (url: string) => {
  if (isPlayerUrl(url) || isCourseChapterTab(url)) return true
  const node = siteGraphNodeForUrl(url)
  if (node) return node.id !== 'course' && node.parserIds.includes('study')
  return isChaoxing(url) && /knowledge/i.test(url) && !isHomeworkUrl(url)
}
const isLoginUrl = (url: string) => {
  const node = siteGraphNodeForUrl(url)
  if (node) return node.id === 'login' || node.parserIds.includes('login')
  return /passport2\.chaoxing\.com/i.test(url)
}

const roleOf = (url: string): PlatformRole | null => {
  const node = siteGraphNodeForUrl(url)
  if (node?.id === 'course') {
    if (isCourseChapterTab(url)) return 'study'
    if (isHomeworkListUrl(url)) return 'homework'
    return null
  }
  if (node) {
    const role = node.parserIds.find((id): id is PlatformRole => (
      id === 'login' || id === 'study' || id === 'homework' || id === 'captcha'
    ))
    return role || null
  }
  if (isLoginUrl(url)) return 'login'
  if (isHomeworkUrl(url)) return 'homework'
  if (isStudyUrl(url)) return 'study'
  return null
}

const stripHwImages = (card: Awaited<ReturnType<typeof chaoxingHomeworkEngine.inspect>>) => {
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
  const result = await runPanelHomework(browserId, args)
  if (result && typeof result === 'object' && 'questions' in result) {
    return stripHwImages(result as Awaited<ReturnType<typeof chaoxingHomeworkEngine.inspect>>)
  }
  return result
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
  playVideo: async (browserId, options?: StudyPlayOptions) => {
    return await playPanelStudy(browserId, {
      action: options?.action,
      videoIndex: options?.videoIndex,
      label: options?.label,
      skipIfDone: options?.skipIfDone,
      resume: options?.skipTabClick === true,
    }) as Record<string, unknown>
  },
  readVideo: async (browserId) => (
    (await readChaoxingVideo(browserId)) as Record<string, unknown> | null
  ),
  openNext: async (browserId) => (
    (await nextPanelStudy(browserId)) as Record<string, unknown>
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
