import { computed, ref, watch } from 'vue'
import { activeChat, hydrateQuizCards, isChatBusy } from '../../services/agent/chat'
import { databaseService } from '../../services/app/database'
import { finishStudyGraphStream, studyGraphStream } from '../../services/study/graphStream'
import { graphFromPayload, type StudyGraphNode } from '../../utils/study/studyGraph'
import { getQuizCards, parseMarkdownQuizzes, type QuizCard } from '../../utils/question/quizPractice'
import {
  isBrowseQuizStep,
  isQuizStep,
  quizCardsFor,
  quizKeyOf,
  quizStatFor,
  quizTitleFor,
  stepQuizCards,
} from './threadDisplay'

const mdQuizCache = ref<Record<string, QuizCard[]>>({})

export const fallbackQuizCards = (message: Parameters<typeof stepQuizCards>[0]) => {
  if (stepQuizCards(message).length) return []
  const parsed = parseMarkdownQuizzes(message.content)
  if (!parsed.length) return []
  return mdQuizCache.value[message.id] || parsed
}

export const hydrateMessageQuiz = async (message: Parameters<typeof stepQuizCards>[0]) => {
  if (message.role !== 'assistant' || message.status === 'streaming') return
  if (stepQuizCards(message).length || mdQuizCache.value[message.id]) return
  const parsed = parseMarkdownQuizzes(message.content)
  if (!parsed.length) return
  mdQuizCache.value[message.id] = await hydrateQuizCards(parsed)
}

export const openedWriteStepId = ref<string | null>(null)
export const openedQuizKey = ref<string | null>(null)
export const openedGraphSubjectId = ref<number | null>(null)
export const paneGraph = ref<StudyGraphNode | null>(null)
export const paneGraphName = ref('')
export const paneGraphCount = ref(0)
export const graphFocusName = ref('')
const lastGraphFocus = new Map<number, string>()

export const isQuizOpen = (messageId: string, stepId: string) =>
  openedQuizKey.value === quizKeyOf(messageId, stepId)

export const latestQuizKey = computed(() => {
  const messages = [...(activeChat.value?.messages || [])].reverse()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const step of [...(message.steps || [])].reverse()) {
      if (isQuizStep(step)) return quizKeyOf(message.id, step.id)
    }
    if (fallbackQuizCards(message).length) return quizKeyOf(message.id, `${message.id}-md`)
  }
  return null
})

export const openedQuiz = computed(() => {
  if (!openedQuizKey.value) return null
  const [messageId, stepId] = openedQuizKey.value.split('\t')
  const message = activeChat.value?.messages.find((item) => item.id === messageId)
  if (!message || !stepId) return null
  const step = message.steps.find((item) => item.id === stepId)
  const cards = stepId.endsWith('-md')
    ? fallbackQuizCards(message)
    : step
      ? quizCardsFor(step)
      : getQuizCards(stepId)
  if (!cards.length) return null
  return {
    messageId,
    stepId,
    cards,
    message,
    title: quizTitleFor(step, stepId),
    mode: isBrowseQuizStep(step) ? 'browse' as const : 'practice' as const,
  }
})

export const paneQuiz = computed(() => {
  const quiz = openedQuiz.value
  if (!quiz) return null
  return {
    messageId: quiz.messageId,
    stepId: quiz.stepId,
    cards: quiz.cards,
    title: quiz.title,
    mode: quiz.mode,
    stat: quizStatFor(quiz.message, quiz.stepId, quiz.cards, quiz.mode === 'browse'),
  }
})

export const openedGraph = computed(() => openedGraphSubjectId.value != null)

export const graphStreaming = computed(() => {
  const stream = studyGraphStream.value
  const id = openedGraphSubjectId.value
  return Boolean(
    stream?.streaming
    && isChatBusy.value
    && (stream.subjectId == null || id == null || stream.subjectId === id),
  )
})

export const graphEmptyText = computed(() =>
  graphStreaming.value ? 'Agent 正在绘制知识图谱' : '这个科目还没有图谱',
)

export const graphPaneStat = computed(() => {
  if (graphStreaming.value && !paneGraphCount.value) return '正在绘制'
  if (graphStreaming.value) return `${paneGraphCount.value} 个 · 绘制中`
  return paneGraphCount.value ? `${paneGraphCount.value} 个节点` : ''
})

