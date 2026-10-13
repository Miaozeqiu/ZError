import { describe, expect, it } from 'vitest'
import { placeSiteLearnPath } from '../../src/services/agent/agentSkills'

describe('site-learn 文件路径', () => {
  it('解析器路径改去写 SKILL.md', () => {
    const placed = placeSiteLearnPath('parsers/study/see.json', 'zjooc.cn')
    expect(placed.error).toContain('sites/zjooc.cn/SKILL.md')
    expect(placed.error).toContain('不要写解析器')
  })

  it('schema / locators 同样不写', () => {
    const schema = placeSiteLearnPath('parsers/study/schema.json', 'zjooc.cn')
    const locators = placeSiteLearnPath('sites/zjooc.cn/parsers/study/locators.json', 'zjooc.cn')
    expect(schema.error).toContain('SKILL.md')
    expect(locators.error).toContain('SKILL.md')
  })

  it('已经带 sites/ 的 SKILL 路径不动', () => {
    const placed = placeSiteLearnPath('sites/zjooc.cn/SKILL.md', 'zjooc.cn')
    expect(placed.path).toBe('sites/zjooc.cn/SKILL.md')
    expect(placed.error).toBeUndefined()
  })
})
