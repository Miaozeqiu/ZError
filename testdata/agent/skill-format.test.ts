import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeLegacySkillMarkdown, parseSkillFrontmatter, prepareSkillMarkdown, validateSkillMarkdown } from '../../src/services/agent/skillFormat'

const skill = (header: string, body = '\n# 正文\n\n保留  空格。\n') => `---\n${header}\n---\n${body}`

describe('Agent Skills format', () => {
  it('reads real YAML: quoted comments, folded/literal blocks and nested metadata', () => {
    const result = parseSkillFrontmatter(skill(`name: example
description: >-
  第一行
  第二行
compatibility: |
  ZError
  browser tools
license: "MIT # not a comment"
allowed-tools: browser_get_state browser_click
metadata:
  display-name: '中文名称'
  version: "1.0"`))
    expect(result.errors).toEqual([])
    expect(result.description).toBe('第一行 第二行')
    expect(result.compatibility).toBe('ZError\nbrowser tools')
    expect(result.displayName).toBe('中文名称')
    expect(result.license).toBe('MIT # not a comment')
    expect(result.allowedTools).toBe('browser_get_state browser_click')
  })

  it('supports BOM and CRLF, and keeps the body out of metadata', () => {
    const result = parseSkillFrontmatter('\uFEFF' + skill('name: example\ndescription: "a: b"').replace(/\n/g, '\r\n'))
    expect(result.hasFrontmatter).toBe(true)
    expect(result.description).toBe('a: b')
    expect(result.body).toBe('# 正文\r\n\r\n保留  空格。')
  })

  it.each([
    'name: example\nname: duplicate\ndescription: x',
    'name: [broken\ndescription: x',
    '- not\n- a map',
  ])('reports malformed headers and duplicate keys without crashing preview', header => {
    expect(parseSkillFrontmatter(skill(header)).errors.length).toBeGreaterThan(0)
    expect(() => prepareSkillMarkdown(skill(header), 'example', { name: '例子', description: '说明' })).toThrow()
  })

  it('rejects unterminated headers instead of replacing them during migration', () => {
    expect(() => prepareSkillMarkdown('---\nname: example\n# missing delimiter', 'example', { name: '例子', description: '说明' })).toThrow('结束分隔符')
  })

  it.each(['Upper', '-example', 'example-', 'ex--ample', 'x'.repeat(65)])('rejects invalid names: %s', name => {
    expect(validateSkillMarkdown(skill(`name: ${name}\ndescription: x`), name).length).toBeGreaterThan(0)
  })

  it('enforces directory identity, required description and optional field types', () => {
    expect(validateSkillMarkdown(skill('name: another\ndescription: x'), 'example').join()).toContain('目录一致')
    expect(validateSkillMarkdown(skill('name: example\ndescription: ""'), 'example').join()).toContain('description')
    for (const extra of ['metadata: {version: 1}', 'allowed-tools: [browser_click]', 'license: 42', 'compatibility: ' + 'x'.repeat(501), 'custom: x']) {
      expect(validateSkillMarkdown(skill(`name: example\ndescription: x\n${extra}`), 'example').length).toBeGreaterThan(0)
    }
  })

  it('migrates legacy Chinese labels/scope and retains comments, optional fields and exact body', () => {
    const original = skill(`name: 学习通 # keep this comment
description: 中文说明
license: Apache-2.0
scope: browser
metadata:
  author: Someone
  version: "2"`)
    const normalized = prepareSkillMarkdown(original, 'chaoxing', { name: '学习通', description: 'fallback' })
    const parsed = parseSkillFrontmatter(normalized)
    expect(parsed.name).toBe('chaoxing')
    expect(parsed.displayName).toBe('学习通')
    expect(parsed.scope).toBe('browser')
    expect(parsed.metadata.author).toBe('Someone')
    expect(parsed.license).toBe('Apache-2.0')
    expect(parsed.data).not.toHaveProperty('scope')
    expect(parsed.rawBody).toBe(parseSkillFrontmatter(original).rawBody)
    expect(normalized).toContain('keep this comment')
    expect(prepareSkillMarkdown(normalized, 'chaoxing', { name: '', description: '' })).toBe(normalized)
  })

  it('wraps old body-only overrides, leaves standard documents byte-for-byte unchanged', () => {
    const body = '\n# 旧正文\n\n代码\n'
    expect(parseSkillFrontmatter(prepareSkillMarkdown(body, 'example', { name: '例子', description: '说明' })).rawBody).toBe(body)
    const standard = skill('name: example\ndescription: x\nmetadata: {display-name: 例子}')
    expect(prepareSkillMarkdown(standard, 'example', { name: '', description: '' })).toBe(standard)
  })

  it('does not silently rename old installed IDs or misidentified standard documents', () => {
    const old = skill('name: 中文名称\ndescription: 说明')
    expect(normalizeLegacySkillMarkdown(old, '中文名称', { name: '', description: '' })).toBe(old)
    expect(() => prepareSkillMarkdown(old, '中文名称', { name: '', description: '' })).toThrow('重新安装')
    expect(() => prepareSkillMarkdown(skill('name: other\ndescription: x'), 'example', { name: '', description: '' })).toThrow('目录一致')
  })

  it('validates every bundled root while retaining Chinese display names and tool dependencies', () => {
    const root = resolve('src/services/agent/skills/bundled')
    const ids = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    expect(ids).toHaveLength(9)
    for (const id of ids) {
      const raw = readFileSync(resolve(root, id, 'SKILL.md'), 'utf8')
      expect(validateSkillMarkdown(raw, id), id).toEqual([])
      const parsed = parseSkillFrontmatter(raw)
      expect(parsed.displayName, id).toMatch(/[\u4e00-\u9fff]/)
      expect(parsed.compatibility, id).toContain('ZError')
    }
  })
})
