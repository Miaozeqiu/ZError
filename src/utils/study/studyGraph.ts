import type {
  StudyGraphEdgeRow,
  StudyGraphNodeInput,
  StudyGraphNodeRow,
  StudyGraphPayload,
  StudySubject,
} from '../../services/app/database'
import { masteryLabel, normalizeMetric } from '../question/questionMetrics'
import { rolledRetention } from './studyForgetting'

export interface StudyProgress {
  count: number
  mastered: number
  fair: number
  weak: number
  unset: number
  progress: number
}

export interface StudyGraphNode {
  id: string
  nodeId?: number
  name: string
  summary?: string
  mastery?: number
  importance?: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
  stats: StudyProgress
  children: StudyGraphNode[]
  extraLinks?: { from: string; to: string }[]
}

export const statsFromMastery = (mastery?: number, count = 1): StudyProgress => {
  const value = normalizeMetric(mastery)
  return {
    count,
    mastered: value === 3 ? count : 0,
    fair: value === 2 ? count : 0,
    weak: value === 1 ? count : 0,
    unset: value === 0 ? count : 0,
    progress: value / 3,
  }
}

export const mergeStats = (items: StudyProgress[]): StudyProgress => {
  const stats: StudyProgress = { count: 0, mastered: 0, fair: 0, weak: 0, unset: 0, progress: 0 }
  for (const item of items) {
    stats.count += item.count
    stats.mastered += item.mastered
    stats.fair += item.fair
    stats.weak += item.weak
    stats.unset += item.unset
  }
  stats.progress = stats.count
    ? (stats.mastered * 3 + stats.fair * 2 + stats.weak) / (stats.count * 3)
    : 0
  return stats
}

export const subjectStats = (subject: StudySubject): StudyProgress => ({
  count: subject.node_count || 0,
  mastered: 0,
  fair: 0,
  weak: 0,
  unset: 0,
  progress: Number(subject.progress) || 0,
})

const applyRolledStats = (node: StudyGraphNode, now = Date.now()): StudyGraphNode => {
  node.children.forEach((child) => applyRolledStats(child, now))
  node.stats = {
    ...node.stats,
    progress: rolledRetention(node, now) ?? 0,
  }
  return node
}

export const graphFromPayload = (payload: StudyGraphPayload): StudyGraphNode => {
  const byId = new Map<number, StudyGraphNode>()
  const rows = payload.nodes.filter((row) => !isJunkGraphNode({ key: row.node_key, name: row.name }))
  for (const row of rows) {
    byId.set(row.id, {
      id: `node:${row.id}`,
      nodeId: row.id,
      name: isBadGraphLabel(row.name) ? row.node_key : row.name,
      summary: row.summary,
      mastery: normalizeMetric(row.mastery),
      importance: normalizeMetric(row.importance),
      forgetting_stage: row.forgetting_stage,
      last_reviewed_at: row.last_reviewed_at,
      stats: statsFromMastery(row.mastery),
      children: [],
    })
  }
  const roots: StudyGraphNode[] = []
  for (const row of rows) {
    const node = byId.get(row.id)
    if (!node) continue
    const parent = row.parent_id ? byId.get(row.parent_id) : null
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }
  const extraLinks = payload.edges
    .filter((edge) => byId.has(edge.from_id) && byId.has(edge.to_id) && edge.from_id !== edge.to_id)
    .map((edge) => ({ from: `node:${edge.from_id}`, to: `node:${edge.to_id}` }))
  const stats = mergeStats(rows.map((row) => statsFromMastery(row.mastery)))
  return applyRolledStats({
    id: `subject:${payload.subject.id}`,
    name: payload.subject.name,
    summary: payload.subject.description,
    stats,
    children: roots,
    extraLinks,
  })
}

export const flattenGraph = (root: StudyGraphNode) => {
  const nodes: StudyGraphNode[] = []
  const links: { from: string; to: string }[] = [...(root.extraLinks || [])]
  const walk = (node: StudyGraphNode) => {
    nodes.push(node)
    for (const child of node.children) {
      links.push({ from: node.id, to: child.id })
      walk(child)
    }
  }
  walk(root)
  return { nodes, links }
}

export const nodeMasteryText = (value?: number) => masteryLabel(value)

