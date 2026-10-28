import { isBuiltinRuntimeSkillFile } from '../skillRuntimeFiles'

const SKILL_MAIN = 'SKILL.md'

const rawModules = import.meta.glob<string>([
  './bundled/**/*.{md,json}',
  '!./bundled/**/fixtures/**',
  '!./bundled/**/parsers/**',
], {
  query: '?raw',
  import: 'default',
  eager: true,
})

type BundledSkillStore = Record<string, Record<string, string>>

const parseBundledKey = (key: string): { id: string; path: string } | null => {
  const normalized = key.replace(/\\/g, '/')
  const match = normalized.match(/^\.\/bundled\/([^/]+)\/(.+)$/)
  if (!match) return null
  return { id: match[1], path: match[2] }
}

const bundledStore: BundledSkillStore = {}

for (const [key, content] of Object.entries(rawModules)) {
  const parsed = parseBundledKey(key)
  if (!parsed || !isBuiltinRuntimeSkillFile(parsed.path) || typeof content !== 'string') continue
  if (!bundledStore[parsed.id]) bundledStore[parsed.id] = {}
  bundledStore[parsed.id][parsed.path] = content
}

export const hasBundledSkill = (id: string) => Boolean(bundledStore[id]?.[SKILL_MAIN])

export const listBundledSkillFiles = (id: string): string[] => {
  const files = bundledStore[id]
  if (!files) return []
  return Object.keys(files).sort((a, b) => {
    if (a === SKILL_MAIN) return -1
    if (b === SKILL_MAIN) return 1
    return a.localeCompare(b, 'en')
  })
}

export const readBundledSkillFile = (id: string, relativePath: string): string | null => {
  const path = String(relativePath || '').replace(/\\/g, '/')
  return bundledStore[id]?.[path] ?? null
}
