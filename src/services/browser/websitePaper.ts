import { evalBrowserViewMain } from './eval'
import paperPage from './websitePaperPage.js?raw'

export type WebsiteQuestion = {
  index: number; number: number; subjectType: number; stem: string; type: 'single' | 'multiple' | 'judgement' | 'completion'
  options: { label: string; text: string }[]; blanks: number; actual: string[]; official: string; supported: boolean
}
export type WebsitePaper = {
  key: string; url: string; courseId: string; kind: string; stage: string; paperId: string; title: string
  declared: number; total: number; scopeTotal: number; ambiguous: boolean; hasNext: boolean; single: boolean; questions: WebsiteQuestion[]
}

const stringFields = [
  'singleKind', 'exerciseStage', 'reviewStage', 'reviewReady', 'singleRows', 'rows', 'title', 'singleNumber',
  'rowNumber', 'stem', 'fields', 'choices', 'choiceText', 'questionGroup', 'excluded', 'questionBody',
  'reviewMarker', 'reviewLabel', 'reviewAnswer', 'alternateMultipleLabel', 'totalLabels', 'indexItems', 'next', 'nextLabel',
] as const
type PaperRules = Record<(typeof stringFields)[number], string> & {
  routes: string[][]; optionalSuffix?: string; kinds: string[]; judgeLabels: string[]; unsupportedGroups: string[]
  subjectTypes: Record<'alternate' | WebsiteQuestion['type'], number>
}
export function websitePaperRules(value: unknown): PaperRules {
  const rule = value as PaperRules | null
  const parameters = [':course', ':kind', ':stage', ':paper']
  if (!rule || stringFields.some(key => typeof rule[key] !== 'string' || !rule[key] || rule[key].length > 512)
    || !Array.isArray(rule.routes) || !rule.routes.length || rule.routes.length > 8
    || rule.routes.some(route => !Array.isArray(route) || route.length > 16
      || route.some(part => typeof part !== 'string' || (!parameters.includes(part) && !/^[a-zA-Z0-9_-]{1,64}$/.test(part)))
      || parameters.some(parameter => route.filter(part => part === parameter).length !== 1))
    || (rule.optionalSuffix !== undefined && (typeof rule.optionalSuffix !== 'string' || !/^[\w-]{1,64}$/.test(rule.optionalSuffix)))
    || [rule.kinds, rule.judgeLabels, rule.unsupportedGroups].some(list => !Array.isArray(list)
      || list.length > 32 || list.some(item => typeof item !== 'string' || !item || item.length > 80))
    || !rule.subjectTypes || ['alternate', 'single', 'multiple', 'judgement', 'completion'].some(key =>
      !Number.isSafeInteger(rule.subjectTypes[key as keyof PaperRules['subjectTypes']]))) {
    throw new Error('网站答题脚本返回了无效的试卷识别规则。')
  }
  return rule
}

export function websitePaperAccess(id: string, host: string, rules: PaperRules) {
  const pageOp = (request: object) => evalBrowserViewMain(id,
    '(' + paperPage + ')(' + [host, rules, request].map(value => JSON.stringify(value)).join(',') + ')')
  return {
    pageOp,
    async read(offset: number, limit: number, range?: { start: number; end: number }): Promise<WebsitePaper> {
      const paper = await pageOp({ offset, limit, range })
      if (!Array.isArray(paper?.questions)) throw new Error(paper?.error || '试卷尚未就绪。')
      return paper
    },
  }
}
