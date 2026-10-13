/** 知识图谱 / 遗忘。SQL 在 src-tauri/src/database/study_graph.rs。 */
import { invoke } from '@tauri-apps/api/core'
import {
  applyForgettingToNode,
  clampForgettingStage,
  effectiveMastery,
  nextForgettingStage,
  parseStudyQuality,
  reviewedAtForQuality,
  reviewedAtFromDaysAgo,
} from '../../../utils/study/studyForgetting'
import { isTauri } from './env'
import {
  descendantNodeIds,
  emitStudyActivityUpdated,
  replaceList,
  mockQuestionKnowledge,
  mockStudyActivity,
  mockStudyGraphs,
  mockStudySubjects,
  mockStudyTimelineSummaries,
  pushMockActivity,
  refreshMockSubjectProgress,
  withForgettingGraph,
} from './mock'
import type {
  QuestionKnowledgeLink,
  SplitSubjectPart,
  StudyActivity,
  StudyGraphNodeInput,
  StudyGraphNodePatch,
  StudyGraphPayload,
  StudyProgressUpdate,
  StudySubject,
  StudyTimelineSummary,
} from './types'

export async function listStudySubjects(): Promise<StudySubject[]> {
  if (!isTauri()) {
    mockStudySubjects.forEach((item) => refreshMockSubjectProgress(item.id))
    return mockStudySubjects.map((item) => ({ ...item }))
  }
  return invoke<StudySubject[]>('list_study_subjects')
}

export async function createStudySubject(name: string, description = ''): Promise<StudySubject> {
  if (!isTauri()) {
    const subject: StudySubject = {
      id: Date.now(),
      name: name.trim(),
      description,
      create_time: new Date().toISOString(),
      node_count: 0,
      progress: 0,
    }
    mockStudySubjects.unshift(subject)
    return { ...subject }
  }
  return invoke<StudySubject>('create_study_subject', { name, description })
}

export async function renameStudySubject(id: number, name?: string, description?: string): Promise<StudySubject> {
  if (!isTauri()) {
    const subject = mockStudySubjects.find((item) => item.id === id)
    if (!subject) throw new Error('学习科目不存在')
    if (name?.trim()) subject.name = name.trim()
    if (description != null) subject.description = description
    return { ...subject }
  }
  return invoke<StudySubject>('rename_study_subject', { id, name, description })
}

export async function deleteStudySubject(id: number): Promise<void> {
  if (!isTauri()) {
    replaceList(mockStudySubjects, mockStudySubjects.filter((item) => item.id !== id))
    mockStudyGraphs.delete(id)
    return
  }
  await invoke('delete_study_subject', { id })
}

export async function getStudyGraph(subjectId: number): Promise<StudyGraphPayload> {
  if (!isTauri()) {
    const subject = mockStudySubjects.find((item) => item.id === subjectId)
    if (!subject) throw new Error('学习科目不存在')
    const graph = mockStudyGraphs.get(subjectId)
    return withForgettingGraph({
      subject: { ...subject, node_count: graph?.nodes.length || 0 },
      nodes: (graph?.nodes || []).map((item) => ({ ...item })),
      edges: graph?.edges || [],
    })
  }
  return withForgettingGraph(await invoke<StudyGraphPayload>('get_study_graph', { subjectId }))
}