export const progressColor = (progress: number) => {
  const t = Math.min(1, Math.max(0, progress))
  if (t < 0.5) {
    const u = t * 2
    return mix('#94a3b8', '#f59e0b', u)
  }
  return mix('#f59e0b', '#16a34a', (t - 0.5) * 2)
}

const mix = (a: string, b: string, t: number) => {
  const pa = hex(a)
  const pb = hex(b)
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t)
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t)
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

const hex = (value: string): [number, number, number] => {
  const raw = value.replace('#', '')
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return value
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch {
      return value
    }
  }
  return value
}

const unwrapNodeList = (raw: unknown, depth = 0): unknown[] => {
  if (depth > 4) return []
  const value = parseMaybeJson(raw)
  if (Array.isArray(value)) return value
  const obj = asRecord(value)
  if (!obj) return []
  for (const key of ['nodes', 'items', 'knowledge_points', 'knowledge', 'graph', 'data', 'children']) {
    if (obj[key] == null) continue
    const inner = unwrapNodeList(obj[key], depth + 1)
    if (inner.length) return inner
  }
  const entries = Object.entries(obj).filter(([key]) => !['subject_id', 'subjectId', 'subject_name', 'subjectName', 'edges', 'outline', 'nodes_text', 'graph_text', 'markdown', 'mermaid', 'diagram', 'nodes'].includes(key))
  if (
    entries.length
    && entries.every(([, item]) => typeof item === 'string' || (item && typeof item === 'object'))
    && entries.some(([, item]) => {
      if (typeof item === 'string') return Boolean(item.trim())
      const rec = asRecord(item)
      return Boolean(rec && (rec.name || rec.title || rec.label || rec.summary))
    })
  ) {
    return entries.map(([key, item]) => (
      typeof item === 'string' ? { key, name: item } : { key, ...(asRecord(item) || {}) }
    ))
  }
  if (obj.name || obj.title || obj.label) return [obj]
  return []
}

const slugKey = (name: string, index: number) => {
  const slug = name.replace(/[^\w\u4e00-\u9fff]+/g, '_').replace(/^_|_$/g, '').slice(0, 24)
  return slug || `n${index + 1}`
}

export const parseGraphNodeInputs = (raw: unknown): StudyGraphNodeInput[] => {
  const seen = new Set<string>()
  const nodes = unwrapNodeList(raw)
    .map((item, index) => {
      const parsed = parseMaybeJson(item)
      if (typeof parsed === 'string') {
        const name = parsed.trim()
        if (!name) return null
        let key = slugKey(name, index)
        let unique = key
        let n = 2
        while (seen.has(unique)) {
          unique = `${key}_${n}`
          n += 1
        }
        seen.add(unique)
        const node: StudyGraphNodeInput = { key: unique, name, summary: '', mastery: 0 }
        return node
      }
      const rec = asRecord(parsed)
      if (!rec) return null
      const name = String(rec.name || rec.title || rec.label || rec.node || rec.text || '').trim()
      if (!name) return null
      let key = String(rec.key || rec.node_key || rec.id || '').trim()
      if (!key || key === String(index) || /^\d+$/.test(key)) key = slugKey(name, index)
      let unique = key
      let n = 2
      while (seen.has(unique)) {
        unique = `${key}_${n}`
        n += 1
      }
      seen.add(unique)
      const parent = rec.parent_key ?? rec.parent ?? rec.parentKey
      const masteryRaw = rec.mastery ?? rec.level
      const mastery = typeof masteryRaw === 'number' ? masteryRaw : Number(masteryRaw)
      const node: StudyGraphNodeInput = {
        key: unique,
        name,
        summary: String(rec.summary || rec.desc || rec.description || rec.note || '').trim(),
        parent_key: parent == null || parent === '' ? undefined : String(parent),
        mastery: Number.isFinite(mastery) ? Math.max(0, Math.min(3, Math.round(mastery))) : 0,
      }
      return node
    })
    .filter((item): item is StudyGraphNodeInput => Boolean(item))
    .slice(0, 60)

  const byKey = new Map(nodes.map((item) => [item.key || '', item]))
  const byName = new Map(nodes.map((item) => [item.name, item]))
  for (const node of nodes) {
    if (!node.parent_key) continue
    if (node.parent_key === node.key || node.parent_key === node.name) {
      node.parent_key = undefined
      continue
    }
    if (byKey.has(node.parent_key)) continue
    const mapped = byName.get(node.parent_key)?.key
    if (mapped) node.parent_key = mapped
  }
  return nodes
}

