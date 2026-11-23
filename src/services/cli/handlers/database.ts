import { invoke } from '@tauri-apps/api/core'
import type { CliHandlerGroup } from '../contracts'
import { requiredText } from '../values'

const pageArgs = (p: { folderId?: number; page?: number; pageSize?: number }) => ({ folderId: p.folderId ?? null, pendingCorrectionOnly: false, page: p.page || 1, pageSize: p.pageSize || 30, sortOrder: 'desc' })
export const folderHandlers = {
  'folders.list': async () => invoke('get_folders'),
  'folders.add': async p => ({ id: await invoke('add_folder', { name: requiredText(p.name, 'name'), parentId: p.parentId || 0 }) }),
  'folders.rename': async p => { await invoke('rename_folder', { id: p.id, newName: requiredText(p.name, 'name') }); return { id: p.id, saved: true } },
  'folders.delete': async p => { await invoke('delete_folder', { id: p.id, deleteQuestions: p.deleteQuestions ?? false }); return { id: p.id, saved: true } },
} satisfies CliHandlerGroup<'folders'>
export const questionHandlers = {
  'questions.list': async p => invoke('get_paginated_questions', { ...pageArgs(p), importance: null, mastery: null, difficulty: null }),
  'questions.search': async p => invoke('search_questions_page', { ...pageArgs(p), keyword: requiredText(p.keyword, 'keyword') }),
  'questions.add': async p => invoke('add_question', { content: requiredText(p.content, 'content'), options: p.options ?? null, answer: p.answer, folderId: p.folderId, questionType: p.questionType ?? null, isAi: false, importance: null, mastery: null, difficulty: null }),
  'questions.update': async p => {
    if (!['content', 'options', 'answer', 'questionType'].some(key => Object.hasOwn(p, key))) throw new Error('请提供至少一个待更新字段')
    await invoke('update_question', { id: p.id, question: p.content ?? null, options: p.options ?? null, answer: p.answer ?? null, questionType: p.questionType ?? null, importance: null, mastery: null, difficulty: null })
    return { id: p.id, saved: true }
  },
  'questions.delete': async p => { await invoke('delete_question', { id: p.id }); return { id: p.id, saved: true } },
} satisfies CliHandlerGroup<'questions'>