export async function setStudyGraph(
  subjectId: number,
  nodes: StudyGraphNodeInput[],
  edges?: { from_key: string; to_key: string; relation?: string }[],
): Promise<StudyGraphPayload> {
  if (!isTauri()) {
    const subject = mockStudySubjects.find((item) => item.id === subjectId)
    if (!subject) throw new Error('学习科目不存在')
    const rows: StudyGraphNodeRow[] = nodes.map((node, index) => ({
      id: Date.now() + index,
      subject_id: subjectId,
      node_key: node.key || `n${index + 1}`,
      name: node.name,
      summary: node.summary || '',
      mastery: node.mastery || 0,
      parent_id: null,
      sort_order: index,
      forgetting_stage: 0,
      last_reviewed_at: null,
    }))
    const byKey = new Map(rows.map((item) => [item.node_key, item]))
    const byName = new Map(rows.map((item) => [item.name, item]))
    nodes.forEach((node, index) => {
      const parent = node.parent_key
        ? byKey.get(node.parent_key) || byName.get(node.parent_key)
        : undefined
      if (parent && parent.id !== rows[index].id) {
        rows[index].parent_id = parent.id
      }
    })
    const edgeRows: StudyGraphEdgeRow[] = (edges || []).map((edge, index) => ({
      id: Date.now() + index,
      subject_id: subjectId,
      from_id: byKey.get(edge.from_key)?.id || 0,
      to_id: byKey.get(edge.to_key)?.id || 0,
      relation: edge.relation || '',
    }))
    mockStudyGraphs.set(subjectId, { nodes: rows, edges: edgeRows })
    refreshMockSubjectProgress(subjectId)
    return withForgettingGraph({ subject: { ...subject }, nodes: rows, edges: edgeRows })
  }
  return invoke<StudyGraphPayload>('set_study_graph', { subjectId, nodes, edges })
}

export async function patchStudyGraph(
  subjectId: number,
  patch: {
    add?: StudyGraphNodeInput[]
    update?: StudyGraphNodePatch[]
    remove_ids?: number[]
  },
): Promise<StudyGraphPayload> {
  if (!isTauri()) {
    const current = await getStudyGraph(subjectId)
    const remove = new Set(patch.remove_ids || [])
    let nodes = current.nodes.filter((item) => !remove.has(item.id))
    for (const item of patch.update || []) {
      const node = nodes.find((row) => row.id === item.id)
      if (!node) continue
      if (item.name != null) node.name = item.name
      if (item.summary != null) node.summary = item.summary
      if (item.mastery != null) node.mastery = item.mastery
      if (item.forgetting_stage != null) node.forgetting_stage = clampForgettingStage(item.forgetting_stage)
      if (item.last_reviewed_at !== undefined) node.last_reviewed_at = item.last_reviewed_at
      if (item.parent_id != null) node.parent_id = item.parent_id || null
    }
    mockStudyGraphs.set(subjectId, { nodes, edges: current.edges })
    if (patch.add?.length) {
      return setStudyGraph(subjectId, [
        ...nodes.map((item) => ({
          key: item.node_key,
          name: item.name,
          summary: item.summary,
          parent_key: nodes.find((row) => row.id === item.parent_id)?.node_key,
          mastery: item.mastery,
        })),
        ...patch.add,
      ])
    }
    refreshMockSubjectProgress(subjectId)
    return getStudyGraph(subjectId)
  }
  return withForgettingGraph(await invoke<StudyGraphPayload>('patch_study_graph', {
    subjectId,
    add: patch.add,
    update: patch.update,
    removeIds: patch.remove_ids,
  }))
}

