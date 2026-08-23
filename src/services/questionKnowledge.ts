import { databaseService, type QuestionKnowledgeLink, type StudyGraphNodeRow, type StudyGraphPayload } from './database'

export interface QuestionKnowledgeHint {
  questionId: number
  question?: string
  node_id?: number
  node_name?: string
  knowledge_point?: string
  parent_name?: string
  subject_id?: number
}

export interface AssociateKnowledgeResult {
  linked: number
  created: number
  skipped: number
  links: QuestionKnowledgeLink[]
}

const PENDING_BUCKET = '待整理'

const clipName = (text: string, max = 18) => {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[？?。.!！]+$/g, '')
    .trim()
  if (!clean) return '未命名知识点'
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

const compact = (value: string) => value.replace(/\s+/g, '').toLowerCase()

const matchNode = (nodes: StudyGraphNodeRow[], name: string) => {
  const raw = String(name || '').trim()
  if (!raw) return null
  const exact = nodes.find((item) => item.name === raw || item.node_key === raw)
  if (exact) return exact
  const needle = compact(raw)
  const fuzzy = nodes.filter((item) => {
    const hay = compact(item.name)
    return hay === needle || hay.includes(needle) || needle.includes(hay)
  })
  if (fuzzy.length === 1) return fuzzy[0]
  return fuzzy.find((item) => item.name.startsWith(raw) || raw.startsWith(item.name)) || null
}

const hintName = (item: QuestionKnowledgeHint) =>
  String(item.node_name || item.knowledge_point || '').trim()

const loadGraph = async (
  cache: Map<number, StudyGraphPayload>,
  subjectId: number,
) => {
  const cached = cache.get(subjectId)
  if (cached) return cached
  const payload = await databaseService.getStudyGraph(subjectId)
  cache.set(subjectId, payload)
  return payload
}

const findSubjectForNode = async (
  cache: Map<number, StudyGraphPayload>,
  nodeId: number,
) => {
  const subjects = await databaseService.listStudySubjects()
  for (const subject of subjects) {
    const graph = await loadGraph(cache, subject.id)
    if (graph.nodes.some((item) => item.id === nodeId)) return subject.id
  }
  return 0
}

const matchSubjectFromText = async (text: string) => {
  const raw = String(text || '').trim()
  if (!raw) return 0
  const subjects = await databaseService.listStudySubjects()
  const ranked = subjects
    .filter((item) => item.name && item.name.length >= 2 && raw.includes(item.name))
    .sort((a, b) => b.name.length - a.name.length)
  return ranked[0]?.id || 0
}

const ensurePendingBucket = async (
  cache: Map<number, StudyGraphPayload>,
  subjectId: number,
) => {
  const graph = await loadGraph(cache, subjectId)
  const existing = graph.nodes.find((item) => item.name === PENDING_BUCKET && !item.parent_id)
  if (existing) return existing
  const next = await databaseService.patchStudyGraph(subjectId, {
    add: [{ name: PENDING_BUCKET, summary: '导入或出题时尚未归入章节的知识点' }],
  })
  cache.set(subjectId, next)
  return next.nodes.find((item) => item.name === PENDING_BUCKET && !item.parent_id) || null
}

const createKnowledgeNode = async (
  cache: Map<number, StudyGraphPayload>,
  subjectId: number,
  name: string,
  parent?: StudyGraphNodeRow | null,
) => {
  const next = await databaseService.patchStudyGraph(subjectId, {
    add: [{
      name,
      parent_key: parent?.node_key,
      summary: parent ? '' : '由题目自动生成',
    }],
  })
  cache.set(subjectId, next)
  const created = next.nodes.find((item) => (
    item.name === name
    && (parent ? item.parent_id === parent.id : true)
  ))
  return created || matchNode(next.nodes, name)
}

export const associateQuestionsToKnowledge = async (
  items: QuestionKnowledgeHint[],
  options?: {
    subjectId?: number
    hintText?: string
    createMissing?: boolean
  },
): Promise<AssociateKnowledgeResult> => {
  const createMissing = options?.createMissing !== false
  const cache = new Map<number, StudyGraphPayload>()
  const fallbackSubject = Number(options?.subjectId) > 0
    ? Number(options?.subjectId)
    : await matchSubjectFromText(options?.hintText || '')
  let linked = 0
  let created = 0
  let skipped = 0
  const seen = new Set<string>()

  for (const item of items) {
    if (!(item.questionId > 0)) {
      skipped += 1
      continue
    }
    let node: StudyGraphNodeRow | null = null
    let subjectId = Number(item.subject_id) > 0 ? Number(item.subject_id) : fallbackSubject
    const name = hintName(item)

    if (Number(item.node_id) > 0) {
      if (!subjectId) subjectId = await findSubjectForNode(cache, Number(item.node_id))
      if (subjectId) {
        const graph = await loadGraph(cache, subjectId)
        node = graph.nodes.find((row) => row.id === Number(item.node_id)) || null
      }
    }

    if (!node && name && subjectId) {
      const graph = await loadGraph(cache, subjectId)
      node = matchNode(graph.nodes, name)
    }

    if (!node && createMissing && subjectId) {
      const graph = await loadGraph(cache, subjectId)
      const parent = item.parent_name ? matchNode(graph.nodes, item.parent_name) : null
      const leafName = name || clipName(item.question || '')
      if (parent && leafName) {
        node = await createKnowledgeNode(cache, subjectId, leafName, parent)
        if (node) created += 1
      } else if (name) {
        const bucket = await ensurePendingBucket(cache, subjectId)
        node = await createKnowledgeNode(cache, subjectId, name, bucket)
        if (node) created += 1
      } else {
        node = await ensurePendingBucket(cache, subjectId)
      }
    }

    if (!node) {
      skipped += 1
      continue
    }
    const key = `${item.questionId}:${node.id}`
    if (seen.has(key)) continue
    seen.add(key)
    await databaseService.linkQuestionsToNode([item.questionId], node.id)
    linked += 1
  }

  const questionIds = [...new Set(items.map((item) => item.questionId).filter((id) => id > 0))]
  const links = questionIds.length ? await databaseService.listQuestionKnowledge(questionIds) : []
  return { linked, created, skipped, links }
}

export const openKnowledgeInStudy = (link: Pick<QuestionKnowledgeLink, 'subject_id' | 'node_name' | 'node_id'>) => {
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'study' }))
  window.dispatchEvent(new CustomEvent('open-study-graph', {
    detail: { subjectId: link.subject_id, nodeName: link.node_name, nodeId: link.node_id },
  }))
}

export const notifyQuestionKnowledgeUpdated = (detail?: { subjectId?: number; nodeId?: number; questionId?: number }) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('question-knowledge-updated', { detail }))
}