export const paneGraphView = computed(() => {
  if (!openedGraph.value) return null
  return {
    name: paneGraphName.value || '知识图谱',
    stat: graphPaneStat.value,
    graph: paneGraph.value,
    streaming: graphStreaming.value,
    selectedName: graphFocusName.value,
    emptyText: graphEmptyText.value,
  }
})

export const loadPaneGraph = async (id: number) => {
  try {
    const payload = await databaseService.getStudyGraph(id)
    paneGraph.value = payload.nodes.length ? graphFromPayload(payload) : null
    paneGraphName.value = payload.subject?.name || paneGraph.value?.name || '知识图谱'
    paneGraphCount.value = payload.nodes.length
  } catch {
    paneGraph.value = null
    paneGraphCount.value = 0
  }
}

export const rememberGraphFocus = (subjectId: number, name: string) => {
  const focus = String(name || '').trim()
  if (focus) lastGraphFocus.set(subjectId, focus)
  else lastGraphFocus.delete(subjectId)
}

export const onGraphSelect = (name: string) => {
  graphFocusName.value = name
  const id = openedGraphSubjectId.value
  if (id != null) rememberGraphFocus(id, name)
}

export const openGraphPane = (subjectId: number, nodeName?: string) => {
  openedQuizKey.value = null
  openedWriteStepId.value = null
  openedGraphSubjectId.value = subjectId
  const focus = String(nodeName || lastGraphFocus.get(subjectId) || '').trim()
  graphFocusName.value = focus
  void loadPaneGraph(subjectId)
}

export const closeGraphPane = () => {
  openedGraphSubjectId.value = null
}

export const onStudyGraphUpdated = (event: Event) => {
  const id = Number((event as CustomEvent<{ subjectId?: number }>).detail?.subjectId)
  const current = openedGraphSubjectId.value
  if (current == null) return
  void loadPaneGraph(Number.isFinite(id) && id > 0 ? id : current)
}

export const onOpenStudyGraph = (event: Event) => {
  const detail = (event as CustomEvent<{ subjectId?: number; expand?: boolean; nodeName?: string }>).detail
  const id = Number(detail?.subjectId)
  if (!Number.isFinite(id) || id <= 0) return
  openGraphPane(id, detail?.nodeName)
}

export const toggleQuiz = (messageId: string, stepId: string) => {
  const key = quizKeyOf(messageId, stepId)
  if (openedQuizKey.value === key) {
    openedQuizKey.value = null
    return
  }
  openedWriteStepId.value = null
  openedGraphSubjectId.value = null
  openedQuizKey.value = key
}

export const openWrite = (stepId: string) => {
  openedQuizKey.value = null
  openedGraphSubjectId.value = null
  openedWriteStepId.value = openedWriteStepId.value === stepId ? null : stepId
}

export const openedWriteStep = computed(() => {
  for (const message of activeChat.value?.messages || []) {
    const step = message.steps.find((item) => item.id === openedWriteStepId.value)
    if (step) return step
  }
  return null
})

export const bindAgentChatPanes = () => {
  watch(
    () => activeChat.value?.messages.map((message) => `${message.id}:${message.status}:${message.content.length}`).join('|'),
    () => {
      for (const message of activeChat.value?.messages || []) {
        void hydrateMessageQuiz(message)
      }
    },
    { immediate: true },
  )

  watch(latestQuizKey, (key) => {
    if (!key) {
      openedQuizKey.value = null
      return
    }
    openedWriteStepId.value = null
    openedGraphSubjectId.value = null
    openedQuizKey.value = key
  }, { immediate: true })

  watch(
    () => {
      const stream = studyGraphStream.value
      return stream ? `${stream.streaming ? 1 : 0}:${stream.subjectId ?? ''}` : ''
    },
    (curr, prev) => {
      const stream = studyGraphStream.value
      if (!stream?.subjectId) return
      const started = curr.startsWith('1:') && !String(prev || '').startsWith('1:')
      if (started) {
        openGraphPane(stream.subjectId)
        return
      }
      if (openedGraphSubjectId.value === stream.subjectId) void loadPaneGraph(stream.subjectId)
    },
  )
}

export const finishOpenGraphStream = () => {
  const id = openedGraphSubjectId.value ?? activeChat.value?.studySubjectId
  finishStudyGraphStream(id == null ? undefined : id)
}