export async function applyStudyProgress(subjectId: number, updates: StudyProgressUpdate[]): Promise<StudyGraphPayload> {
  const normalized = updates.slice(0, 24).map((item) => ({
    id: Number(item.id) > 0 ? Number(item.id) : undefined,
    name: String(item.name || '').trim() || undefined,
    forgetting_stage: item.forgetting_stage == null ? undefined : clampForgettingStage(item.forgetting_stage),
    last_reviewed_at: item.last_reviewed_at,
    days_ago: item.days_ago,
    quality: item.quality ? parseStudyQuality(item.quality) : undefined,
    kind: item.kind,
    remembered: item.remembered,
    mastery: item.mastery,
  }))
  if (!isTauri()) {
    const graph = mockStudyGraphs.get(subjectId)
    if (!graph) throw new Error('学习科目不存在')
    const learned: string[] = []
    const reviewed: string[] = []
    for (const item of normalized) {
      const node = graph.nodes.find((row) => item.id && row.id === item.id)
        || graph.nodes.find((row) => item.name && row.name === item.name)
        || (item.name && item.name.length >= 4
          ? graph.nodes.find((row) => row.name.includes(item.name) || item.name.includes(row.name))
          : undefined)
      if (!node) continue
      if (graph.nodes.some((row) => row.parent_id === node.id)) continue
      const hadReview = Boolean(String(node.last_reviewed_at || '').trim())
      const prevStage = Number(node.forgetting_stage) || 0
      const quality = item.quality || (item.forgetting_stage != null && item.forgetting_stage < prevStage ? 'poor' : 'good')
      const remembered = item.remembered ?? quality !== 'poor'
      const now = Date.now()
      node.forgetting_stage = nextForgettingStage(node, { remembered, at: now })
      const historical = Number(item.days_ago)
      const storedAt = item.last_reviewed_at
        || (Number.isFinite(historical) && historical > 0.05 && !item.quality
          ? reviewedAtFromDaysAgo(historical)
          : reviewedAtForQuality(node.forgetting_stage, quality, now))
      node.last_reviewed_at = storedAt
      node.mastery = item.mastery == null
        ? effectiveMastery({ ...node, last_reviewed_at: storedAt, forgetting_stage: node.forgetting_stage })
        : item.mastery
      if (item.kind === 'learn' || (!hadReview && prevStage <= 0)) learned.push(node.name)
      else reviewed.push(node.name)
    }
    const now = new Date().toISOString()
    pushMockActivity({ subject_id: subjectId, kind: 'learn', names: learned, question_count: 0, correct_count: 0, create_time: now })
    pushMockActivity({ subject_id: subjectId, kind: 'review', names: reviewed, question_count: 0, correct_count: 0, create_time: now })
    refreshMockSubjectProgress(subjectId)
    emitStudyActivityUpdated(subjectId)
    return getStudyGraph(subjectId)
  }
  const payload = withForgettingGraph(await invoke<StudyGraphPayload>('apply_study_progress', {
    subjectId,
    updates: normalized,
  }))
  emitStudyActivityUpdated(subjectId)
  return payload
}

export async function listStudyActivity(subjectId: number, limit = 80): Promise<StudyActivity[]> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return []
  if (!isTauri()) {
    return mockStudyActivity
      .filter((item) => item.subject_id === subjectId)
      .slice(0, Math.max(1, limit))
      .map((item) => ({ ...item, names: [...item.names] }))
  }
  return invoke<StudyActivity[]>('list_study_activity', { subjectId, limit })
}

export async function listStudyActivityBetween(subjectId: number, startMs: number, endMs: number): Promise<StudyActivity[]> {
  if (!Number.isFinite(subjectId) || subjectId <= 0 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return []
  }
  if (!isTauri()) {
    return mockStudyActivity
      .filter((item) => {
        if (item.subject_id !== subjectId) return false
        const stamp = Date.parse(item.create_time)
        return Number.isFinite(stamp) && stamp >= startMs && stamp < endMs
      })
      .map((item) => ({ ...item, names: [...item.names] }))
  }
  return invoke<StudyActivity[]>('list_study_activity_between', { subjectId, startMs, endMs })
}

export async function listStudyHeatmap(subjectId: number): Promise<Array<{ names: string[]; create_time: string }>> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return []
  if (!isTauri()) {
    return mockStudyActivity
      .filter((item) => item.subject_id === subjectId && (item.kind === 'learn' || item.kind === 'review'))
      .map((item) => ({ names: [...item.names], create_time: item.create_time }))
  }
  return invoke('list_study_heatmap', { subjectId })
}

export async function listStudyTimelineSummaries(subjectId: number, limit = 120): Promise<StudyTimelineSummary[]> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return []
  if (!isTauri()) {
    return mockStudyTimelineSummaries
      .filter((item) => item.subject_id === subjectId)
      .slice(0, Math.max(1, limit))
      .map((item) => ({ ...item }))
  }
  return invoke<StudyTimelineSummary[]>('list_study_timeline_summaries', { subjectId, limit })
}

