import { describe, expect, it } from 'vitest'
import { listBundledSkillFiles, readBundledSkillFile } from '../../src/services/agent/skills/builtinSkillAssets'
import { isBuiltinRuntimeSkillFile } from '../../src/services/agent/skillRuntimeFiles'
import { nextSkillFileHint, skillFileWriteError } from '../../src/services/agent/agentSkills'

describe('builtin website resources for end users', () => {
  it('bundles the generic learning workflow without official website experience', () => {
    expect(listBundledSkillFiles('chaoxing')).toEqual([])
    expect(readBundledSkillFile('chaoxing', 'site-graph.json')).toBeNull()
    const files = listBundledSkillFiles('site-learn')
    expect(files).toContain('SKILL.md')
    expect(files.every(isBuiltinRuntimeSkillFile)).toBe(true)
    expect(files.some(file => /^sites\//.test(file))).toBe(false)
  })

  it('does not recommend stale samples even if an old path is supplied', () => {
    const hint = nextSkillFileHint('site-learn', 'sites/zjooc.cn/SKILL.md', ['sites/zjooc.cn/SKILL.md', 'sites/zjooc.cn/fixtures/page.html'])
    expect(hint).toContain('当前网页验证')
    expect(hint).not.toContain('fixtures')
    expect(hint).not.toContain('样例页')
  })

  it('rejects test pages and old parser artifacts while preserving standard installed Skill behavior', () => {
    for (const path of ['fixtures/page.html', 'sites/example.com/fixtures/page.md', 'sites/example.com/parsers/study/see.json', 'sites/example.com/schema.json', 'sites/example.com/page.html']) {
      expect(isBuiltinRuntimeSkillFile(path)).toBe(false)
      expect(skillFileWriteError('site-learn', path)).toContain('当前网页验证')
    }
    expect(skillFileWriteError('external-skill', 'assets/example.html')).toBeNull()
    expect(skillFileWriteError('site-learn', 'sites/example.com/SKILL.md')).toBeNull()
    expect(skillFileWriteError('site-learn', 'sites/example.com/course.json')).toBeNull()
  })
})
