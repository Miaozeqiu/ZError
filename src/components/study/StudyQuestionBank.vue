<template>
  <section class="study-qbank">
    <div class="study-qbank-head">
      <Transition name="qbank-fade">
        <button v-if="selected" type="button" class="study-qbank-back" @click="closeDetail">返回</button>
      </Transition>
      <span>{{ selected ? '题目详情' : scopeLabel }}</span>
      <span v-if="!selected && linked.length" class="study-qbank-count">{{ linked.length }}</span>
    </div>

    <div class="study-qbank-stage">
      <Transition :name="slideName">
        <StudyQuestionList
          v-if="!selected"
          key="list"
          v-model:query="query"
          :node-id="nodeId"
          :empty-text="emptyText"
          :rows="rows"
          :direct-ids="directIds"
          :practice-marks="practiceMarks"
          @open-detail="openDetail"
          @link="link"
          @unlink="unlink"
        />
        <StudyQuestionDetail
          v-else
          key="detail"
          :selected="selected"
          :content-parts="contentParts"
          :option-rows="optionRows"
          :options-parts="optionsParts"
          :answer-has-media="answerHasMedia"
          :answer-parts="answerParts"
          :answer-text="answerText"
          :knowledge-links="knowledgeLinks"
          :practice-groups="practiceGroups"
          :image-src-map="imageSrcMap"
          :black-only-map="blackOnlyMap"
          @open-knowledge="openKnowledge"
        />
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { databaseService, type AIResponse, type PracticeRecord, type QuestionKnowledgeLink } from '../../services/app/database'
import { notifyQuestionKnowledgeUpdated } from '../../services/study/questionKnowledge'
import {
  fetchQuestionImageBase64,
  shouldInvertTransparentDarkImage,
  splitQuestionImageParts,
  type QuestionImagePart,
} from '../../utils/question/questionImage'
import { parseOptions, quizKind, resolveAnswerKeys } from '../../utils/question/quizPractice'
import type { StudyGraphNode } from '../../utils/study/studyGraph'
import StudyQuestionDetail from './StudyQuestionDetail.vue'
import StudyQuestionList, { type PracticeMark } from './StudyQuestionList.vue'

const props = defineProps<{
  subjectId?: number | null
  node?: StudyGraphNode | null
  openQuestionId?: number | null
}>()

const emit = defineEmits<{
  'select-knowledge': [link: QuestionKnowledgeLink]
}>()

const query = ref('')
const linked = ref<AIResponse[]>([])
const hits = ref<AIResponse[]>([])
const selected = ref<AIResponse | null>(null)
const slideName = ref('qbank-forward')
const knowledgeLinks = ref<QuestionKnowledgeLink[]>([])
const imageSrcMap = ref<Record<string, string>>({})
const blackOnlyMap = ref<Record<string, boolean>>({})
const directIds = ref<Set<number>>(new Set())
const practiceMarks = ref<Record<number, PracticeMark[]>>({})
const practiceHistory = ref<PracticeRecord[]>([])
const linkedIds = computed(() => new Set(linked.value.map((item) => item.id)))

const emptyMarks = (): PracticeMark[] => ['empty', 'empty', 'empty', 'empty', 'empty']

