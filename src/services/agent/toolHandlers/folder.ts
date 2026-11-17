import { databaseService } from '../../app/database'
import { parseDifficulty, parseImportance, parseMastery } from '../../../utils/question/questionMetrics'
import { inspectLocalFile, parseQuestions, readLocalFileRange } from '../import'
import { saveQuestions } from '../quizTools'
import type { ChatToolHandler } from '../toolContext'
import {
  clipToolResult,
  notifyFoldersChanged,
  parseQuestionIds,
  rememberListed,
  resolveFolder,
  summarizeQuestion,
  withPractice,
} from '../toolShared'

export const folderToolHandlers: Record<string, ChatToolHandler> = {
  get_file_info: async ({ args, ctx }) => {
    const path = String(args.path || ctx.attachment()?.filePath || '')
    if (!path) return JSON.stringify({ error: '当前对话没有附带文件' })
    return JSON.stringify(await inspectLocalFile(path))
  },

  read_range: async ({ args, ctx }) => {
    const path = String(args.path || ctx.attachment()?.filePath || '')
    if (!path) return JSON.stringify({ error: '当前对话没有附带文件' })
    const start = Number(args.start)
    const end = Number(args.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return JSON.stringify({ error: 'start 和 end 必须是数字' })
    }
    return clipToolResult(JSON.stringify(await readLocalFileRange(path, start, end)))
  },

  list_folders: async () => {
    const folders = await databaseService.getFolders()
    const stats = await databaseService.getFolderStats()
    const countMap = new Map(stats.map((item) => [item.folderId, item.questionCount]))
    return JSON.stringify({
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id ?? 0,
        questionCount: countMap.get(folder.id) ?? 0,
      })),
    })
  },

  get_folder_info: async ({ args }) => {
    const folder = await resolveFolder(args.folder_id, args.folder_name)
    if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
    const path = await databaseService.getFolderPath(folder.id)
    const count = await databaseService.getFolderQuestionCount(folder.id)
    return JSON.stringify({
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_id ?? 0,
      questionCount: count,
      path: path.map((item) => item.name).join(' / '),
    })
  },

  create_folder: async ({ args }) => {
    const name = String(args.name || '').trim()
    if (!name) return JSON.stringify({ error: '文件夹名称不能为空' })
    let parentId = Number.isFinite(Number(args.parent_id)) ? Number(args.parent_id) : 0
    if (args.parent_name && !Number.isFinite(Number(args.parent_id))) {
      const parent = await resolveFolder(undefined, args.parent_name)
      if (!parent) return JSON.stringify({ error: `没有找到父文件夹「${args.parent_name}」` })
      parentId = parent.id
    }
    const id = await databaseService.createFolder(name, parentId)
    const parent = await resolveFolder(parentId)
    notifyFoldersChanged(id)
    return JSON.stringify({
      id,
      name,
      parentId,
      parentName: parent?.name || '最外层',
      message: `已创建「${name}」`,
    })
  },

  rename_folder: async ({ args }) => {
    const folder = await resolveFolder(args.folder_id, args.folder_name)
    if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
    if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能重命名' })
    const newName = String(args.new_name || '').trim()
    if (!newName) return JSON.stringify({ error: '新名称不能为空' })
    await databaseService.renameFolder(folder.id, newName)
    notifyFoldersChanged(folder.id)
    return JSON.stringify({
      id: folder.id,
      oldName: folder.name,
      name: newName,
      message: `已把「${folder.name}」改成「${newName}」`,
    })
  },

  move_folder: async ({ args }) => {
    const folder = await resolveFolder(args.folder_id, args.folder_name)
    if (!folder) return JSON.stringify({ error: '没有找到要移动的文件夹' })
    if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能移动' })
    let parentId = Number.isFinite(Number(args.parent_id)) ? Number(args.parent_id) : 0
    if (args.parent_name && !Number.isFinite(Number(args.parent_id))) {
      const parent = await resolveFolder(undefined, args.parent_name)
      if (!parent) return JSON.stringify({ error: `没有找到目标文件夹「${args.parent_name}」` })
      parentId = parent.id
    }
    await databaseService.moveFolder(folder.id, parentId)
    const parent = await resolveFolder(parentId)
    notifyFoldersChanged(folder.id)
    return JSON.stringify({
      id: folder.id,
      name: folder.name,
      parentId,
      parentName: parent?.name || '最外层',
      message: `已把「${folder.name}」移到「${parent?.name || '最外层'}」`,
    })
  },

  delete_folder: async ({ args }) => {
    const folder = await resolveFolder(args.folder_id, args.folder_name)
    if (!folder) return JSON.stringify({ error: '没有找到要删除的文件夹' })
    if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能删除' })
    const deleteQuestions = args.delete_questions === true
    await databaseService.deleteFolder(folder.id, deleteQuestions)
    notifyFoldersChanged(0)
    return JSON.stringify({
      id: folder.id,
      name: folder.name,
      deleteQuestions,
      message: deleteQuestions
        ? `已删除「${folder.name}」及其题目`
        : `已删除「${folder.name}」，题目已回到默认文件夹`,
    })
  },

  list_questions: async ({ args, ctx }) => {
    const folder = (await resolveFolder(args.folder_id, args.folder_name)) || await resolveFolder(0)
    if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
    const page = Math.max(1, Number(args.page) || 1)
    const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
    const importance = args.importance == null ? undefined : parseImportance(args.importance)
    const mastery = args.mastery == null ? undefined : parseMastery(args.mastery)
    const difficulty = args.difficulty == null ? undefined : parseDifficulty(args.difficulty)
    if (args.include_subfolders === true) {
      let all = await databaseService.getQuestionsFromFolderAndSubfolders(folder.id)
      if (args.importance != null) all = all.filter((item) => (item.importance || 0) === importance)
      if (args.mastery != null) all = all.filter((item) => (item.mastery || 0) === mastery)
      if (args.difficulty != null) all = all.filter((item) => (item.difficulty || 0) === difficulty)
      const start = (page - 1) * pageSize
      const items = all.slice(start, start + pageSize)
      rememberListed(ctx.sessionId, items)
      return clipToolResult(JSON.stringify({
        folderId: folder.id,
        folderName: folder.name,
        includeSubfolders: true,
        page,
        pageSize,
        total: all.length,
        count: items.length,
        hasMore: start + items.length < all.length,
        questions: await withPractice(items),
      }))
    }
    const result = await databaseService.getPaginatedQuestions({
      folderId: folder.id,
      page,
      pageSize,
      importance: args.importance == null ? undefined : importance,
      mastery: args.mastery == null ? undefined : mastery,
      difficulty: args.difficulty == null ? undefined : difficulty,
    })
    rememberListed(ctx.sessionId, result.items)
    return clipToolResult(JSON.stringify({
      folderId: folder.id,
      folderName: folder.name,
      includeSubfolders: false,
      page,
      pageSize,
      total: result.total,
      count: result.items.length,
      hasMore: page * pageSize < result.total,
      questions: await withPractice(result.items),
    }))
  },

  search_questions: async ({ args, ctx }) => {
    const keyword = String(args.keyword || '').trim()
    if (!keyword) return JSON.stringify({ error: '关键词不能为空' })
    const folder = args.folder_id != null || args.folder_name
      ? await resolveFolder(args.folder_id, args.folder_name)
      : null
    if ((args.folder_id != null || args.folder_name) && !folder) {
      return JSON.stringify({ error: '没有找到这个文件夹' })
    }
    const found = await databaseService.searchQuestionsByTitle(keyword, folder?.id)
    const items = found.slice(0, 40)
    rememberListed(ctx.sessionId, items)
    return clipToolResult(JSON.stringify({
      keyword,
      folderId: folder?.id,
      folderName: folder?.name,
      total: found.length,
      count: items.length,
      hasMore: found.length > items.length,
      questions: await withPractice(items),
    }))
  },

  move_questions: async ({ args }) => {
    const target = await resolveFolder(args.folder_id, args.folder_name)
    if (!target) return JSON.stringify({ error: '没有找到目标文件夹' })
    const source = args.source_folder_id != null || args.source_folder_name
      ? await resolveFolder(args.source_folder_id, args.source_folder_name)
      : null
    if ((args.source_folder_id != null || args.source_folder_name) && !source) {
      return JSON.stringify({ error: '没有找到源文件夹' })
    }

    const ids = parseQuestionIds(args)
    const keyword = String(args.keyword || '').trim()
    const selected = new Map<number, ReturnType<typeof summarizeQuestion>>()

    if (source) {
      const inFolder = await databaseService.getAIResponses(source.id)
      for (const item of inFolder) {
        if (ids.includes(item.id)) selected.set(item.id, summarizeQuestion(item))
      }
      if (keyword) {
        const found = await databaseService.searchQuestionsByTitle(keyword, source.id)
        for (const item of found.slice(0, 50)) selected.set(item.id, summarizeQuestion(item))
      }
    }

    if (ids.length && !source) {
      for (const id of ids) selected.set(id, summarizeQuestion({ id }))
    }

    if (keyword && !source) {
      const found = await databaseService.searchQuestionsByTitle(keyword)
      for (const item of found.slice(0, 50)) selected.set(item.id, summarizeQuestion(item))
    }

    const moving = [...selected.values()].slice(0, 50)
    if (!moving.length) {
      return JSON.stringify({ error: '没有找到要移动的题目，请先 list_questions 或 search_questions 拿到 Id' })
    }

    for (const item of moving) {
      await databaseService.moveQuestionToFolder(item.id, target.id)
    }
    notifyFoldersChanged(target.id)
    return JSON.stringify({
      moved: moving.length,
      questionIds: moving.map((item) => item.id),
      questions: moving.map((item) => item.question).filter(Boolean).slice(0, 12),
      targetId: target.id,
      targetName: target.name,
      sourceId: source?.id,
      sourceName: source?.name,
      message: `已把 ${moving.length} 道题目移到「${target.name}」`,
    })
  },

  save_questions: async ({ args, ctx }) => {
    const questions = parseQuestions(args.questions)
    if (!questions.length) {
      return JSON.stringify({ saved: 0, message: '没有有效题目，需要 question 和 answer' })
    }
    const attachedFolder = ctx.folders()[0]
    const attachment = ctx.attachment()
    const folder = (await resolveFolder(args.folder_id, args.folder_name))
      || (attachedFolder?.folderId != null ? await resolveFolder(attachedFolder.folderId) : null)
      || (attachment?.folderId != null ? await resolveFolder(attachment.folderId) : null)
      || (await resolveFolder(0))
    const attachedSubject = ctx.studySubjectId()
    const result = await saveQuestions(
      questions,
      folder?.id ?? 0,
      attachedSubject,
    )
    const linked = result.association.linked
    return JSON.stringify({
      saved: result.saved,
      questionIds: result.questionIds,
      folderId: folder?.id ?? 0,
      folderName: folder?.name || '默认',
      linked,
      created_nodes: result.association.created,
      knowledge: result.association.links.slice(0, 20).map((item) => ({
        question_id: item.question_id,
        node_id: item.node_id,
        node_name: item.node_name,
        subject_id: item.subject_id,
      })),
      message: linked
        ? `已写入 ${result.saved} 道题目到「${folder?.name || '默认'}」，并关联了 ${linked} 个知识点`
        : `已写入 ${result.saved} 道题目到「${folder?.name || '默认'}」`,
    })
  },

  update_question_metrics: async ({ args }) => {
    const ids = parseQuestionIds(args)
    if (!ids.length) return JSON.stringify({ error: '需要 question_id 或 question_ids' })
    const patch: { importance?: number; mastery?: number; difficulty?: number } = {}
    if (args.importance != null) patch.importance = parseImportance(args.importance)
    if (args.mastery != null) patch.mastery = parseMastery(args.mastery)
    if (args.difficulty != null) patch.difficulty = parseDifficulty(args.difficulty)
    if (!Object.keys(patch).length) return JSON.stringify({ error: '至少提供 importance、mastery 或 difficulty 之一' })
    for (const id of ids) {
      await databaseService.updateQuestion(id, patch)
    }
    notifyFoldersChanged()
    return JSON.stringify({
      updated: ids.length,
      questionIds: ids,
      ...patch,
      message: `已更新 ${ids.length} 道题目的指标`,
    })
  },

  get_practice_history: async ({ args }) => {
    const questionId = Number(args.question_id)
    if (!Number.isFinite(questionId) || questionId <= 0) {
      return JSON.stringify({ error: 'question_id 无效' })
    }
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10))
    const records = await databaseService.getPracticeHistory(questionId, limit)
    return JSON.stringify({
      questionId,
      count: records.length,
      records: records.map((item) => ({
        id: item.id,
        userAnswer: item.user_answer,
        correct: item.is_correct,
        note: item.note,
        source: item.source,
        time: item.create_time,
      })),
    })
  },

  add_practice_note: async ({ args }) => {
    const questionId = Number(args.question_id)
    const note = String(args.note || '').trim()
    if (!Number.isFinite(questionId) || questionId <= 0) {
      return JSON.stringify({ error: 'question_id 无效' })
    }
    if (!note) return JSON.stringify({ error: '备注不能为空' })
    const record = await databaseService.addPracticeRecord({
      questionId,
      userAnswer: '',
      isCorrect: false,
      note,
      source: 'agent-note',
    })
    return JSON.stringify({
      id: record.id,
      questionId,
      note,
      message: '已记下备注',
    })
  },
}
