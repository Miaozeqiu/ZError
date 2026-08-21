export type ProgressEvidenceNode = {
  id: number
  name: string
  node_key?: string
  parent_id?: number | null
}

export type ProgressEvidenceUpdate = {
  id?: number
  name?: string
  forgetting_stage: number
  last_reviewed_at?: string
}

const GENERIC_TOKENS = new Set([
  '基础', '入门', '概述', '导论', '知识', '语法', '编程', '学习', '简介',
  '其他', '应用', '核心', '综合', '方法', '实践', '理论', '要点', '内容',
  '类型', '结构', '操作', '处理', '管理', '系统', '原理', '概念', '技术',
  'python', 'java', 'javascript', 'c++',
])

const compact = (value: string) => String(value || '').replace(/\s+/g, '').toLowerCase()

export const progressNameTokens = (name: string) =>
  String(name || '')
    .split(/[、，,/]|与|和/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !GENERIC_TOKENS.has(item.toLowerCase()))

const parentIdSet = (nodes: ProgressEvidenceNode[]) =>
  new Set(nodes.map((item) => item.parent_id).filter((id): id is number => id != null))

const tokenOwners = (nodes: ProgressEvidenceNode[], parents: Set<number>) => {
  const owners = new Map<string, number[]>()
  for (const node of nodes) {
    if (parents.has(node.id)) continue
    for (const token of progressNameTokens(node.name)) {
      const key = compact(token)
      const list = owners.get(key) || []
      list.push(node.id)
      owners.set(key, list)
    }
  }
  return owners
}

const resolveNode = (nodes: ProgressEvidenceNode[], update: ProgressEvidenceUpdate) => {
  if (update.id) {
    const byId = nodes.find((item) => item.id === update.id)
    if (byId) return byId
  }
  const name = String(update.name || '').trim()
  if (!name) return null
  return nodes.find((item) => item.name === name || item.node_key === name)
    || nodes.find((item) => item.name.includes(name) || name.includes(item.name))
    || null
}

export const nodeHasProgressEvidence = (
  node: Pick<ProgressEvidenceNode, 'id' | 'name'>,
  evidence: string,
  owners: Map<string, number[]>,
) => {
  const hay = compact(evidence)
  if (!hay || !node.name) return false
  if (hay.includes(compact(node.name))) return true
  const hits = progressNameTokens(node.name).filter((token) => hay.includes(compact(token)))
  if (!hits.length) return false
  if (hits.some((token) => compact(token).length >= 4)) return true
  if (hits.length >= 2) return true
  return hits.some((token) => (owners.get(compact(token)) || []).length === 1)
}

export const filterProgressUpdates = (
  nodes: ProgressEvidenceNode[],
  updates: ProgressEvidenceUpdate[],
  evidence: string,
) => {
  const parents = parentIdSet(nodes)
  const owners = tokenOwners(nodes, parents)
  const seen = new Set<number>()
  const allowed: ProgressEvidenceUpdate[] = []
  const rejected: string[] = []

  for (const update of updates) {
    const node = resolveNode(nodes, update)
    if (!node) {
      rejected.push(update.name || String(update.id || ''))
      continue
    }
    if (parents.has(node.id) || seen.has(node.id) || !nodeHasProgressEvidence(node, evidence, owners)) {
      rejected.push(node.name)
      continue
    }
    seen.add(node.id)
    allowed.push({ ...update, id: node.id, name: node.name })
  }

  const hay = compact(evidence)
  const childrenOf = new Map<number, ProgressEvidenceUpdate[]>()
  for (const item of allowed) {
    const node = nodes.find((row) => row.id === item.id)
    const parentId = node?.parent_id
    if (parentId == null) continue
    const list = childrenOf.get(parentId) || []
    list.push(item)
    childrenOf.set(parentId, list)
  }
  const keep = new Set(allowed.map((item) => item.id))
  for (const siblings of childrenOf.values()) {
    if (siblings.length < 3) continue
    for (const item of siblings) {
      if (item.name && hay.includes(compact(item.name))) continue
      keep.delete(item.id)
      rejected.push(item.name || String(item.id || ''))
    }
  }

  return { allowed: allowed.filter((item) => keep.has(item.id)).slice(0, 8), rejected }
}
