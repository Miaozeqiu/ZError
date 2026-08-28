import { databaseService, type StudyGraphNodePatch } from '../../app/database'
import { finalizeStudySessionSummary } from '../../study/timelineSummary'
import { associateQuestionsToKnowledge } from '../../study/questionKnowledge'
import { collectGraphNodes, parseGraphEdgeInputs, parseGraphNodeInputs } from '../../../utils/study/studyGraph'
import {
  KEEP_GRAPH_HINT,
  WRITE_GRAPH_HINT,
  graphBuildMessage,
  notifyStudyGraph,
  openStudyGraphPane,
  pickSubjectRef,
  publishGraph,
  resolveSubject,
  resolveSubjectFromArgs,
  summarizeGraph,
  summarizeSubjects,
} from '../studyHelpers'
import type { ChatToolHandler } from '../toolContext'
import { clipToolResult, parseQuestionIds, rememberListed, resolveFolder, withPractice } from '../toolShared'

export const studyToolHandlers: Record<string, ChatToolHandler> = {
  list_subjects: async () => {
    const subjects = await databaseService.listStudySubjects()
    return JSON.stringify({
      count: subjects.length,
      subjects: summarizeSubjects(subjects),
      message: subjects.length
        ? '查看某一科请用 get_subject，展开思维导图请用 open_knowledge_graph。'
        : '还没有学习科目。请先 create_subject。',
    })
  },

  get_subject: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId())
    if (!subject) {
      const subjects = await databaseService.listStudySubjects()
      return JSON.stringify({
        error: '找不到该科目',
        subjects: summarizeSubjects(subjects),
        message: subjects.length ? '请用上面的 subject_id 再调用 get_subject。' : '还没有科目，请先 create_subject。',
      })
    }
    const payload = await databaseService.getStudyGraph(subject.id)
    openStudyGraphPane(subject.id)
    return JSON.stringify({
      ...summarizeSubjects([subject])[0],
      description: subject.description,
      node_count: payload.nodes.length,
      chapters: payload.nodes
        .filter((item) => !item.parent_id)
        .map((item) => item.name)
        .slice(0, 16),
      message: payload.nodes.length
        ? `已打开「${subject.name}」的思维导图。`
        : `已打开「${subject.name}」，图谱还是空的。${WRITE_GRAPH_HINT}`,
    })
  },

  open_knowledge_graph: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId())
    if (!subject) {
      const subjects = await databaseService.listStudySubjects()
      return JSON.stringify({
        error: '找不到要展开的科目',
        subjects: summarizeSubjects(subjects),
        message: subjects.length ? '请指定 subject_id，或先挂上学习状态。' : '还没有科目，请先 create_subject。',
      })
    }
    const payload = await databaseService.getStudyGraph(subject.id)
    openStudyGraphPane(subject.id)
    return JSON.stringify({
      opened: true,
      subject: summarizeSubjects([subject])[0],
      node_count: payload.nodes.length,
      message: payload.nodes.length
        ? `已展开「${subject.name}」的思维导图。`
        : `已展开「${subject.name}」，图谱还是空的。${WRITE_GRAPH_HINT}`,
    })
  },

  create_subject: async ({ args, ctx }) => {
    const name = String(args.name || '').trim()
    if (!name) return JSON.stringify({ error: '科目名称不能为空' })
    const subject = await databaseService.createStudySubject(name, String(args.description || ''))
    notifyStudyGraph(subject.id)
    if (!ctx.studySubjectId()) {
      ctx.setStudySubject(subject.id)
    }
    openStudyGraphPane(subject.id)
    return JSON.stringify({
      ...subject,
      attached: Boolean(ctx.studySubjectId() === subject.id),
      message: `已创建科目「${subject.name}」，subject_id=${subject.id}，并展开了思维导图。${WRITE_GRAPH_HINT}`,
    })
  },

  attach_study_subject: async ({ args, ctx }) => {
    const ref = pickSubjectRef(args)
    const subject = await resolveSubject(ref.id, ref.name, true)
    if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects 或 create_subject' })
    ctx.setStudySubject(subject.id)
    return JSON.stringify({
      attached: true,
      id: subject.id,
      name: subject.name,
      progress: Math.round((subject.progress || 0) * 100),
      node_count: subject.node_count,
      message: `已把「${subject.name}」挂到当前对话，右上角会显示正在学习。`,
    })
  },

  detach_study_subject: async ({ ctx }) => {
    const currentId = ctx.studySubjectId()
    const subjects = currentId ? await databaseService.listStudySubjects().catch(() => []) : []
    const current = subjects.find((item) => item.id === currentId)
    if (currentId && current) {
      finalizeStudySessionSummary({ subjectId: currentId, subjectName: current.name })
    }
    ctx.setStudySubject(null)
    return JSON.stringify({
      attached: false,
      name: current?.name,
      message: current ? `已撤下「${current.name}」的学习状态。` : '当前对话没有学习状态。',
    })
  },

  rename_subject: async ({ args }) => {
    const ref = pickSubjectRef(args)
    const subject = await resolveSubject(ref.id, ref.name)
    if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects' })
    const updated = await databaseService.renameStudySubject(
      subject.id,
      args.new_name == null ? undefined : String(args.new_name),
      args.description == null ? undefined : String(args.description),
    )
    notifyStudyGraph(updated.id)
    return JSON.stringify(updated)
  },

  delete_subject: async ({ args }) => {
    const ref = pickSubjectRef(args)
    const subject = await resolveSubject(ref.id, ref.name)
    if (!subject) return JSON.stringify({ error: '找不到该科目' })
    await databaseService.deleteStudySubject(subject.id)
    notifyStudyGraph(subject.id)
    return JSON.stringify({ deleted: true, id: subject.id, name: subject.name })
  },

  get_knowledge_graph: async ({ args }) => {
    try {
      const ref = pickSubjectRef(args)
      const subject = await resolveSubject(ref.id, ref.name, true)
      if (!subject) {
        const subjects = await databaseService.listStudySubjects()
        return JSON.stringify({
          found: false,
          subjects: summarizeSubjects(subjects),
          message: subjects.length
            ? `未匹配到科目。请用上面的 id 作为 subject_id。${WRITE_GRAPH_HINT}`
            : `还没有科目。请先 create_subject，然后 ${WRITE_GRAPH_HINT}`,
        })
      }
      const payload = await databaseService.getStudyGraph(subject.id)
      return JSON.stringify({
        ...summarizeGraph(payload),
        message: payload.nodes.length
          ? KEEP_GRAPH_HINT
          : `图谱为空。${WRITE_GRAPH_HINT}`,
      })
    } catch (error) {
      const subjects = await databaseService.listStudySubjects().catch(() => [])
      return JSON.stringify({
        found: false,
        subjects: summarizeSubjects(subjects),
        message: `查看失败：${error instanceof Error ? error.message : String(error)}。${WRITE_GRAPH_HINT}`,
      })
    }
  },

  set_knowledge_graph: async ({ call, args, ctx }) => {
    try {
      let nodes = collectGraphNodes(args, call.arguments)
      const ref = pickSubjectRef(args)
      let subject = await resolveSubject(ref.id, ref.name, true)
      if (!subject && ref.name) {
        subject = await databaseService.createStudySubject(ref.name, '')
      }
      if (!subject) {
        const subjects = await databaseService.listStudySubjects()
        return JSON.stringify({
          error: subjects.length
            ? `请提供 subject_id。现有科目：${subjects.map((item) => `${item.name}(id=${item.id})`).join('、')}。然后带 outline 再调用 set_knowledge_graph。`
            : '请先 create_subject，再 set_knowledge_graph 写入 outline。',
          subjects: summarizeSubjects(subjects),
        })
      }
      if (!nodes.length) {
        return JSON.stringify({ error: `没有解析到知识点。${WRITE_GRAPH_HINT}` })
      }
      const existing = await databaseService.getStudyGraph(subject.id)
      const replace = args.replace === true || args.replace === 'true'
      if (existing.nodes.length && !replace) {
        return JSON.stringify({
          error: `「${subject.name}」已有 ${existing.nodes.length} 个节点。${KEEP_GRAPH_HINT}`,
        })
      }
      if (existing.nodes.length >= 8 && nodes.length < Math.min(8, Math.ceil(existing.nodes.length / 3))) {
        return JSON.stringify({
          error: `这次只解析到 ${nodes.length} 个节点，少于已有图谱，没有覆盖。请改用 patch_knowledge_graph 分批添加。`,
        })
      }
      const payload = await databaseService.setStudyGraph(
        subject.id,
        nodes,
        parseGraphEdgeInputs(args.edges),
      )
      publishGraph(payload, ctx.markDrawingGraph, true)
      return JSON.stringify({
        ...summarizeGraph(payload),
        message: graphBuildMessage(payload, payload.nodes.length),
      })
    } catch (error) {
      return JSON.stringify({
        error: `写入失败：${error instanceof Error ? error.message : String(error)}。请改用 outline 再调用 set_knowledge_graph，不要让用户手动创建。`,
      })
    }
  },

  focus_knowledge_graph: async ({ args, ctx }) => {
    const nodeName = String(args.node_name ?? args.name ?? args.node ?? '').trim()
    const nodeId = Number(args.node_id ?? args.id)
    if (!nodeName && !(Number.isFinite(nodeId) && nodeId > 0)) {
      return JSON.stringify({ error: '请提供 node_name，用图谱里的章名或节名' })
    }
    const subjectId = Number(args.subject_id ?? args.subjectId)
    const subjectName = String(args.subject_name ?? args.subjectName ?? '').trim()
    let subject = await resolveSubject(
      Number.isFinite(subjectId) && subjectId > 0 ? subjectId : undefined,
      subjectName || undefined,
      true,
    )
    if (!subject) {
      const attached = ctx.studySubjectId()
      if (attached) subject = await resolveSubject(attached)
    }
    if (!subject) return JSON.stringify({ error: '找不到科目，请先 list_subjects 或挂上学习状态' })
    const payload = await databaseService.getStudyGraph(subject.id)
    if (!payload.nodes.length) {
      return JSON.stringify({ error: '这个科目还没有图谱', subject: payload.subject })
    }
    const byId = Number.isFinite(nodeId) && nodeId > 0
      ? payload.nodes.find((item) => item.id === nodeId)
      : null
    const exact = byId || payload.nodes.find((item) => item.name === nodeName || item.node_key === nodeName)
    const fuzzy = exact || payload.nodes.filter((item) =>
      item.name.includes(nodeName) || nodeName.includes(item.name),
    )
    const matched = Array.isArray(fuzzy)
      ? (fuzzy.find((item) => item.name.startsWith(nodeName)) || (fuzzy.length === 1 ? fuzzy[0] : null))
      : fuzzy
    if (!matched) {
      const candidates = Array.isArray(fuzzy) && fuzzy.length
        ? fuzzy.map((item) => item.name).slice(0, 8)
        : payload.nodes.map((item) => item.name).slice(0, 20)
      return JSON.stringify({
        error: `图谱里没有「${nodeName || nodeId}」`,
        candidates,
      })
    }
    openStudyGraphPane(subject.id, matched.name, matched.id)
    return JSON.stringify({
      focused: true,
      subject: { id: subject.id, name: subject.name },
      node: {
        id: matched.id,
        key: matched.node_key,
        name: matched.name,
        summary: String(matched.summary || '').slice(0, 120),
        mastery: matched.mastery,
      },
      message: `已在图谱中聚焦「${matched.name}」`,
    })
  },

  patch_knowledge_graph: async ({ call, args, ctx }) => {
    const ref = pickSubjectRef(args)
    const subject = await resolveSubject(ref.id, ref.name, true)
    if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects' })
    let add = parseGraphNodeInputs(args.add ?? args.nodes)
    if (!add.length) add = collectGraphNodes(args, call.arguments)
    if (!add.length && !args.update && !args.remove_ids) {
      return JSON.stringify({ error: `没有解析到要添加的节点。${WRITE_GRAPH_HINT}` })
    }
    const payload = await databaseService.patchStudyGraph(subject.id, {
      add,
      update: Array.isArray(args.update) ? args.update as StudyGraphNodePatch[] : undefined,
      remove_ids: Array.isArray(args.remove_ids)
        ? args.remove_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id))
        : undefined,
    })
    publishGraph(payload, ctx.markDrawingGraph, true)
    return JSON.stringify({
      ...summarizeGraph(payload),
      added: add.length,
      message: graphBuildMessage(payload, add.length),
    })
  },

  link_questions_to_knowledge: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId()).catch(() => null)
    const rows = Array.isArray(args.questions) ? args.questions : []
    const ids = parseQuestionIds(args)
    const hints = [
      ...rows.map((item: any) => ({
        questionId: Number(item?.question_id || item?.id),
        question: String(item?.question || ''),
        knowledge_point: String(item?.knowledge_point || '').trim() || undefined,
        node_name: String(item?.node_name || item?.knowledge_point || '').trim() || undefined,
        node_id: Number(item?.node_id) > 0 ? Number(item.node_id) : undefined,
        parent_name: String(item?.parent_name || '').trim() || undefined,
        subject_id: Number(item?.subject_id) > 0 ? Number(item.subject_id) : subject?.id,
      })),
      ...ids.map((id) => ({
        questionId: id,
        knowledge_point: String(args.knowledge_point || '').trim() || undefined,
        node_name: String(args.node_name || args.knowledge_point || '').trim() || undefined,
        node_id: Number(args.node_id) > 0 ? Number(args.node_id) : undefined,
        parent_name: String(args.parent_name || '').trim() || undefined,
        subject_id: subject?.id,
      })),
    ].filter((item) => item.questionId > 0)
    if (!hints.length) return JSON.stringify({ error: '需要 question_id 或 question_ids' })
    const result = await associateQuestionsToKnowledge(hints, {
      subjectId: subject?.id,
      createMissing: true,
    })
    if (result.created || result.linked) notifyStudyGraph(subject?.id)
    return JSON.stringify({
      linked: result.linked,
      created_nodes: result.created,
      skipped: result.skipped,
      knowledge: result.links.slice(0, 30).map((item) => ({
        question_id: item.question_id,
        node_id: item.node_id,
        node_name: item.node_name,
        subject_id: item.subject_id,
        subject_name: item.subject_name,
      })),
      message: result.linked
        ? `已把 ${result.linked} 道题目关联到知识点${result.created ? `，并新建了 ${result.created} 个节点` : ''}`
        : '没有关联成功。请先挂上学习状态或指定 subject_id / node_name。',
    })
  },

  list_recent_wrong_questions: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId()).catch(() => null)
    const folder = args.folder_id != null || args.folder_name
      ? await resolveFolder(args.folder_id, args.folder_name)
      : null
    let nodeId = Number(args.node_id)
    let nodeName = String(args.node_name || '').trim()
    if ((!Number.isFinite(nodeId) || nodeId <= 0) && nodeName) {
      if (!subject) return JSON.stringify({ error: '按知识点筛选时请提供 node_id，或同时提供科目和 node_name' })
      const payload = await databaseService.getStudyGraph(subject.id)
      const matched = payload.nodes.filter((item) => item.name === nodeName || item.name.includes(nodeName) || nodeName.includes(item.name))
      const node = matched.find((item) => item.name === nodeName)
        || (matched.length === 1 ? matched[0] : matched.find((item) => item.name.startsWith(nodeName)) || null)
      if (!node) {
        return JSON.stringify({
          error: `图谱里没有「${nodeName}」`,
          candidates: payload.nodes.map((item) => item.name).slice(0, 20),
        })
      }
      nodeId = node.id
      nodeName = node.name
    }
    const days = Math.min(365, Math.max(1, Number(args.days) || 30))
    const limit = Math.min(40, Math.max(1, Number(args.limit) || 20))
    const items = await databaseService.listRecentWrongQuestions({
      subjectId: Number.isFinite(nodeId) && nodeId > 0 ? undefined : subject?.id,
      nodeId: Number.isFinite(nodeId) && nodeId > 0 ? nodeId : undefined,
      folderId: folder?.id,
      days,
      limit,
      unresolvedOnly: args.unresolved_only === true,
    })
    const questions = items.length
      ? await databaseService.getQuestionsByIds(items.map((item) => item.question_id))
      : []
    const byId = new Map(questions.map((item) => [item.id, item]))
    const hydrated = await withPractice(items.map((item) => byId.get(item.question_id)).filter(Boolean) as typeof questions)
    const extra = new Map(items.map((item) => [item.question_id, item]))
    const scope = nodeName
      ? `「${nodeName}」`
      : subject
        ? `「${subject.name}」`
        : folder
          ? `「${folder.name}」`
          : '全部题库'
    rememberListed(ctx.sessionId, hydrated)
    return clipToolResult(JSON.stringify({
      scope,
      days,
      count: hydrated.length,
      questions: hydrated.map((item) => {
        const wrong = extra.get(item.id)
        return {
          ...item,
          lastWrongAnswer: wrong?.last_wrong_answer || '',
          lastWrongNote: wrong?.last_wrong_note || '',
          lastWrongTime: wrong?.last_wrong_time || '',
          wrongCount: wrong?.wrong_count || 0,
        }
      }),
      message: hydrated.length
        ? `最近 ${days} 天${scope}有 ${hydrated.length} 道答错过的题。recent 从早到晚，true=对，false=错。`
        : `最近 ${days} 天${scope}没有答错过的题。`,
    }))
  },

  list_knowledge_questions: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId()).catch(() => null)
    const nodeId = Number(args.node_id)
    let resolvedId = Number.isFinite(nodeId) && nodeId > 0 ? nodeId : 0
    let nodeName = String(args.node_name || '').trim()
    if (!resolvedId) {
      if (!subject || !nodeName) {
        return JSON.stringify({ error: '请提供 node_id，或同时提供科目和 node_name' })
      }
      const payload = await databaseService.getStudyGraph(subject.id)
      const matched = payload.nodes.find((item) => item.name === nodeName)
        || payload.nodes.filter((item) => item.name.includes(nodeName) || nodeName.includes(item.name))
      const node = Array.isArray(matched)
        ? (matched.length === 1 ? matched[0] : matched.find((item) => item.name.startsWith(nodeName)) || null)
        : matched
      if (!node) {
        return JSON.stringify({
          error: `图谱里没有「${nodeName}」`,
          candidates: payload.nodes.map((item) => item.name).slice(0, 20),
        })
      }
      resolvedId = node.id
      nodeName = node.name
    }
    const questionIds = await databaseService.listNodeQuestions(resolvedId)
    const questions = questionIds.length ? await databaseService.getQuestionsByIds(questionIds) : []
    return JSON.stringify({
      node_id: resolvedId,
      node_name: nodeName,
      count: questions.length,
      questions: await withPractice(questions.slice(0, 40)),
    })
  },

  merge_subjects: async ({ args }) => {
    const target = await resolveSubject(
      Number(args.target_id || args.subject_id) || undefined,
      String(args.target_name || args.subject_name || '').trim() || undefined,
      true,
    )
    if (!target) return JSON.stringify({ error: '找不到目标科目，请先 list_subjects' })
    const sourceIds = new Set<number>()
    const rawIds = Array.isArray(args.source_ids) ? args.source_ids : []
    for (const value of rawIds) {
      const id = Number(value)
      if (id > 0 && id !== target.id) sourceIds.add(id)
    }
    const names = Array.isArray(args.source_names) ? args.source_names : []
    for (const name of names) {
      const found = await resolveSubject(undefined, String(name || '').trim())
      if (found && found.id !== target.id) sourceIds.add(found.id)
    }
    if (!sourceIds.size) return JSON.stringify({ error: '请提供要并入的 source_ids 或 source_names' })
    const merged = await databaseService.mergeStudySubjects(target.id, [...sourceIds])
    notifyStudyGraph(merged.id)
    openStudyGraphPane(merged.id)
    return JSON.stringify({
      ...summarizeSubjects([merged])[0],
      merged_from: [...sourceIds],
      message: `已把 ${sourceIds.size} 个科目并入「${merged.name}」`,
    })
  },

  split_subject: async ({ args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId())
    if (!subject) return JSON.stringify({ error: '找不到要拆分的科目' })
    const payload = await databaseService.getStudyGraph(subject.id)
    const resolvePartNodes = (ids: unknown, names: unknown) => {
      const set = new Set<number>()
      for (const value of Array.isArray(ids) ? ids : []) {
        const id = Number(value)
        if (payload.nodes.some((item) => item.id === id)) set.add(id)
      }
      for (const raw of Array.isArray(names) ? names : []) {
        const name = String(raw || '').trim()
        if (!name) continue
        const exact = payload.nodes.find((item) => item.name === name)
        const fuzzy = exact ? [exact] : payload.nodes.filter((item) => item.name.includes(name) || name.includes(item.name))
        if (fuzzy.length === 1) set.add(fuzzy[0].id)
      }
      return [...set]
    }
    const rawParts = Array.isArray(args.parts) ? args.parts : []
    const parts = rawParts.length
      ? rawParts.map((part: any) => ({
        name: String(part?.name || '').trim(),
        description: String(part?.description || ''),
        node_ids: resolvePartNodes(part?.node_ids, part?.node_names),
      }))
      : [{
        name: String(args.name || '').trim(),
        description: String(args.description || ''),
        node_ids: resolvePartNodes(args.node_ids, args.node_names),
      }]
    const valid = parts.filter((part) => part.name && part.node_ids.length)
    if (!valid.length) {
      return JSON.stringify({ error: '请提供要拆出的科目名，以及 node_ids 或准确的章/节名' })
    }
    const result = await databaseService.splitStudySubject(subject.id, valid)
    notifyStudyGraph(subject.id)
    for (const created of result.created) notifyStudyGraph(created.id)
    return JSON.stringify({
      original: summarizeSubjects([result.original])[0],
      created: summarizeSubjects(result.created),
      message: `已从「${subject.name}」拆出 ${result.created.map((item) => item.name).join('、')}`,
    })
  },

  evaluate_study_progress: async ({ call, args, ctx }) => {
    const subject = await resolveSubjectFromArgs(args, ctx.studySubjectId())
    if (!subject) {
      return JSON.stringify({ error: '找不到科目，请先挂上学习状态或指定 subject_id' })
    }
    const hint = String(args.hint || args.notes || args.topic || '').trim()
    ctx.scheduleEval({
      subjectId: subject.id,
      hint,
      stepId: call.id,
    })
    return JSON.stringify({
      started: true,
      subject_id: subject.id,
      name: subject.name,
      message: '掌握度评估已交给后台助手，评估完会告诉用户。继续对话即可，不要等待评估结束，也不要口头打分。',
    })
  },
}
