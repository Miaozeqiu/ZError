/** 浏览器预览用的题库 / 图谱假数据。 */
import { applyForgettingToNode, rolledRetentionForest } from '../../../utils/study/studyForgetting'
import type {
  AIResponse,
  Folder,
  StudyActivity,
  StudyGraphEdgeRow,
  StudyGraphNodeRow,
  StudyGraphPayload,
  StudySubject,
  StudyTimelineSummary,
} from './types'

export const replaceList = <T>(list: T[], next: T[]) => {
  list.length = 0
  list.push(...next)
}

export let mockStudySubjects: StudySubject[] = []
export const mockStudyGraphs = new Map<number, { nodes: StudyGraphNodeRow[]; edges: StudyGraphEdgeRow[] }>()
export let mockQuestionKnowledge: { question_id: number; node_id: number }[] = []
export let mockStudyActivity: StudyActivity[] = []
export let mockStudyTimelineSummaries: StudyTimelineSummary[] = []
let mockActivityId = 1

export const descendantNodeIds = (nodeId: number) => {
  const ids = new Set<number>([nodeId])
  for (const graph of mockStudyGraphs.values()) {
    if (!graph.nodes.some((node) => node.id === nodeId)) continue
    const kids = new Map<number, number[]>()
    for (const node of graph.nodes) {
      const parentId = node.parent_id
      if (parentId == null || parentId === node.id) continue
      const list = kids.get(parentId)
      if (list) list.push(node.id)
      else kids.set(parentId, [node.id])
    }
    const walk = (id: number) => {
      for (const child of kids.get(id) || []) {
        if (ids.has(child)) continue
        ids.add(child)
        walk(child)
      }
    }
    walk(nodeId)
    break
  }
  return ids
}

export const emitStudyActivityUpdated = (subjectId?: number) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('study-activity-updated', { detail: { subjectId } }))
}

export const pushMockActivity = (input: Omit<StudyActivity, 'id'>) => {
  if (input.kind !== 'practice' && !input.names.length) return
  mockStudyActivity.unshift({
    ...input,
    id: mockActivityId++,
  })
}

export const refreshMockSubjectProgress = (subjectId: number) => {
  const subject = mockStudySubjects.find((item) => item.id === subjectId)
  const graph = mockStudyGraphs.get(subjectId)
  if (!subject) return
  const nodes = graph?.nodes || []
  subject.node_count = nodes.length
  subject.progress = rolledRetentionForest(nodes)
}

export const withForgettingGraph = (payload: StudyGraphPayload): StudyGraphPayload => {
  const nodes = payload.nodes.map((item) => applyForgettingToNode(item))
  const progress = rolledRetentionForest(nodes)
  return {
    ...payload,
    nodes,
    subject: { ...payload.subject, node_count: nodes.length, progress },
  }
}
export let mockFolders: Folder[] = [
  { id: 0, name: '默认文件夹', parent_id: null, created_at: '2024-01-01' },
  { id: 1, name: 'JavaScript', parent_id: 0, created_at: '2024-01-01' },
  { id: 2, name: 'Python', parent_id: 0, created_at: '2024-01-02' },
  { id: 3, name: 'Vue.js', parent_id: 0, created_at: '2024-01-03' },
  { id: 4, name: 'React', parent_id: 0, created_at: '2024-01-04' },
];

export let mockAIResponses: AIResponse[] = [
  {
    id: 1,
    question: '如何在JavaScript中实现深拷贝？',
    answer: '可以使用JSON.parse(JSON.stringify(obj))进行简单深拷贝，或使用lodash的cloneDeep方法，或手写递归函数处理复杂对象。',
    question_type: '编程问题',
    folder_id: 1,
    folder_name: 'JavaScript',
    create_time: '2024-01-01 10:00:00',
    is_ai: true
  },
  {
    id: 2,
    question: 'Python中的装饰器是什么？',
    answer: '装饰器是Python中的一种设计模式，允许在不修改原函数代码的情况下，为函数添加额外的功能。使用@符号语法糖来应用装饰器。',
    question_type: '概念解释',
    folder_id: 2,
    folder_name: 'Python',
    create_time: '2024-01-02 11:00:00',
    is_ai: true
  },
  {
    id: 3,
    question: 'Vue.js的响应式原理是什么？',
    answer: 'Vue.js使用Object.defineProperty()（Vue2）或Proxy（Vue3）来劫持对象属性的getter和setter，当数据变化时自动触发视图更新。',
    question_type: '原理解释',
    folder_id: 3,
    folder_name: 'Vue.js',
    create_time: '2024-01-03 12:00:00',
    is_ai: true
  },
  {
    id: 4,
    question: 'React Hooks的使用场景？',
    answer: 'React Hooks主要用于函数组件中管理状态和副作用，如useState管理状态，useEffect处理副作用，useContext共享数据等。',
    question_type: '使用指南',
    folder_id: 4,
    folder_name: 'React',
    create_time: '2024-01-04 13:00:00',
    is_ai: true
  },
  {
    id: 5,
    question: 'JavaScript闭包的应用？',
    answer: '闭包常用于数据封装、模块化编程、回调函数、防抖节流等场景。它能让内部函数访问外部函数的变量，即使外部函数已经执行完毕。',
    question_type: '编程问题',
    folder_id: 1,
    folder_name: 'JavaScript',
    create_time: '2024-01-05 14:00:00',
    is_ai: true
  }
];