const cleanOutlineName = (value: string) =>
  value
    .replace(/^[-*+•]\s+/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/^#+\s*/, '')
    .replace(/^[（(]?[A-Ha-h][)）、.]\s*/, '')
    .replace(/[*_`]/g, '')
    .trim()

const splitOutlineChildren = (value: string) =>
  value
    .split(/[、，,;；/|]/)
    .map((item) => cleanOutlineName(item))
    .filter((item) => item && !/^(\.\.\.|…)$/.test(item))

const usableGraphNodes = (nodes: StudyGraphNodeInput[]) =>
  nodes.length > 0 && !nodes.every((item) => /^(\.\.\.|…|nodes)$/i.test(item.name))

export const parseGraphOutline = (raw: unknown): StudyGraphNodeInput[] => {
  if (raw == null) return []
  if (typeof raw !== 'string') {
    const parsed = parseGraphNodeInputs(raw)
    return usableGraphNodes(parsed) ? parsed : []
  }
  const text = raw.replace(/\r/g, '').trim()
  if (!text) return []
  const fromJson = parseGraphNodeInputs(text)
  if (usableGraphNodes(fromJson)) return fromJson

  const nodes: StudyGraphNodeInput[] = []
  const seen = new Set<string>()
  const stack: { indent: number; key: string }[] = []
  const add = (name: string, parent?: string, summary = '') => {
    const trimmed = cleanOutlineName(name)
    if (!trimmed || /^(\.\.\.|…)$/.test(trimmed)) return null
    let key = slugKey(trimmed, nodes.length)
    let unique = key
    let n = 2
    while (seen.has(unique)) {
      unique = `${key}_${n}`
      n += 1
    }
    seen.add(unique)
    const node: StudyGraphNodeInput = {
      key: unique,
      name: trimmed,
      summary,
      parent_key: parent,
      mastery: 0,
    }
    nodes.push(node)
    return node
  }

  for (const line of text.split('\n')) {
    if (!line.trim() || /^```/.test(line.trim())) continue
    const indent = line.match(/^(\s*)/)?.[1].replace(/\t/g, '  ').length || 0
    const body = line.trim()
    const colon = body.match(/^(?:[-*+•]|\d+[.)、])?\s*(.+?)[：:]\s*(.+)$/)
    if (colon && /[、，,;；/|]/.test(colon[2])) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      const parent = add(colon[1], stack[stack.length - 1]?.key)
      if (parent) stack.push({ indent, key: parent.key || '' })
      for (const child of splitOutlineChildren(colon[2])) add(child, parent?.key)
      continue
    }
    const name = cleanOutlineName(body)
    if (!name) continue
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const node = add(name, stack[stack.length - 1]?.key)
    if (node) stack.push({ indent, key: node.key || '' })
  }
  return usableGraphNodes(nodes) ? nodes.slice(0, 60) : []
}

type GraphTreeItem = {
  name: string
  summary?: string
  children?: GraphTreeItem[]
}

const treeToNodes = (tree: GraphTreeItem[]): StudyGraphNodeInput[] => {
  const lines: string[] = []
  const summaries = new Map<string, string>()
  const walk = (item: GraphTreeItem, indent: number) => {
    lines.push(`${'  '.repeat(indent)}${item.name}`)
    if (item.summary) summaries.set(item.name, item.summary)
    for (const child of item.children || []) walk(child, indent + 1)
  }
  for (const item of tree) walk(item, 0)
  const nodes = parseGraphOutline(lines.join('\n'))
  for (const node of nodes) {
    node.summary = summaries.get(node.name) || node.summary || ''
  }
  return nodes
}

