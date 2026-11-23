export type SkillScope = 'browser' | 'learning' | 'both'

export type AgentSkillItem = {
  id: string
  name: string
  description: string
  enabled: boolean
  builtin: boolean
  scope: SkillScope
  customized?: boolean
  source?: string
  sourcePath?: string
  installedAt?: number
  updatedAt?: number
}

export type SkillDocument = {
  id: string
  name: string
  description: string
  markdown: string
  builtin: boolean
  customized: boolean
  source?: string
  sourcePath?: string
  files?: string[]
}

export type SkillFileContent = {
  id: string
  path: string
  content: string
  readonly: boolean
  repositoryVersion?: string
}

export type SkillConfigRow = {
  enabled?: boolean
  source?: string
  sourcePath?: string
  installedAt?: number
  updatedAt?: number
}

export type SkillConfigFile = {
  version: number
  skills: Record<string, SkillConfigRow>
}

export type SkillMetaFile = {
  id: string
  name: string
  description: string
  source: string
  sourcePath: string
  installedAt: number
  updatedAt: number
}

export type BuiltinSkillDef = {
  name: string
  description: string
  triggerHint: string
  defaultEnabled: boolean
  scope: SkillScope
  matchKeywords?: string[]
  editable?: boolean
}

export type SkillCatalogEntry = {
  id: string
  name: string
  description: string
}