export async function getStudyTimelineSummaryCursor(subjectId: number): Promise<number> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return 0
  if (!isTauri()) {
    return mockStudyTimelineSummaries
      .filter((item) => item.subject_id === subjectId)
      .reduce((max, item) => Math.max(max, item.covered_through_id), 0)
  }
  return invoke<number>('get_study_timeline_summary_cursor', { subjectId })
}

export async function listUnsummarizedStudyActivity(subjectId: number, afterId = 0, limit = 200): Promise<StudyActivity[]> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return []
  if (!isTauri()) {
    return mockStudyActivity
      .filter((item) => item.subject_id === subjectId && item.id > afterId)
      .slice(0, Math.max(1, limit))
      .map((item) => ({ ...item, names: [...item.names] }))
  }
  return invoke<StudyActivity[]>('list_unsummarized_study_activity', { subjectId, afterId, limit })
}

export async function insertStudyTimelineSummary(input: {
  subjectId: number
  text: string
  startTime: string
  endTime: string
  coveredThroughId: number
  activityCount: number
}): Promise<StudyTimelineSummary> {
  if (!isTauri()) {
    const row: StudyTimelineSummary = {
      id: mockStudyTimelineSummaries.length + 1,
      subject_id: input.subjectId,
      text: input.text.trim(),
      start_time: input.startTime,
      end_time: input.endTime,
      covered_through_id: input.coveredThroughId,
      activity_count: input.activityCount,
      create_time: new Date().toISOString(),
    }
    mockStudyTimelineSummaries.unshift(row)
    return row
  }
  const row = await invoke<StudyTimelineSummary>('insert_study_timeline_summary', {
    subjectId: input.subjectId,
    text: input.text,
    startTime: input.startTime,
    endTime: input.endTime,
    coveredThroughId: input.coveredThroughId,
    activityCount: input.activityCount,
  })
  emitStudyActivityUpdated(input.subjectId)
  return row
}

export async function linkQuestionsToNode(questionIds: number[], nodeId: number): Promise<number> {
  const ids = [...new Set(questionIds.filter((id) => id > 0))]
  if (!ids.length) return 0
  if (!isTauri()) {
    for (const id of ids) {
      if (!mockQuestionKnowledge.some((item) => item.question_id === id && item.node_id === nodeId)) {
        mockQuestionKnowledge.push({ question_id: id, node_id: nodeId })
      }
    }
    return ids.length
  }
  return invoke<number>('link_questions_to_node', { questionIds: ids, nodeId })
}

export async function unlinkQuestionKnowledge(questionId: number, nodeId?: number): Promise<void> {
  if (!isTauri()) {
    replaceList(mockQuestionKnowledge, mockQuestionKnowledge.filter((item) =>
      item.question_id !== questionId || (nodeId != null && item.node_id !== nodeId),
    ))
    return
  }
  await invoke('unlink_question_knowledge', { questionId, nodeId: nodeId ?? null })
}

export async function listQuestionKnowledge(questionIds: number[]): Promise<QuestionKnowledgeLink[]> {
  const ids = [...new Set(questionIds.filter((id) => id > 0))]
  if (!ids.length) return []
  if (!isTauri()) {
    const links: QuestionKnowledgeLink[] = []
    for (const item of mockQuestionKnowledge) {
      if (!ids.includes(item.question_id)) continue
      for (const [subjectId, graph] of mockStudyGraphs) {
        const node = graph.nodes.find((row) => row.id === item.node_id)
        if (!node) continue
        const subject = mockStudySubjects.find((row) => row.id === subjectId)
        links.push({
          question_id: item.question_id,
          node_id: node.id,
          node_name: node.name,
          subject_id: subjectId,
          subject_name: subject?.name || '',
        })
      }
    }
    return links
  }
  return invoke<QuestionKnowledgeLink[]>('list_question_knowledge', { questionIds: ids })
}