export const defaultGraphForSubject = (subjectName: string): StudyGraphNodeInput[] => {
  const name = String(subjectName || '')
  if (/英语|CET|四级|六级|考研英语/i.test(name)) {
    const cet6 = /六级|CET-?6/i.test(name)
    return treeToNodes([
      {
        name: '听力',
        summary: cet6 ? '长对话、短文、讲座的定位与记录' : '短对话、长对话、短文、讲座',
        children: [
          {
            name: '短对话技能',
            children: [
              { name: '场景与身份', summary: '校园、交通、购物等场景词' },
              { name: '数字与时间', summary: '价格、时刻、计算题' },
              { name: '建议与请求', summary: '建议句式与动作判断' },
              { name: '转折与否定', summary: 'but、instead 后才是答案' },
            ],
          },
          {
            name: '长对话与篇章',
            children: [
              { name: '主旨把握', summary: '开篇目的与话题' },
              { name: '细节定位', summary: '题文同序、关键词回听' },
              { name: '态度与语气', summary: '赞成、抱怨、建议' },
              { name: '讲座结构', summary: '定义、例子、结论' },
            ],
          },
        ],
      },
      {
        name: '阅读',
        summary: '选词填空、长篇阅读、仔细阅读',
        children: [
          {
            name: '仔细阅读',
            children: [
              { name: '主旨大意', summary: '首尾段与反复出现的概念' },
              { name: '事实细节', summary: '题干定位、排除绝对项' },
              { name: '推理判断', summary: '作者隐含观点' },
              { name: '词义猜测', summary: '上下文与词根词缀' },
            ],
          },
          {
            name: '长篇与选词',
            children: [
              { name: '段落匹配', summary: '同义改写定位' },
              { name: '词性判断', summary: '名动形副与成分' },
              { name: '搭配与衔接', summary: '固定搭配和指代' },
            ],
          },
        ],
      },
      {
        name: '词汇语法',
        children: [
          { name: '词缀词根', summary: '常见前后缀与派生' },
          { name: '近义辨析', summary: '易混词与语域' },
          { name: '短语动词', summary: '动词+介词/副词' },
          { name: '定语从句', summary: '关系词与限定非限定' },
          { name: '状语从句', summary: '时间、条件、让步' },
          { name: '非谓语动词', summary: '不定式、分词、动名词' },
          { name: '虚拟语气', summary: 'if、wish、建议句' },
          { name: '时态语态', summary: '完成进行与被动' },
        ],
      },
      {
        name: '翻译',
        children: [
          { name: '文化负载词', summary: '节日、政策、专名译法' },
          { name: '无主句处理', summary: '补出主语或改被动' },
          { name: '定语后置', summary: '长定语拆句' },
          { name: '被动与使役', summary: '被字句、使字句' },
        ],
      },
      {
        name: '写作',
        children: [
          { name: '现象解释', summary: '描述现象并分析原因' },
          { name: '观点论证', summary: '立场、理由、让步' },
          { name: cet6 ? '图表描述' : '书信通知', summary: cet6 ? '趋势、对比、结论' : '称谓、目的、套话' },
          { name: '逻辑衔接词', summary: '起承转合与例证' },
        ],
      },
    ])
  }
  return treeToNodes([
    {
      name: '基本概念',
      children: [
        { name: '术语与符号' },
        { name: '定义与性质' },
        { name: '常见分类' },
      ],
    },
    {
      name: '核心方法',
      children: [
        { name: '标准解法' },
        { name: '变形与推广' },
        { name: '适用条件' },
      ],
    },
    {
      name: '典型问题',
      children: [
        { name: '基础题型' },
        { name: '综合题型' },
        { name: '易错陷阱' },
      ],
    },
  ])
}