const padMarks = (results: boolean[]): PracticeMark[] => {
  const recent = results.slice(-5)
  const marks = emptyMarks()
  recent.forEach((ok, index) => {
    marks[5 - recent.length + index] = ok ? 'ok' : 'bad'
  })
  return marks
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const parseStamp = (value?: string) => {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : Date.parse(`${normalized}Z`) || 0
}

const dayKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const dayLabel = (stamp: number) => {
  if (!stamp) return '未知时间'
  const date = new Date(stamp)
  const today = new Date()
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((start(today) - start(date)) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const clock = (stamp: number) => {
  if (!stamp) return '--:--'
  const date = new Date(stamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

const practiceGroups = computed(() => {
  const groups: Array<{
    key: string
    label: string
    items: Array<{
      id: number
      kind: 'ok' | 'bad' | 'note'
      flag: string
      answer: string
      note: string
      time: string
    }>
  }> = []
  const index = new Map<string, typeof groups[number]>()
  for (const record of practiceHistory.value) {
    const stamp = parseStamp(record.create_time)
    const key = stamp ? dayKey(new Date(stamp)) : 'unknown'
    let group = index.get(key)
    if (!group) {
      group = { key, label: dayLabel(stamp), items: [] }
      index.set(key, group)
      groups.push(group)
    }
    const answer = String(record.user_answer || '').trim()
    const note = String(record.note || '').trim()
    const kind = answer ? (record.is_correct ? 'ok' : 'bad') : 'note'
    group.items.push({
      id: record.id,
      kind,
      flag: kind === 'ok' ? '答对' : kind === 'bad' ? '答错' : '备注',
      answer,
      note,
      time: clock(stamp),
    })
  }
  return groups
})

const loadPractice = async (id?: number) => {
  if (!id) {
    practiceHistory.value = []
    return
  }
  try {
    practiceHistory.value = await databaseService.getPracticeHistory(id, 50)
  } catch {
    practiceHistory.value = []
  }
}

const loadMarks = async (ids: number[]) => {
  const unique = [...new Set(ids.filter((id) => id > 0))]
  if (!unique.length) {
    practiceMarks.value = {}
    return
  }
  try {
    const items = await databaseService.getRecentPracticeMarks(unique, 5)
    const next: Record<number, PracticeMark[]> = {}
    for (const id of unique) next[id] = emptyMarks()
    for (const item of items) next[item.question_id] = padMarks(item.results || [])
    practiceMarks.value = next
  } catch {
    practiceMarks.value = Object.fromEntries(unique.map((id) => [id, emptyMarks()]))
  }
}
const nodeId = computed(() => props.node?.nodeId || 0)

const scopeLabel = computed(() => {
  if (props.node?.name) return props.node.name
  return '本科目关联题'
})

const emptyText = computed(() => {
  if (query.value.trim()) return '没有找到题目'
  if (props.node?.nodeId) return props.node.children?.length
    ? '这个知识点及其子节点还没有关联题目'
    : '这个知识点还没有关联题目'
  return '还没有题目关联到这个科目'
})

const rows = computed(() => {
  const needle = query.value.trim()
  const source = needle ? hits.value : linked.value
  return source.map((item) => ({ ...item, linked: linkedIds.value.has(item.id) }))
})

const contentParts = computed(() => splitQuestionImageParts(selected.value?.question || ''))
const optionsParts = computed(() => splitQuestionImageParts(selected.value?.options || ''))
const answerParts = computed(() => splitQuestionImageParts(selected.value?.answer || ''))

const optionRows = computed(() => {
  const question = selected.value
  if (!question) return []
  const keys = new Set(resolveAnswerKeys(question.answer, question.options, question.question_type))
  const parsed = parseOptions(question.options)
  if (parsed.length) {
    return parsed.map((option, index) => ({
      id: `${option.key || 'opt'}-${index}`,
      key: option.key,
      parts: splitQuestionImageParts(option.text),
      correct: Boolean(option.key && keys.has(option.key)),
    }))
  }
  if (quizKind(question.question_type, question.options) !== 'judgement') return []
  return [
    { id: 'yes', key: '对', parts: [{ type: 'text' as const, text: '正确' }], correct: keys.has('对') },
    { id: 'no', key: '错', parts: [{ type: 'text' as const, text: '错误' }], correct: keys.has('错') },
  ]
})

const answerKeys = computed(() => {
  const question = selected.value
  if (!question) return []
  return resolveAnswerKeys(question.answer, question.options, question.question_type)
})

const answerHasMedia = computed(() => answerParts.value.some((part) => part.type === 'image'))

const answerText = computed(() => {
  if (answerKeys.value.length) return answerKeys.value.join('、')
  return String(selected.value?.answer || '').replace(/###/g, '、').trim()
})

const loadImages = async (parts: QuestionImagePart[]) => {
  const urls = parts.filter((part) => part.type === 'image').map((part) => part.url as string)
  for (const url of urls) {
    if (imageSrcMap.value[url]) continue
    try {
      const src = await fetchQuestionImageBase64(url)
      imageSrcMap.value = { ...imageSrcMap.value, [url]: src }
      const invert = await shouldInvertTransparentDarkImage(src)
      if (invert) blackOnlyMap.value = { ...blackOnlyMap.value, [url]: true }
    } catch {
      /* ignore */
    }
  }
}

const loadLinked = async () => {
  const subjectId = Number(props.subjectId)
  const id = nodeId.value
  try {
    const ids = id
      ? await databaseService.listNodeQuestions(id)
      : subjectId
        ? await databaseService.listSubjectQuestions(subjectId)
        : []
    const page = ids.slice(0, 80)
    linked.value = page.length ? await databaseService.getQuestionsByIds(page) : []
    if (id && page.length) {
      const links = await databaseService.listQuestionKnowledge(page)
      directIds.value = new Set(links.filter((item) => item.node_id === id).map((item) => item.question_id))
    } else {
      directIds.value = new Set()
    }
    await loadMarks(page)
  } catch {
    linked.value = []
    directIds.value = new Set()
    practiceMarks.value = {}
  }
}

const search = async () => {
  const term = query.value.trim()
  if (!term) {
    hits.value = []
    return
  }
  try {
    hits.value = (await databaseService.searchQuestionsByTitle(term)).slice(0, 30)
    await loadMarks([...linked.value, ...hits.value].map((item) => item.id))
  } catch {
    hits.value = []
  }
}

const link = async (questionId: number) => {
  if (!nodeId.value) return
  await databaseService.linkQuestionsToNode([questionId], nodeId.value)
  notifyQuestionKnowledgeUpdated({ subjectId: Number(props.subjectId) || undefined, nodeId: nodeId.value, questionId })
  await loadLinked()
}

const unlink = async (questionId: number) => {
  if (!nodeId.value) return
  await databaseService.unlinkQuestionKnowledge(questionId, nodeId.value)
  notifyQuestionKnowledgeUpdated({ subjectId: Number(props.subjectId) || undefined, nodeId: nodeId.value, questionId })
  await loadLinked()
}

const openKnowledge = (link: QuestionKnowledgeLink) => {
  emit('select-knowledge', link)
}

const loadKnowledge = async (id?: number) => {
  if (!id) {
    knowledgeLinks.value = []
    return
  }
  try {
    knowledgeLinks.value = await databaseService.listQuestionKnowledge([id])
  } catch {
    knowledgeLinks.value = []
  }
}

const openDetail = (question: AIResponse) => {
  slideName.value = 'qbank-forward'
  selected.value = question
}

const openDetailById = async (id: number) => {
  const found = rows.value.find((item) => item.id === id)
    || linked.value.find((item) => item.id === id)
  if (found) {
    openDetail(found)
    return
  }
  try {
    const items = await databaseService.getQuestionsByIds([id])
    if (items[0]) openDetail(items[0])
  } catch {
    /* ignore */
  }
}

const closeDetail = () => {
  slideName.value = 'qbank-back'
  selected.value = null
  knowledgeLinks.value = []
  practiceHistory.value = []
}

let searchTimer = 0
watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void search()
  }, 220)
})

watch(
  () => [props.subjectId, props.node?.nodeId] as const,
  () => {
    void loadLinked()
  },
  { immediate: true },
)

watch(() => props.openQuestionId, (id) => {
  if (id) void openDetailById(id)
})

watch(() => selected.value?.id, (id) => {
  imageSrcMap.value = {}
  blackOnlyMap.value = {}
  void loadKnowledge(id)
  void loadPractice(id)
  void loadImages([...contentParts.value, ...optionsParts.value, ...answerParts.value])
})

const onActivityUpdated = () => {
  void loadMarks(rows.value.map((item) => item.id))
  if (selected.value?.id) void loadPractice(selected.value.id)
}

onMounted(() => {
  window.addEventListener('question-knowledge-updated', loadLinked)
  window.addEventListener('study-activity-updated', onActivityUpdated)
  if (props.openQuestionId) void openDetailById(props.openQuestionId)
})

onUnmounted(() => {
  window.removeEventListener('question-knowledge-updated', loadLinked)
  window.removeEventListener('study-activity-updated', onActivityUpdated)
})
</script>

<style scoped>
.study-qbank {
  flex: 1;
  width: 260px;
  min-width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.study-qbank-head {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.study-qbank-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.study-qbank-back {
  padding: 0;
  border: none;
  background: transparent;
  color: #2F6F78;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.study-qbank-count {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #2F6F78;
}

.qbank-forward-enter-active,
.qbank-forward-leave-active,
.qbank-back-enter-active,
.qbank-back-leave-active,
.qbank-fade-enter-active,
.qbank-fade-leave-active {
  transition:
    transform 320ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 200ms ease;
}

.qbank-forward-enter-active,
.qbank-back-enter-active {
  z-index: 1;
}

.qbank-forward-enter-from {
  transform: translateX(24px);
  opacity: 0;
}

.qbank-forward-leave-to {
  transform: translateX(-16px);
  opacity: 0;
}

.qbank-back-enter-from {
  transform: translateX(-16px);
  opacity: 0;
}

.qbank-back-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.qbank-fade-enter-from,
.qbank-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .qbank-forward-enter-active,
  .qbank-forward-leave-active,
  .qbank-back-enter-active,
  .qbank-back-leave-active,
  .qbank-fade-enter-active,
  .qbank-fade-leave-active {
    transition: none;
  }
}
</style>
