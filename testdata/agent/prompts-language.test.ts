import { describe, expect, it } from 'vitest'
import { buildBrowserSystemPrompt, buildLearningSystemPrompt } from '../../src/services/agent/prompts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundled = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../src/services/agent/skills/bundled')

describe('agent language', () => {
  it('浏览器系统提示用中文说怎么做', () => {
    const text = buildBrowserSystemPrompt()
    expect(text).toMatch(/用中文/)
    expect(text).toMatch(/不要写英文句子/)
    expect(text).not.toMatch(/字段名可保留英文/)
    expect(text).toMatch(/怎么做/)
    expect(text).toMatch(/索引，不是全文/)
    expect(text).toMatch(/SKILL\.md/)
    expect(text).not.toMatch(/see\.json/)
    expect(text).toMatch(/browser_watch/)
    expect(text).toMatch(/不能改播当前条/)
    expect(text).not.toMatch(/绕过解析器/)
  })

  it('学习系统提示用中文说怎么做', () => {
    expect(buildLearningSystemPrompt()).toMatch(/用中文/)
    expect(buildLearningSystemPrompt()).toMatch(/怎么做/)
  })
})

describe('skill 渐进披露', () => {
  it('site-learn 主文件指向本站 SKILL 和 workflow，不塞别站细则', () => {
    const text = readFileSync(resolve(bundled, 'site-learn/SKILL.md'), 'utf8')
    expect(text).toContain('sites/<当前网址主机>/SKILL.md')
    expect(text).toContain('references/workflow.md')
    expect(text).not.toContain('zhihuishu.com/parsers')
    expect(text).not.toContain('## 不要做')
  })

  it('site-learn workflow 写经验，不写解析器', () => {
    const text = readFileSync(resolve(bundled, 'site-learn/references/workflow.md'), 'utf8')
    expect(text).toContain('SKILL.md')
    expect(text).toContain('哪一页')
    expect(text).not.toContain('see.json')
  })

  it('chaoxing 主文件只留索引，细则在 references', () => {
    const text = readFileSync(resolve(bundled, 'chaoxing/SKILL.md'), 'utf8')
    expect(text).toContain('references/study.md')
    expect(text).not.toContain('schema.catalog.json')
    expect(text).not.toContain('禁止 eval')
  })

  it('read_agent_skill 只露出 SKILL 和本站入口，不列出 see.json', async () => {
    const { listBundledSkillFiles } = await import('../../src/services/agent/skills/builtinSkillAssets')
    const { nextSkillFileHint, skillSurfaceFiles } = await import('../../src/services/agent/agentSkills')
    const all = listBundledSkillFiles('site-learn')
    const surface = skillSurfaceFiles(all)
    expect(surface).toContain('SKILL.md')
    expect(surface).toContain('sites/zjooc.cn/SKILL.md')
    expect(surface).toContain('sites/zhihuishu.com/SKILL.md')
    expect(surface).toContain('references/workflow.md')
    expect(surface.some((file) => file.includes('see.json'))).toBe(false)
    expect(surface.some((file) => file.includes('fixtures/'))).toBe(false)
    expect(nextSkillFileHint('site-learn', 'sites/zjooc.cn/SKILL.md', all)).toMatch(/SKILL\.md/)
    expect(nextSkillFileHint('site-learn', 'sites/zjooc.cn/SKILL.md', all)).toMatch(/zjooc\.cn/)
    expect(nextSkillFileHint('site-learn', 'sites/zjooc.cn/SKILL.md', all)).toMatch(/其中一条/)
  })
})
