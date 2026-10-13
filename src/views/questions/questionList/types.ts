import type { AIResponse } from '../../../services/app/database'
import type { QuestionListState } from './state'

export const PENDING_CORRECTION_FOLDER_ID = '-1'

export interface Props {
  selectedFolderId?: string | null
  collapseTrigger?: number
}

export type QuestionListEmit = {
  (e: 'question-select', question: AIResponse): void
  (e: 'question-pasted'): void
  (e: 'question-added'): void
  (e: 'question-updated'): void
  (e: 'open-import-dialog', items: any): void
  (e: 'refresh'): void
  (e: 'folder-path-change', path: { id: number; name: string }[]): void
}

export type QuestionListOps = {
  loadQuestions: (folderId?: string | null, requestedPage?: number) => Promise<void>
  performSearch: () => Promise<void>
  updateSelectAllState: () => void
  importSoftwareExportedFile: () => Promise<void>
  importOtherFileWithAgent: () => Promise<void>
  exportFile: (format: 'csv' | 'xlsx' | 'docx' | 'pdf' | 'txt') => Promise<void>
  closeDetail: () => void
  hideContextMenu: () => void
  analyzeImage: (url: string, src: string) => Promise<void>
  fetchImages: (urls: string[]) => Promise<void>
  loadKnowledgeLinks: (items: AIResponse[]) => Promise<void>
  applyCreateTimeSort: () => void
}

export type QuestionListCtx = QuestionListState & {
  props: Props
  emit: QuestionListEmit
  ops: QuestionListOps
}
