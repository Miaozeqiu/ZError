import { describe, expect, it } from 'vitest'
import {
  buildUrlOptionMapForMode,
  buildUrlQuestionPromptParts,
  countCompletionBlanks,
  normalizeCompletionAnswer,
  resolveUrlAnswer,
} from '../../src/utils/answer/urlQuestion'

describe('countCompletionBlanks', () => {
  it('统计下划线空', () => {
    expect(countCompletionBlanks('中国的首都是____，最大的城市是____。')).toBe(2)
  })

  it('统计全角/半角括号空', () => {
    expect(countCompletionBlanks('（ ）和（  ）')).toBe(2)
    expect(countCompletionBlanks('( ) and ( )')).toBe(2)
  })

  it('没有空时返回 0', () => {
    expect(countCompletionBlanks('请简述牛顿第一定律。')).toBe(0)
  })
})

describe('normalizeCompletionAnswer', () => {
  const twoBlanks = '中国的首都是____，最大的城市是____。'

  it('多空答案用逗号分隔时转成 ###', () => {
    expect(normalizeCompletionAnswer('北京，上海', twoBlanks)).toBe('北京###上海')
  })

  it('多空答案用分号分隔时转成 ###', () => {
    expect(normalizeCompletionAnswer('北京；上海', twoBlanks)).toBe('北京###上海')
  })

  it('分号与逗号混用也能按空数拆开', () => {
    expect(
      normalizeCompletionAnswer('北京；上海，广州', '____；____；____')
    ).toBe('北京###上海###广州')
  })

  it('已有 ### 时只做去空格整理', () => {
    expect(normalizeCompletionAnswer(' 北京 ### 上海 ', twoBlanks)).toBe('北京###上海')
  })

  it('单空答案里的逗号保持原样', () => {
    expect(normalizeCompletionAnswer('北京，上海', '首都是____。')).toBe('北京，上海')
  })

  it('分隔段数与空数不一致时不拆，避免误断', () => {
    expect(normalizeCompletionAnswer('A，B，C', twoBlanks)).toBe('A，B，C')
  })

  it('纯数字千分位不会被逗号拆开', () => {
    expect(normalizeCompletionAnswer('1,000', twoBlanks)).toBe('1,000')
  })
})

describe('resolveUrlAnswer open 模式', () => {
  it('从 ANSWER 行取答案并按题干空数归一化分隔符', () => {
    const response = '推理过程……\nANSWER: 北京，上海'
    expect(resolveUrlAnswer(response, new Map(), 'open', '____，____')).toBe('北京###上海')
  })

  it('单空题目不改写答案', () => {
    const response = 'ANSWER: 北京，上海'
    expect(resolveUrlAnswer(response, new Map(), 'open', '首都是____')).toBe('北京，上海')
  })
})

describe('resolveUrlAnswer 选择题回归', () => {
  it('多选字母仍映射为选项正文并用 ### 连接', () => {
    const options = 'A. 键盘\nB. 显示器\nC. 鼠标'
    const optionMap = buildUrlOptionMapForMode('multiple', options)
    expect(resolveUrlAnswer('ANSWER: A C', optionMap, 'multiple')).toBe('键盘###鼠标')
  })
})

describe('buildUrlQuestionPromptParts', () => {
  it('填空/简答规则要求多空用 ### 分隔', () => {
    const { answerRule } = buildUrlQuestionPromptParts('open', '', new Map(), '填空题')
    expect(answerRule).toContain('###')
  })
})


describe('completion answer position and numeric regressions', () => {
  it('keeps missing leading, middle and trailing answers in their original slots', () => {
    expect(normalizeCompletionAnswer('甲######丙', '____ ____ ____')).toBe('甲######丙')
    expect(normalizeCompletionAnswer('###乙###', '____ ____ ____')).toBe('###乙###')
    expect(normalizeCompletionAnswer('######', '____ ____ ____')).toBe('######')
    expect(normalizeCompletionAnswer('；乙', '____ ____')).toBe('###乙')
  })
  it('does not count thousands commas as extra answers in mixed separators', () => {
    expect(normalizeCompletionAnswer('1,000；甲', '____ ____ ____')).toBe('1,000；甲')
    expect(normalizeCompletionAnswer('1,000；甲，乙', '____ ____ ____')).toBe('1,000###甲###乙')
    expect(normalizeCompletionAnswer('-1,000', '____ ____')).toBe('-1,000')
    expect(normalizeCompletionAnswer('1,000，2,000', '____ ____')).toBe('1,000###2,000')
    expect(normalizeCompletionAnswer('-1,000.25；+2,000.50', '____ ____')).toBe('-1,000.25###+2,000.50')
  })
})
