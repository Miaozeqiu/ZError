import source from '../../browser/websiteCourseQuestions.js?raw'
import { pageScript } from './pageScript'
import { runWebsiteScript } from '../../agent/websiteScripts'
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

const selectors = [
  'rows', 'quizRows', 'typeInputs', 'heading', 'quizHeading', 'quizTitleKind', 'quizTitle', 'quizTitleNumber',
  'quizOptions', 'quizChoiceText', 'options', 'optionRow', 'optionMark', 'optionText', 'nested', 'extraStem',
  'visual', 'unreadableFont', 'title',
] as const
type CourseQuestionRules = Record<(typeof selectors)[number], string> & {
  keys: string[]
  labels: Record<HomeworkKind, string[]>
  codes: Record<string, HomeworkKind>
}
const questionKinds: HomeworkKind[] = ['single', 'multiple', 'judgement', 'completion']
function courseQuestionRules(value: unknown) {
  const rules = value as CourseQuestionRules | null
  if (!rules || selectors.some(key => typeof rules[key] !== 'string' || !rules[key] || rules[key].length > 512)
    || !Array.isArray(rules.keys) || !rules.keys.length || rules.keys.length > 8
    || rules.keys.some(key => typeof key !== 'string' || !/^(?:id|questionid|data(?:-[a-z0-9_-]{1,40})?)$/.test(key))
    || !rules.labels || questionKinds.some(kind => {
      const labels = rules.labels[kind]
      return !Array.isArray(labels) || labels.length > 16 || labels.some(label => typeof label !== 'string' || label.length > 80)
    }) || Object.keys(rules.labels).some(kind => !questionKinds.includes(kind as HomeworkKind))
    || !rules.codes || Object.entries(rules.codes).some(([code, kind]) => !/^\d{1,4}$/.test(code) || !questionKinds.includes(kind))) {
    throw new Error('网站脚本返回了无效的课程作答页规则。')
  }
  return rules
}
export const loadCourseHomeworkRules = async () => (await runWebsiteScript('chaoxing.com', 'chaoxing', 'homework',
  { operation: 'page_rules' }, courseQuestionRules, { reuseForMs: 30_000 })).result

export const courseHomeworkReadScript = (
  rules: CourseQuestionRules, offset: number, limit: number, targetId?: string, range?: HomeworkQuestionRange, chapterQuiz = false,
) => pageScript(source, `return readCourseHomework(document, ${offset}, ${limit}, ${JSON.stringify(targetId ?? null)}, ${JSON.stringify(range ?? null)}, ${chapterQuiz}, ${JSON.stringify(rules)});`)
