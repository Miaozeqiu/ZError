export type ImportTemplateSaveMode = 'ask' | 'auto' | 'never'
export type ImportAlgorithmTemplate = {
  id: string; name: string; description: string; extensions: string[]; code: string
  createdAt: number; updatedAt: number; lastUsedAt?: number
}
export type QuestionImportSettings = { saveMode: ImportTemplateSaveMode; templates: ImportAlgorithmTemplate[] }
export type ImportTemplateSource = { code: string; name: string; description: string; extensions: string[]; templateId?: string }
export type ImportTemplateOffer = ImportTemplateSource & {
  id: string; status: 'pending' | 'saved' | 'skipped'; savedTemplateId?: string
}
export const defaultQuestionImportSettings = (): QuestionImportSettings => ({ saveMode: 'ask', templates: [] })
