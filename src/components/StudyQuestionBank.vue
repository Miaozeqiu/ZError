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
        <div v-if="!selected" key="list" class="study-qbank-page">
          <input
            v-model="query"
            class="study-qbank-search"
            type="search"
            :placeholder="nodeId ? '搜索题库并关联到当前知识点' : '搜索题库'"
          />
          <div v-if="query && !nodeId" class="study-qbank-hint">先在图谱里点一个知识点，再关联题目</div>
          <div v-if="!rows.length" class="study-qbank-empty">{{ emptyText }}</div>
          <div v-else class="study-qbank-list">
            <div v-for="item in rows" :key="item.id" class="study-qbank-item">
              <div class="study-qbank-marks" :title="markTitle(item.id)" aria-hidden="true">
                <i
                  v-for="(mark, index) in marksOf(item.id)"
                  :key="`${item.id}-${index}`"
                  class="study-qbank-mark"
                  :class="`is-${mark}`"
                />
              </div>
              <button type="button" class="study-qbank-copy" :title="previewOf(item.question)" @click="openDetail(item)">{{ previewOf(item.question) }}</button>
              <button
                v-if="query.trim() && nodeId && !item.linked"
                type="button"
                class="study-qbank-link"
                @click="link(item.id)"
              >关联</button>
              <button
                v-else-if="directIds.has(item.id) && nodeId"
                type="button"
                class="study-qbank-unlink"
                title="取消关联"
                @click="unlink(item.id)"
              >×</button>
            </div>
          </div>
        </div>
        <div v-else key="detail" class="study-qbank-page">
          <div class="study-qbank-detail">
            <div class="study-qbank-card">
              <div class="study-qbank-card-top">
                <span
                  v-if="selected.question_type"
                  class="study-qbank-type"
                  :class="`is-${typeKind(selected.question_type)}`"
                >{{ selected.question_type }}</span>
                <span v-if="selected.folder_name" class="study-qbank-folder">{{ selected.folder_name }}</span>
              </div>
              <div class="study-qbank-stem">
                <template v-for="(part, i) in contentParts" :key="'q-' + i">
                  <span v-if="part.type === 'text'">{{ part.text }}</span>
                  <img
                    v-else-if="imgSrc(part.url as string)"
                    :src="imgSrc(part.url as string)"
                    :class="['study-qbank-image', invertClass(part.url as string)]"
                  />
                </template>
              </div>
              <div v-if="optionRows.length" class="study-qbank-options">
                <div
                  v-for="option in optionRows"
                  :key="option.id"
                  class="study-qbank-option"
                  :class="{ 'is-ok': option.correct }"
                >
                  <span
                    v-if="option.key"
                    class="study-qbank-opt-key"
                    :class="{ 'is-ok': option.correct }"
                  >{{ option.key }}</span>
                  <div class="study-qbank-opt-text">
                    <template v-for="(part, i) in option.parts" :key="`${option.id}-${i}`">
                      <span v-if="part.type === 'text'">{{ part.text }}</span>
                      <img
                        v-else-if="imgSrc(part.url as string)"
                        :src="imgSrc(part.url as string)"
                        :class="['study-qbank-image', invertClass(part.url as string)]"
                      />
                    </template>
                  </div>
                </div>
              </div>
              <div v-else-if="selected.options" class="study-qbank-stem">
                <template v-for="(part, i) in optionsParts" :key="'o-' + i">
                  <span v-if="part.type === 'text'">{{ part.text }}</span>
                  <img
                    v-else-if="imgSrc(part.url as string)"
                    :src="imgSrc(part.url as string)"
                    :class="['study-qbank-image', invertClass(part.url as string)]"
                  />
                </template>
              </div>
              <div v-if="selected.answer" class="study-qbank-answer">
                <span class="study-qbank-answer-label">答案</span>
                <div class="study-qbank-answer-text">
                  <template v-if="answerHasMedia">
                    <template v-for="(part, i) in answerParts" :key="'a-' + i">
                      <span v-if="part.type === 'text'">{{ part.text }}</span>
                      <img
                        v-else-if="imgSrc(part.url as string)"
                        :src="imgSrc(part.url as string)"
                        :class="['study-qbank-image', invertClass(part.url as string)]"
                      />
                    </template>
                  </template>
                  <span v-else>{{ answerText }}</span>
                </div>
              </div>
            </div>
            <div v-if="knowledgeLinks.length" class="study-qbank-chips">
              <button
                v-for="link in knowledgeLinks"
                :key="link.node_id"
                type="button"
                class="study-qbank-chip"
                :title="`${link.subject_name} · ${link.node_name}`"
                @click="openKnowledge(link)"
              >{{ link.node_name }}</button>
            </div>
            <div class="study-qbank-block">
              <div class="study-qbank-label">作答时间线</div>
              <div v-if="!practiceGroups.length" class="study-qbank-empty-inline">还没有作答记录</div>
              <div v-else class="study-qbank-timeline">
                <div v-for="group in practiceGroups" :key="group.key" class="study-qbank-day">
                  <div class="study-qbank-day-label">{{ group.label }}</div>
                  <div
                    v-for="item in group.items"
                    :key="item.id"
                    class="study-qbank-attempt"
                    :class="`is-${item.kind}`"
                  >
                    <span class="study-qbank-dot" aria-hidden="true" />
                    <span class="study-qbank-time">{{ item.time }}</span>
                    <div class="study-qbank-attempt-copy">
                      <span class="study-qbank-flag" :class="`is-${item.kind}`">{{ item.flag }}</span>
                      <span v-if="item.answer">{{ item.answer }}</span>
                      <div v-if="item.note" class="study-qbank-note">{{ item.note }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { databaseService, type AIResponse, type PracticeRecord, type QuestionKnowledgeLink } from '../services/database'
import { notifyQuestionKnowledgeUpdated } from '../services/questionKnowledge'
import {
  fetchQuestionImageBase64,
  shouldInvertTransparentDarkImage,
  splitQuestionImageParts,
  type QuestionImagePart,
} from '../utils/questionImage'
import { parseOptions, quizKind, resolveAnswerKeys } from '../utils/quizPractice'
import type { StudyGraphNode } from '../utils/studyGraph'

type PracticeMark = 'ok' | 'bad' | 'empty'

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

const marksOf = (id: number) => practiceMarks.value[id] || emptyMarks()

const markTitle = (id: number) => {
  const marks = marksOf(id).filter((item) => item !== 'empty')
  if (!marks.length) return '还没有作答记录'
  const ok = marks.filter((item) => item === 'ok').length
  return `最近 ${marks.length} 次：对 ${ok}，错 ${marks.length - ok}`
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

const previewOf = (text: string) => {
  const plain = splitQuestionImageParts(text)
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join(' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain) return plain
  if (splitQuestionImageParts(text).some((part) => part.type === 'image')) return '图片题'
  return '未命名题目'
}

const typeKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

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

const imgSrc = (url: string) => imageSrcMap.value[url]
const invertClass = (url: string) => (blackOnlyMap.value[url] ? 'invert-on-dark' : '')

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

.study-qbank-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

.study-qbank-search {
  flex-shrink: 0;
  margin: 0 10px 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.study-qbank-hint,
.study-qbank-empty {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 10px;
}

.study-qbank-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 1px 2px;
  border-radius: 8px;
}

.study-qbank-item:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.study-qbank-marks {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
  margin-top: 7px;
}

.study-qbank-mark {
  display: block;
  width: 3px;
  height: 12px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent);
}

.study-qbank-mark.is-ok {
  background: #3d9a6a;
}

.study-qbank-mark.is-bad {
  background: #d15a5a;
}

.study-qbank-copy {
  flex: 1;
  min-width: 0;
  padding: 6px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.study-qbank-copy:active {
  transform: scale(0.99);
}

.study-qbank-link,
.study-qbank-unlink {
  flex-shrink: 0;
  margin-top: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #2F6F78;
  font-size: 11px;
  cursor: pointer;
}

[data-theme="dark"] .study-qbank-link {
  color: #7ab8c0;
}

.study-qbank-unlink {
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-detail {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 12px 14px;
}

.study-qbank-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.study-qbank-card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.study-qbank-type {
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  background: var(--ql-type-tag-bg, #eef2f7);
  color: var(--ql-type-tag-text, #64748b);
}

.study-qbank-type.is-single {
  background: var(--ql-type-tag-single-bg, #edf4ff);
  color: var(--ql-type-tag-single-text, #2563eb);
}

.study-qbank-type.is-multiple {
  background: var(--ql-type-tag-multiple-bg, #f3e8ff);
  color: var(--ql-type-tag-multiple-text, #7c3aed);
}

.study-qbank-type.is-judgement {
  background: var(--ql-type-tag-judgement-bg, #fff7ed);
  color: var(--ql-type-tag-judgement-text, #c2410c);
}

.study-qbank-type.is-fill {
  background: var(--ql-type-tag-fill-bg, #ecfdf5);
  color: var(--ql-type-tag-fill-text, #047857);
}

.study-qbank-folder {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-stem {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #2d3748);
  white-space: pre-wrap;
  word-break: break-word;
}

.study-qbank-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.study-qbank-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.study-qbank-option.is-ok {
  background: color-mix(in srgb, #3d9a6a 12%, transparent);
}

.study-qbank-opt-key {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--ql-type-tag-single-text, #2563eb);
  background: var(--ql-type-tag-single-bg, #edf4ff);
}

.study-qbank-opt-key.is-ok {
  color: color-mix(in srgb, #3d9a6a 70%, var(--text-primary, #1d1d1f));
  background: color-mix(in srgb, #3d9a6a 18%, transparent);
}

.study-qbank-opt-text {
  min-width: 0;
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #2d3748);
  word-break: break-word;
}

.study-qbank-answer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.study-qbank-answer-label {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-success, #15803d);
  background: color-mix(in srgb, var(--color-success, #16a34a) 16%, transparent);
}

.study-qbank-answer-text {
  min-width: 0;
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.5;
  color: color-mix(in srgb, var(--color-success, #166534) 72%, var(--text-primary, #2d3748));
  word-break: break-word;
}

.study-qbank-block + .study-qbank-block {
  margin-top: 12px;
}

.study-qbank-label {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-image {
  display: block;
  max-width: 100%;
  max-height: 160px;
  margin: 6px 0;
  border-radius: 6px;
  object-fit: contain;
}

:root[data-theme="dark"] .study-qbank-image.invert-on-dark {
  filter: invert(1);
}

.study-qbank-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.study-qbank-chip {
  padding: 2px 7px;
  border: none;
  border-radius: 6px;
  background: color-mix(in srgb, #2F6F78 10%, transparent);
  color: color-mix(in srgb, #2F6F78 72%, var(--text-primary, #1d1d1f));
  font-size: 11px;
  cursor: pointer;
}

.study-qbank-card + .study-qbank-block,
.study-qbank-chips + .study-qbank-block {
  margin-top: 14px;
}

.study-qbank-empty-inline {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.study-qbank-day-label {
  padding: 0 0 2px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-attempt {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0 4px 2px;
}

.study-qbank-attempt + .study-qbank-attempt::before {
  content: '';
  position: absolute;
  left: 4px;
  top: -4px;
  width: 1px;
  height: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.study-qbank-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: #94a3b8;
}

.study-qbank-attempt.is-ok .study-qbank-dot {
  background: #3d9a6a;
}

.study-qbank-attempt.is-bad .study-qbank-dot {
  background: #d15a5a;
}

.study-qbank-time {
  flex: 0 0 36px;
  margin-top: 1px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-attempt-copy {
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-primary, #2d3748);
}

.study-qbank-flag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.5;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  color: var(--text-secondary, #64748b);
}

.study-qbank-flag.is-ok {
  background: color-mix(in srgb, #3d9a6a 16%, transparent);
  color: color-mix(in srgb, #3d9a6a 70%, var(--text-primary, #1d1d1f));
}

.study-qbank-flag.is-bad {
  background: color-mix(in srgb, #d15a5a 16%, transparent);
  color: color-mix(in srgb, #d15a5a 70%, var(--text-primary, #1d1d1f));
}

.study-qbank-note {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary, #94a3b8);
  white-space: pre-wrap;
  word-break: break-word;
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