const mermaidSafeId = (value: string, index = 0) => {
  const slug = String(value || '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28)
  const base = slug || `n${index + 1}`
  return /^[A-Za-z]/.test(base) ? base : `n_${base}`
}

const mermaidLabel = (value: string) => String(value || '').replace(/["\[\]]/g, '').trim() || '未命名'

const stripMermaidFence = (raw: string) =>
  String(raw || '')
    .replace(/```mermaid\s*/i, '')
    .replace(/```[\s\S]*$/, '')
    .trim()

export const extractMermaidSource = (text: string) => {
  const source = String(text || '')
  const closed = source.match(/```mermaid\s*([\s\S]*?)```/i)
  if (closed?.[1]?.trim()) return closed[1].trim()
  const open = source.match(/```mermaid\s*([\s\S]*)$/i)
  return open?.[1]?.trim() || ''
}

const isMermaidKeyword = (id: string) =>
  /^(flowchart|graph|classDef|class|style|linkStyle|subgraph|end|click|TB|BT|LR|RL|TD)$/i.test(id)

const isBadGraphLabel = (name: string) =>
  !name || name === '未命名' || /^[:：,，\-\\/.]+$/.test(name)

const isJunkGraphNode = (node: { key?: string; name?: string }) => {
  const key = String(node.key || '').trim()
  const name = String(node.name || '').trim()
  if (/^(edges|from_key|to_key|mermaid|diagram|nodes|key|name|summary|mastery|parent_key|subject_id|subjectId|outline)$/i.test(key)) return true
  if (key.length <= 2 || /^[a-z][a-z]+$/.test(key) && /^(istening|eading|riting|ranslation|hortConv|ongConv|assage|ecture|loze|ongRead|arefulRead|ssayType|etterEmail|hartGraph|entenceTrans|ultureTopic|ET4)$/i.test(key)) {
    return isBadGraphLabel(name)
  }
  return isBadGraphLabel(name) && !/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(key)
}

export const parseMermaidGraph = (raw: unknown): StudyGraphNodeInput[] => {
  const text = stripMermaidFence(String(raw || ''))
  if (!text || (/^\s*[{[]/.test(text) && !/^(flowchart|mindmap|graph)\b/im.test(text))) return []
  if (/^mindmap\b/i.test(text)) {
    const body = text.replace(/^mindmap\b/i, '').replace(/root\(\((.+?)\)\)/g, '$1')
    return parseGraphOutline(body)
  }
  if (!/^(flowchart|graph)\b/im.test(text)) return []
  const nodes = new Map<string, StudyGraphNodeInput>()
  const ensure = (id: string, name?: string) => {
    if (isMermaidKeyword(id)) return null
    const key = mermaidSafeId(id)
    const current = nodes.get(key)
    const label = name ? mermaidLabel(name) : ''
    if (!current) {
      nodes.set(key, { key, name: label || id, mastery: 0 })
    } else if (label && (current.name === current.key || current.name === id)) {
      current.name = label
    }
    return nodes.get(key)!
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/;+\s*$/, '')
    if (!line || /^(flowchart|graph|classDef|class\s|style\s|linkStyle|click\s|subgraph|end)\b/i.test(line)) continue
    const edge = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:-->|---|-.->)\s*(?:\|[^|]+\|\s*)?([A-Za-z][A-Za-z0-9_]*)/)
    if (edge) {
      const from = ensure(edge[1])
      const to = ensure(edge[2])
      if (from && to && !to.parent_key && from.key !== to.key) to.parent_key = from.key
    }
    const def = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:\[\(\(|\[\[|\[\(|\[)\s*["']?([^\]"'）)]+?)["']?\s*(?:\)\)|\]\]|\)\]|\])\s*(?:::\w+)?/)
    if (def) ensure(def[1], def[2])
  }
  const list = [...nodes.values()].filter((item) => !isJunkGraphNode(item))
  return usableGraphNodes(list) ? list.slice(0, 60) : []
}

export const parseMermaidEdges = (raw: unknown): { from: string; to: string }[] => {
  const text = stripMermaidFence(String(raw || ''))
  if (!text || !/^(flowchart|graph)\b/im.test(text)) return []
  const edges: { from: string; to: string }[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/;+\s*$/, '')
    const edge = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:-->|---|-.->)\s*(?:\|[^|]+\|\s*)?([A-Za-z][A-Za-z0-9_]*)/)
    if (!edge || isMermaidKeyword(edge[1]) || isMermaidKeyword(edge[2])) continue
    const from = mermaidSafeId(edge[1])
    const to = mermaidSafeId(edge[2])
    const id = `${from}->${to}`
    if (from === to || seen.has(id)) continue
    seen.add(id)
    edges.push({ from, to })
  }
  return edges
}

export const graphFromInputs = (
  subjectName: string,
  nodes: StudyGraphNodeInput[],
  extraEdges: { from: string; to: string }[] = [],
): StudyGraphNode => {
  const items = nodes.filter((item) => !isJunkGraphNode(item)).slice(0, 60)
  const byKey = new Map<string, StudyGraphNode>()
  const nameToKey = new Map<string, string>()
  items.forEach((input, index) => {
    const key = input.key || slugKey(input.name, index)
    const node: StudyGraphNode = {
      id: key,
      name: input.name,
      summary: input.summary,
      mastery: normalizeMetric(input.mastery),
      stats: statsFromMastery(input.mastery),
      children: [],
    }
    byKey.set(key, node)
    if (input.name) nameToKey.set(input.name, key)
  })
  const resolveKey = (value?: string) => {
    const key = String(value || '').trim()
    if (!key) return ''
    if (byKey.has(key)) return key
    return nameToKey.get(key) || mermaidSafeId(key)
  }
  const attached = new Set<string>()
  items.forEach((input, index) => {
    const key = input.key || slugKey(input.name, index)
    const parentKey = resolveKey(input.parent_key)
    const node = byKey.get(key)
    const parent = parentKey ? byKey.get(parentKey) : null
    if (!node || !parent || parent.id === node.id || attached.has(key)) return
    parent.children.push(node)
    attached.add(key)
  })
  const roots = items
    .map((input, index) => byKey.get(input.key || slugKey(input.name, index))!)
    .filter((node, index, list) => node && !attached.has(node.id) && list.findIndex((item) => item.id === node.id) === index)
  const extraLinks = extraEdges
    .map((edge) => ({ from: resolveKey(edge.from), to: resolveKey(edge.to) }))
    .filter((edge) => edge.from && edge.to && edge.from !== edge.to && byKey.has(edge.from) && byKey.has(edge.to))
  const treeLinks = new Set(
    items
      .map((input, index) => {
        const key = input.key || slugKey(input.name, index)
        const parent = resolveKey(input.parent_key)
        return parent && attached.has(key) ? `${parent}->${key}` : ''
      })
      .filter(Boolean),
  )
  const links = extraLinks.filter((edge) => !treeLinks.has(`${edge.from}->${edge.to}`))
  const stats = mergeStats([...byKey.values()].map((node) => node.stats))
  if (roots.length === 1) {
    return applyRolledStats({ ...roots[0], stats, extraLinks: links })
  }
  return applyRolledStats({
    id: 'subject',
    name: subjectName || '知识图谱',
    stats,
    children: roots,
    extraLinks: links,
  })
}

export const graphFromMermaid = (subjectName: string, raw: string): StudyGraphNode | null => {
  const nodes = parseMermaidGraph(raw)
  if (!nodes.length) return null
  return graphFromInputs(subjectName, nodes, parseMermaidEdges(raw))
}

export const mergeGraphDetails = (from: StudyGraphNode, onto?: StudyGraphNode | null): StudyGraphNode => {
  if (!onto) return from
  const byName = new Map<string, StudyGraphNode>()
  const walk = (node: StudyGraphNode) => {
    byName.set(node.name, node)
    node.children.forEach(walk)
  }
  walk(onto)
  const apply = (node: StudyGraphNode): StudyGraphNode => {
    const hit = byName.get(node.name)
    return {
      ...node,
      nodeId: hit?.nodeId ?? node.nodeId,
      summary: node.summary || hit?.summary,
      mastery: hit?.mastery ?? node.mastery,
      forgetting_stage: hit?.forgetting_stage ?? node.forgetting_stage,
      last_reviewed_at: hit?.last_reviewed_at ?? node.last_reviewed_at,
      stats: hit?.stats ?? node.stats,
      children: node.children.map(apply),
      extraLinks: node.extraLinks,
    }
  }
  return applyRolledStats(apply(from))
}

export const inputsToMermaid = (subjectName: string, nodes: StudyGraphNodeInput[]) => {
  const lines = [
    'flowchart TB',
    'classDef unset fill:#f8fafc,stroke:#94a3b8,color:#334155',
    'classDef weak fill:#fff7ed,stroke:#fb923c,color:#9a3412',
    'classDef fair fill:#fffbeb,stroke:#f59e0b,color:#92400e',
    'classDef ok fill:#f0fdf4,stroke:#16a34a,color:#166534',
  ]
  const rootId = 'subject'
  const idOf = new Map<string, string>([['', rootId]])
  nodes.forEach((node, index) => {
    const id = `n${index + 1}`
    if (node.key) idOf.set(node.key, id)
    if (node.name) idOf.set(node.name, id)
  })
  lines.push(`${rootId}["${mermaidLabel(subjectName || '知识图谱')}"]:::unset`)
  nodes.forEach((node, index) => {
    const id = `n${index + 1}`
    const cls = node.mastery === 3 ? 'ok' : node.mastery === 2 ? 'fair' : node.mastery === 1 ? 'weak' : 'unset'
    lines.push(`${id}["${mermaidLabel(node.name)}"]:::${cls}`)
    const parent = (node.parent_key && idOf.get(node.parent_key)) || rootId
    lines.push(`${parent} --> ${id}`)
  })
  return lines.join('\n')
}

export const graphToMermaid = (root: StudyGraphNode) => {
  const { nodes, links } = flattenGraph(root)
  const ids = new Map<string, string>()
  nodes.forEach((node, index) => ids.set(node.id, mermaidSafeId(node.nodeId ? `n${node.nodeId}` : node.id, index)))
  const lines = [
    'flowchart TB',
    'classDef unset fill:#f8fafc,stroke:#94a3b8,color:#334155',
    'classDef weak fill:#fff7ed,stroke:#fb923c,color:#9a3412',
    'classDef fair fill:#fffbeb,stroke:#f59e0b,color:#92400e',
    'classDef ok fill:#f0fdf4,stroke:#16a34a,color:#166534',
  ]
  for (const node of nodes) {
    const id = ids.get(node.id)!
    const cls = node.mastery === 3 ? 'ok' : node.mastery === 2 ? 'fair' : node.mastery === 1 ? 'weak' : 'unset'
    lines.push(`${id}["${mermaidLabel(node.name)}"]:::${cls}`)
  }
  for (const link of links) {
    const from = ids.get(link.from)
    const to = ids.get(link.to)
    if (from && to) lines.push(`${from} --> ${to}`)
  }
  return lines.join('\n')
}

export const collectGraphNodes = (args: unknown, rawArguments?: string): StudyGraphNodeInput[] => {
  const rec = asRecord(args) || {}
  const mermaidRaw = rec.mermaid ?? rec.diagram
  if (typeof mermaidRaw === 'string' && mermaidRaw.trim()) {
    const fromMermaid = parseMermaidGraph(mermaidRaw)
    if (usableGraphNodes(fromMermaid)) return fromMermaid.filter((item) => !isJunkGraphNode(item))
  }
  const fromNodes = parseGraphNodeInputs(rec.nodes).filter((item) => !isJunkGraphNode(item))
  if (usableGraphNodes(fromNodes)) return fromNodes
  const outline = rec.outline ?? rec.nodes_text ?? rec.graph_text ?? rec.markdown
  if (typeof outline === 'string' && /^(flowchart|mindmap|graph)\b/im.test(outline.trim())) {
    const parsed = parseMermaidGraph(outline).filter((item) => !isJunkGraphNode(item))
    if (usableGraphNodes(parsed)) return parsed
  }
  const fromOutline = parseGraphOutline(outline).filter((item) => !isJunkGraphNode(item))
  if (usableGraphNodes(fromOutline)) return fromOutline
  const raw = String(rawArguments || '')
  if (/```mermaid|^(flowchart|mindmap|graph)\b/im.test(raw)) {
    const extracted = extractMermaidSource(raw) || raw
    const parsed = parseMermaidGraph(extracted).filter((item) => !isJunkGraphNode(item))
    if (usableGraphNodes(parsed)) return parsed
  }
  return []
}

export const parseGraphEdgeInputs = (raw: unknown) => {
  const value = parseMaybeJson(raw)
  const obj = asRecord(value)
  const list = Array.isArray(value)
    ? value
    : Array.isArray(obj?.edges)
      ? obj.edges
      : []
  return list
    .map((item) => {
      const rec = asRecord(parseMaybeJson(item))
      if (!rec) return null
      const from = String(rec.from_key || rec.from || rec.source || '').trim()
      const to = String(rec.to_key || rec.to || rec.target || '').trim()
      if (!from || !to) return null
      return {
        from_key: from,
        to_key: to,
        relation: String(rec.relation || rec.type || '').trim(),
      }
    })
    .filter((item): item is { from_key: string; to_key: string; relation: string } => Boolean(item))
}

export type { StudyGraphNodeRow, StudySubject }