export async function listNodeQuestions(nodeId: number): Promise<number[]> {
  if (!isTauri()) {
    const ids = descendantNodeIds(nodeId)
    return [...new Set(
      mockQuestionKnowledge
        .filter((item) => ids.has(item.node_id))
        .map((item) => item.question_id),
    )]
  }
  return invoke<number[]>('list_node_questions', { nodeId })
}

export async function listSubjectQuestions(subjectId: number): Promise<number[]> {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return []
  if (!isTauri()) {
    const graph = mockStudyGraphs.get(subjectId)
    const nodeIds = new Set((graph?.nodes || []).map((item) => item.id))
    return [...new Set(
      mockQuestionKnowledge
        .filter((item) => nodeIds.has(item.node_id))
        .map((item) => item.question_id),
    )]
  }
  try {
    return await invoke<number[]>('list_subject_questions', { subjectId })
  } catch {
    const graph = await getStudyGraph(subjectId)
    const ids = new Set<number>()
    for (const node of graph.nodes) {
      for (const questionId of await listNodeQuestions(node.id)) ids.add(questionId)
    }
    return [...ids]
  }
}

export async function mergeStudySubjects(targetId: number, sourceIds: number[]): Promise<StudySubject> {
  if (!isTauri()) {
    const target = mockStudySubjects.find((item) => item.id === targetId)
    if (!target) throw new Error('目标科目不存在')
    const targetGraph = mockStudyGraphs.get(targetId) || { nodes: [], edges: [] }
    for (const sourceId of sourceIds.filter((id) => id !== targetId)) {
      const source = mockStudyGraphs.get(sourceId)
      if (source) {
        targetGraph.nodes.push(...source.nodes.map((node) => ({ ...node, subject_id: targetId })))
        targetGraph.edges.push(...source.edges.map((edge) => ({ ...edge, subject_id: targetId })))
      }
      mockStudyGraphs.delete(sourceId)
      replaceList(mockStudySubjects, mockStudySubjects.filter((item) => item.id !== sourceId))
    }
    mockStudyGraphs.set(targetId, targetGraph)
    refreshMockSubjectProgress(targetId)
    return { ...target }
  }
  return invoke<StudySubject>('merge_study_subjects', { targetId, sourceIds })
}

export async function splitStudySubject(subjectId: number, parts: SplitSubjectPart[]): Promise<{ original: StudySubject; created: StudySubject[] }> {
  if (!isTauri()) {
    const created: StudySubject[] = []
    const graph = mockStudyGraphs.get(subjectId)
    if (!graph) throw new Error('科目不存在')
    for (const part of parts) {
      const ids = new Set(part.node_ids)
      const nodes = graph.nodes.filter((node) => ids.has(node.id) || (node.parent_id != null && ids.has(node.parent_id)))
      if (!nodes.length) continue
      const subject = await createStudySubject(part.name, part.description || '')
      const nodeIds = new Set(nodes.map((node) => node.id))
      mockStudyGraphs.set(subject.id, {
        nodes: nodes.map((node) => ({ ...node, subject_id: subject.id })),
        edges: graph.edges.filter((edge) => nodeIds.has(edge.from_id) && nodeIds.has(edge.to_id))
          .map((edge) => ({ ...edge, subject_id: subject.id })),
      })
      graph.nodes = graph.nodes.filter((node) => !nodeIds.has(node.id))
      graph.edges = graph.edges.filter((edge) => !nodeIds.has(edge.from_id) && !nodeIds.has(edge.to_id))
      refreshMockSubjectProgress(subject.id)
      created.push(subject)
    }
    refreshMockSubjectProgress(subjectId)
    const original = mockStudySubjects.find((item) => item.id === subjectId)
    if (!original) throw new Error('科目不存在')
    return { original: { ...original }, created }
  }
  return invoke('split_study_subject', { subjectId, parts })
}

// 移动文件夹

