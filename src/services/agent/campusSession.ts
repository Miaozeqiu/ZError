import {
  campusQuestionTypeLabel,
  createCampusPaper,
  formatCampusOptions,
  listFolderQuestions,
  type CampusQuestion,
} from '../app/campus'
import {
  campusFail,
  campusTagArg,
  resolveCampusCourse,
  resolveCampusPaper,
  resolveCampusTagId,
} from './campusResolve'
import { saveQuizCards, saveQuizTitle, type QuizCard } from '../../utils/question/quizPractice'

type CampusPaperCache = { id: number; name: string; courseName?: string; courseId?: number }

type CampusSessionCache = {
  questions: CampusQuestion[]
  papers: CampusPaperCache[]
}

const campusBySession = new Map<string, CampusSessionCache>()

export const campusCacheOf = (sessionId: string): CampusSessionCache => {
  const current = campusBySession.get(sessionId)
  if (current) return current
  const created = { questions: [] as CampusQuestion[], papers: [] as CampusSessionCache['papers'] }
  campusBySession.set(sessionId, created)
  return created
}

export const rememberCampusPapers = (sessionId: string, papers: CampusPaperCache[]) => {
  const cache = campusCacheOf(sessionId)
  for (const paper of papers) {
    const index = cache.papers.findIndex((item) => item.id === paper.id)
    if (index >= 0) cache.papers[index] = { ...cache.papers[index], ...paper }
    else cache.papers.push(paper)
  }
}

export const rememberCampusQuestions = (sessionId: string, questions: CampusQuestion[], paper?: CampusPaperCache) => {
  const cache = campusCacheOf(sessionId)
  const seen = new Set(questions.map((item) => item.id))
  cache.questions = [...questions, ...cache.questions.filter((item) => !seen.has(item.id))]
  if (paper?.id) rememberCampusPapers(sessionId, [paper])
}

export const parseCampusQuestionIds = (args: any) => {
  const fromArgs = args?.campus_question_ids ?? args?.campus_question_id
  const list = Array.isArray(fromArgs) ? fromArgs : fromArgs != null ? [fromArgs] : []
  if (Array.isArray(args?.questions)) {
    for (const item of args.questions) {
      const id = Number(item?.campus_question_id)
      if (Number.isFinite(id) && id > 0) list.push(id)
    }
  }
  return [...new Set(list.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0))]
}

export const campusQuestionToCard = (item: CampusQuestion): QuizCard => ({
  uid: `c-${item.id}`,
  question: item.content,
  options: formatCampusOptions(item.options),
  answer: item.answer,
  question_type: campusQuestionTypeLabel(item.type),
})

export const publishCampusQuestionCards = (stepId: string, questions: CampusQuestion[], title: string) => {
  const cards = questions.slice(0, 10).map(campusQuestionToCard)
  if (!cards.length) return []
  saveQuizCards(stepId, cards)
  saveQuizTitle(stepId, title || '校园题')
  return cards
}

export const resolveCampusWriteTarget = async (
  sessionId: string,
  campusId: number,
  args: any,
  opts?: { createPaper?: boolean; paperName?: string },
) => {
  const cache = campusCacheOf(sessionId)
  let paperId = Number(args.paper_id ?? args.folder_id)
  let paperName = String(opts?.paperName || args.paper_name || args.folder_name || '').trim()
  if (!(Number.isFinite(paperId) && paperId > 0) && !paperName && cache.papers.length === 1) {
    paperId = cache.papers[0].id
    paperName = cache.papers[0].name
  }
  const known = Number.isFinite(paperId) && paperId > 0
    ? cache.papers.find((item) => item.id === paperId)
    : paperName
      ? cache.papers.find((item) => item.name === paperName)
      : undefined
  const course = await resolveCampusCourse(
    campusId,
    Number(args.course_id) || known?.courseId || undefined,
    String(args.course_name || '').trim() || known?.courseName || undefined,
  )
  if (!course) {
    return { error: '请提供 course_id 或 course_name，或先 list_campus_papers' as const }
  }
  const remember = (paper: { id: number; name: string }) => {
    rememberCampusPapers(sessionId, [{
      id: paper.id,
      name: paper.name,
      courseName: course.name,
      courseId: course.id,
    }])
  }
  if (Number.isFinite(paperId) && paperId > 0) {
    try {
      const resolved = await resolveCampusPaper(course.id, paperId)
      remember(resolved.paper)
      return { course, paper: resolved.paper, createdPaper: false }
    } catch {
      const paper = { id: paperId, name: paperName || known?.name || `试卷 ${paperId}` }
      remember(paper)
      return { course, paper, createdPaper: false }
    }
  }
  if (!paperName) return { error: '请提供 paper_id 或 paper_name' as const }
  try {
    const resolved = await resolveCampusPaper(course.id, undefined, paperName)
    if (resolved.paper) {
      remember(resolved.paper)
      return { course, paper: resolved.paper, createdPaper: false }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (opts?.createPaper === false || /有多/.test(msg)) {
      return { error: campusFail(err, msg || `没有找到试卷「${paperName}」`), course }
    }
  }
  if (opts?.createPaper === false) {
    return { error: `没有找到试卷「${paperName}」` as const, course }
  }
  const tagId = await resolveCampusTagId(
    Number(args.tag_id) || undefined,
    campusTagArg(args) || undefined,
  )
  const paper = await createCampusPaper(course.id, paperName, tagId)
  remember(paper)
  return { course, paper, createdPaper: true }
}

export const resolveCampusQuizCards = async (sessionId: string, args: any): Promise<{ cards: QuizCard[]; title: string }> => {
  const ids = parseCampusQuestionIds(args)
  const paperId = Number(args.paper_id)
  const cache = campusCacheOf(sessionId)
  let questions: CampusQuestion[] = []
  let paperName = String(args.paper_name || args.title || '').trim()
  let courseName = String(args.course_name || '').trim()

  if (Number.isFinite(paperId) && paperId > 0) {
    questions = await listFolderQuestions(paperId)
    const known = cache.papers.find((item) => item.id === paperId)
    paperName = paperName || known?.name || ''
    courseName = courseName || known?.courseName || ''
    rememberCampusQuestions(sessionId, questions, { id: paperId, name: paperName || `试卷 ${paperId}`, courseName })
  } else if (ids.length) {
    const byId = new Map(cache.questions.map((item) => [item.id, item]))
    questions = ids.map((id) => byId.get(id)).filter((item): item is CampusQuestion => Boolean(item))
    if (questions.length < ids.length && cache.papers.length === 1) {
      const only = cache.papers[0]
      const fetched = await listFolderQuestions(only.id)
      rememberCampusQuestions(sessionId, fetched, only)
      const next = new Map(campusCacheOf(sessionId).questions.map((item) => [item.id, item]))
      questions = ids.map((id) => next.get(id)).filter((item): item is CampusQuestion => Boolean(item))
      paperName = paperName || only.name
      courseName = courseName || only.courseName || ''
    }
  }

  if (ids.length) {
    const want = new Set(ids)
    questions = questions.filter((item) => want.has(item.id))
  }

  const knownPaper = cache.papers.find((item) => questions.some((question) => question.question_bank_id === item.id))
  paperName = paperName || knownPaper?.name || ''
  courseName = courseName || knownPaper?.courseName || ''
  const title = paperName || (courseName ? `${courseName}校园题` : '')
  return {
    cards: questions.slice(0, 10).map(campusQuestionToCard),
    title,
  }
}
