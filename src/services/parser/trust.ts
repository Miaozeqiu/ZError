import { isHomeworkUrl, isStudyUrl, lastHomeworkCard } from '../browser/abstractions'
import { packAgentPanel } from '../chaoxing/browser/panelStudy'
import type { SiteCard } from './types'

const PROBES = new Map<string, number>()

export const cardConfidence = (card: SiteCard | Record<string, unknown> | null | undefined) => {
  if (!card || card.ok === false) return 0
  const listed = Number((card as { confidence?: unknown }).confidence)
  if (Number.isFinite(listed) && listed > 0) return Math.min(1, listed)
  const questions = Number((card as { questionCount?: unknown }).questionCount)
    || (Array.isArray((card as { questions?: unknown[] }).questions) ? (card as { questions: unknown[] }).questions.length : 0)
  const chapters = Array.isArray((card as { chapters?: unknown[] }).chapters)
    ? (card as { chapters: unknown[] }).chapters.length
    : 0
  const works = Number((card as { pendingCount?: unknown }).pendingCount)
    || (Array.isArray((card as { works?: unknown[] }).works) ? (card as { works: unknown[] }).works.length : 0)
    || (Array.isArray((card as { pending?: unknown[] }).pending) ? (card as { pending: unknown[] }).pending.length : 0)
  const jobs = Array.isArray((card as { jobs?: unknown[] }).jobs) ? (card as { jobs: unknown[] }).jobs.length : 0
  if (questions > 0 || chapters > 0 || works > 0 || jobs > 0) return 0.9
  return 0.2
}

export const cardIsTrusted = (card: SiteCard | Record<string, unknown> | null | undefined) => (
  Boolean(card) && card?.ok !== false && cardConfidence(card) >= 0.6
)

export type TrustedCardSnap = {
  ok: true
  kind: string
  page?: string
  next?: string
  confidence: number
  questionCount?: number
  pendingCount?: number
  unfinishedCount?: number
  current?: string
  chapters?: number
  hint?: string
}

export const slimTrustedCard = (card: TrustedCardSnap | SiteCard | Record<string, unknown>) => ({
  ok: true,
  kind: String((card as { kind?: unknown }).kind || ''),
  page: (card as { page?: unknown }).page == null ? undefined : String((card as { page: unknown }).page),
  next: (card as { next?: unknown }).next == null ? undefined : String((card as { next: unknown }).next),
  confidence: cardConfidence(card),
  questionCount: Number((card as { questionCount?: unknown }).questionCount) || undefined,
  pendingCount: Number((card as { pendingCount?: unknown }).pendingCount) || undefined,
  unfinishedCount: Number((card as { unfinishedCount?: unknown }).unfinishedCount) || undefined,
  current: (card as { current?: unknown }).current == null ? undefined : String((card as { current: unknown }).current),
  chapters: Array.isArray((card as { chapters?: unknown[] }).chapters)
    ? (card as { chapters: unknown[] }).chapters.length
    : Number((card as { chapters?: unknown }).chapters) || undefined,
  hint: (card as { hint?: unknown }).hint == null ? undefined : String((card as { hint: unknown }).hint),
})

export const liveTrustedCard = (browserId: string, url = ''): TrustedCardSnap | null => {
  const homework = lastHomeworkCard.value
  if (homework && (!url || isHomeworkUrl(url)) && cardIsTrusted({
    ok: true,
    questionCount: homework.questionCount || homework.questions?.length || 0,
    pendingCount: homework.pendingCount || homework.pending?.length || homework.works?.length || 0,
  })) {
    return {
      ok: true,
      kind: 'homework',
      page: homework.page,
      next: homework.next,
      confidence: 0.9,
      questionCount: homework.questionCount || homework.questions?.length || 0,
      pendingCount: homework.pendingCount || homework.pending?.length || 0,
      hint: homework.hint,
    }
  }
  const panel = packAgentPanel(browserId)
  if (panel && (!url || isStudyUrl(url)) && cardIsTrusted({
    ok: true,
    chapters: panel.chapters || [],
    unfinishedCount: panel.unfinishedCount,
    jobs: panel.thisSection?.jobs || [],
  })) {
    return {
      ok: true,
      kind: 'study',
      page: 'study',
      next: panel.thisSection?.next?.label,
      confidence: 0.9,
      unfinishedCount: Number(panel.unfinishedCount) || panel.unfinishedSections?.length || 0,
      current: panel.current,
      chapters: panel.chapters?.length || 0,
      hint: panel.hint,
    }
  }
  return null
}

export const notePageProbe = (browserId: string) => {
  const next = (PROBES.get(browserId) || 0) + 1
  PROBES.set(browserId, next)
  return next
}

export const resetPageProbe = (browserId: string) => {
  PROBES.delete(browserId)
}

export const pageProbeCount = (browserId: string) => PROBES.get(browserId) || 0

export const trustedCardBlock = (card: TrustedCardSnap) => ({
  blocked: true,
  reason: 'parser-card',
  card: slimTrustedCard(card),
  hint: card.kind === 'study'
    ? '解析器已读到目录/任务点。用 browser_study_chapters / play / next，不要 get_page / eval 扒 DOM。'
    : '解析器已出题卡。用 browser_homework 的 list / inspect / fill，不要 get_page / eval 扒 DOM。',
})
