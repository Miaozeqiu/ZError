import source from './homework/courseAnswers.js?raw'
import { pageScript } from './pageScript'
import type { HomeworkQuestionRange } from '../../agent/homeworkQuestionRange'

export type HomeworkKind = 'single' | 'multiple' | 'judgement' | 'completion'
export type PageHomeworkQuestion = {
  id: string | null
  order: number
  number: number
  stem: string
  type: HomeworkKind | 'unsupported'
  issue: string | null
  options: Array<{ label: string; text: string; selected: boolean; selector: string | null }>
  blanks: Array<{ text: string; selector: string | null; maxLength: number }>
}
export type PageHomework = { url: string; title?: string; documentTime?: number; total: number; scopeTotal?: number; scopeAmbiguous?: boolean; questions: PageHomeworkQuestion[] }

export const courseHomeworkReadScript = (offset: number, limit: number, targetId?: string, range?: HomeworkQuestionRange, chapterQuiz = false) =>
  pageScript(source, `return readCourseHomework(document, ${offset}, ${limit}, ${JSON.stringify(targetId ?? null)}, ${JSON.stringify(range ?? null)}, ${chapterQuiz});`)
