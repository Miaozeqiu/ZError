<template>
  <div class="abs-panel" role="menu" aria-label="抽象层">
    <div v-if="!layer" class="abs-empty">
      {{ parsing ? '正在识别当前页…' : '当前页没有可解析的抽象层' }}
    </div>

    <article v-else-if="layer.id === 'chaoxing-homework'" class="abs-card">
      <header class="abs-head">
        <div>
          <div class="abs-title">{{ homeworkTitle }}</div>
          <div class="abs-sub">{{ homeworkSub }}</div>
        </div>
        <div v-if="homeworkCount" class="abs-progress">
          <span>{{ homeworkFilled }} / {{ homeworkCount }}</span>
          <i class="abs-bar"><i :style="{ width: `${homeworkPercent}%` }" /></i>
        </div>
      </header>
      <p v-if="pickDebug" class="abs-pick-debug">{{ pickDebug }}</p>
      <ol v-if="homeworkQuestions.length" class="abs-list">
        <li v-for="item in homeworkQuestions" :key="item.index" class="abs-q">
          <div class="abs-q-meta">
            <b>第 {{ item.index }} 题</b>
            <i>{{ typeLabel(item.typeName, item.type) }}</i>
            <em v-if="item.filled" class="is-done">已填</em>
            <em v-if="isImageOnly(item)" class="is-img">图片题</em>
          </div>
          <p v-if="stemParts(item).length" class="abs-q-stem">
            <template v-for="(part, idx) in stemParts(item)" :key="`${item.index}-${idx}`">
              <img
                v-if="part.src"
                class="abs-q-img"
                :src="part.src"
                alt=""
              >
              <span v-else-if="part.miss" class="abs-q-miss">图</span>
              <span v-else>{{ part.text }}</span>
            </template>
          </p>
          <p v-else-if="isImageOnly(item)" class="abs-q-stem is-muted">题目在图里</p>
          <div v-if="item.options?.length" class="abs-q-opts">
            <button
              v-for="opt in item.options"
              :key="opt.letter"
              type="button"
              class="abs-opt"
              :class="{ 'is-on': opt.selected }"
              @click="pickOption(item, opt)"
            >
              <b>{{ opt.letter }}</b>
              <span class="abs-opt-body">
                <span v-if="optionText(opt)" class="abs-opt-text">{{ optionText(opt) }}</span>
                <img
                  v-for="src in optionImages(opt)"
                  :key="src"
                  class="abs-q-img"
                  :src="src"
                  alt=""
                >
                <span v-if="!optionText(opt) && !optionImages(opt).length" class="abs-opt-empty">—</span>
              </span>
            </button>
          </div>
        </li>
      </ol>
      <ul v-else-if="homeworkWorks.length" class="abs-works">
        <li v-for="work in homeworkWorks" :key="work.title">
          <span>{{ work.title }}</span>
          <span>{{ work.status }}</span>
        </li>
      </ul>
      <div v-else class="abs-empty">{{ homeworkEmpty }}</div>
    </article>

    <article v-else-if="layer.id === 'chaoxing-study'" class="abs-card">
      <header class="abs-head">
        <div>
          <div class="abs-title">{{ layer.name }}</div>
          <div class="abs-sub">{{ studyStatus }}</div>
        </div>
      </header>
      <ul v-if="chapterUnfinished.length" class="abs-works">
        <li v-for="title in chapterUnfinished" :key="title">{{ title }}</li>
      </ul>
    </article>

    <article v-else class="abs-card">
      <header class="abs-head">
        <div>
          <div class="abs-title">{{ layer.name }}</div>
          <div class="abs-sub">{{ layer.summary }}</div>
        </div>
      </header>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  abstractionParsing,
  lastHomeworkCard,
  lastHomeworkPickDebug,
  primaryAbstraction,
} from '../services/browserAbstractions'
import { chapterStateFor } from '../services/chaoxingChapters'
import { pickHomeworkOption } from '../services/chaoxingHomework'
import { cachedHwImage, normalizeHwImageUrl, resolveHwImage } from '../services/homeworkImages'

const props = defineProps<{
  browserId?: string
  url?: string
}>()

const parsing = abstractionParsing
const pickDebug = lastHomeworkPickDebug
const chapter = computed(() => chapterStateFor(props.browserId))
const layer = computed(() => primaryAbstraction(props.url || ''))
const homework = computed(() => lastHomeworkCard.value)
const homeworkQuestions = computed(() => (homework.value?.questions || []).slice(0, 40))
const homeworkWorks = computed(() => {
  const card = homework.value
  return (card?.pending?.length ? card.pending : card?.works || []).slice(0, 16)
})
const homeworkCount = computed(() => homework.value?.questionCount || homeworkQuestions.value.length)
const homeworkFilled = computed(() => homework.value?.filledCount || 0)
const homeworkPercent = computed(() => (
  homeworkCount.value ? Math.round((homeworkFilled.value / homeworkCount.value) * 100) : 0
))
const homeworkTitle = computed(() => {
  const title = String(homework.value?.title || '').replace(/^作业作答$/, '').trim()
  return title || '作业'
})
const homeworkSub = computed(() => {
  if (homeworkCount.value) return `${homeworkCount.value} 道题`
  const pending = homework.value?.pendingCount || homework.value?.pending?.length || 0
  if (pending) return `待做 ${pending} 份`
  if (parsing.value) return '正在读取…'
  return '还没读到题目'
})
const homeworkEmpty = computed(() => {
  const hint = homework.value?.hint || ''
  if (/不要 eval|调用 browser_|inspect 读题卡/.test(hint)) return '正在读题目…'
  return hint || '还没读到题目'
})
const studyStatus = computed(() => {
  const extras = chapter.value
  const unfinished = extras?.unfinished || []
  const left = extras?.unfinishedCount || unfinished.length
  return [
    extras?.currentTitle ? `当前「${extras.currentTitle}」` : '',
    left ? `未完成 ${left}` : '',
    extras?.progress ? `${extras.progress.done}/${extras.progress.total}` : '',
  ].filter(Boolean).join(' · ') || (parsing.value ? '正在解析章节…' : '还没读到未完成章节')
})
const chapterUnfinished = computed(() => (chapter.value?.unfinished || []).slice(0, 12))

const typeLabel = (raw?: string, fallback?: string) => {
  const text = String(raw || fallback || '').trim()
  if (/多选|multi/i.test(text)) return '多选题'
  if (/判断|judge/i.test(text)) return '判断题'
  if (/填空|blank/i.test(text)) return '填空题'
  if (/简答|论述|计算|text/i.test(text)) return '简答题'
  if (/单选|single/i.test(text)) return '单选题'
  return text || '题目'
}

const imageTick = ref(0)
const displayImgSrc = (src: string) => {
  imageTick.value
  const url = normalizeHwImageUrl(src)
  if (!url) return ''
  if (url.startsWith('data:')) return url
  return cachedHwImage(url)
}

watch(homeworkQuestions, (list) => {
  const urls = list.flatMap((item) => [
    ...(item.images || []),
    ...(item.options || []).flatMap((opt) => [opt.image, ...(opt.images || [])]),
  ]).map((src) => normalizeHwImageUrl(String(src || ''))).filter((src) => src.startsWith('https://'))
  void Promise.all([...new Set(urls)].map(async (url) => {
    const data = await resolveHwImage(url)
    if (data) imageTick.value += 1
  }))
}, { immediate: true })

const isBlankStem = (stem: string) => !stem || /^[（(]\s*[）)]$/.test(stem)

const rawImages = (list?: Array<string | undefined>) => (
  (list || []).map((src) => normalizeHwImageUrl(String(src || ''))).filter(Boolean)
)

const isImageOnly = (item: { stem?: string; images?: string[]; needsVision?: boolean; imageCount?: number }) => {
  const stem = String(item.stem || '').replace(/\s+/g, ' ').trim()
  const images = rawImages(item.images)
  return Boolean(item.needsVision || Number(item.imageCount) > 0 || !stem)
    && isBlankStem(stem)
    && !images.length
}

const stemParts = (item: { stem?: string; images?: string[] }): Array<{ text?: string; src?: string; miss?: boolean }> => {
  const raw = rawImages(item.images)
  if (raw.length) {
    return raw.map((src) => {
      const shown = displayImgSrc(src)
      return shown ? { src: shown } : { miss: true }
    })
  }
  const text = String(item.stem || '').replace(/\s+/g, ' ').trim()
  return text && !isBlankStem(text) ? [{ text }] : []
}

const optionHasImages = (opt: { image?: string; images?: string[] }) => (
  rawImages([opt.image, ...(opt.images || [])]).length > 0
)

const optionText = (opt: { text?: string; image?: string; images?: string[] }) => {
  if (optionHasImages(opt)) return ''
  return String(opt.text || '').replace(/^[A-H][.、．)\s]*/, '').trim()
}

const optionImages = (opt: { image?: string; images?: string[] }) => {
  const list = rawImages([opt.image, ...(opt.images || [])]).map((src) => displayImgSrc(src)).filter(Boolean)
  return list.filter((src, index) => list.indexOf(src) === index)
}

const pickOption = (item: { index: number }, opt: { letter: string }) => {
  if (!props.browserId || !item.index || !opt.letter) return
  void pickHomeworkOption(props.browserId, item.index, opt.letter)
}
</script>

<style scoped>
.abs-panel {
  box-sizing: border-box;
  max-height: min(68vh, 640px);
  overflow: auto;
  padding: 10px 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
  background: var(--bg-secondary, #fff);
  box-shadow: 0 16px 40px color-mix(in srgb, #000 18%, transparent);
  scrollbar-width: thin;
}

.abs-empty {
  padding: 28px 8px;
  font-size: 13px;
  color: var(--text-secondary, #86868b);
  text-align: center;
}

.abs-card {
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
}

.abs-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 70%, transparent);
}

.abs-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-primary, #1d1d1f);
}

.abs-pick-debug {
  margin: 8px 2px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, #ff9f0a 12%, transparent);
  color: #9a5b00;
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}

.abs-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary, #86868b);
}

.abs-progress {
  min-width: 72px;
  text-align: right;
}

.abs-progress span {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary, #1d1d1f);
}

.abs-bar {
  display: block;
  margin-top: 6px;
  height: 3px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--text-primary, #000) 6%, transparent);
  overflow: hidden;
}

.abs-bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--color-primary, #667eea);
}

.abs-list,
.abs-works {
  margin: 0;
  padding: 0;
  list-style: none;
}

.abs-q {
  padding: 12px 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
}

.abs-q:last-child {
  border-bottom: none;
  padding-bottom: 2px;
}

.abs-q-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.abs-q-meta b {
  height: 20px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #1d1d1f;
  color: #fff;
  font-size: 11px;
  font-weight: 650;
}

.abs-q-meta i {
  font-style: normal;
  font-size: 11px;
  font-weight: 550;
  padding: 1px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
  color: #5b67d1;
}

.abs-q-meta em {
  font-style: normal;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--text-primary, #000) 5%, transparent);
  color: var(--text-secondary, #86868b);
}

.abs-q-meta em.is-done {
  background: rgba(52, 199, 89, 0.12);
  color: #248a3d;
}

.abs-q-meta em.is-img {
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
  color: #5b67d1;
}

.abs-q-stem {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #1d1d1f);
  word-break: break-word;
}

.abs-q-stem.is-muted {
  color: var(--text-secondary, #86868b);
}

.abs-q-img {
  display: inline-block;
  max-width: min(100%, 420px);
  max-height: 160px;
  width: auto;
  height: auto;
  vertical-align: middle;
  margin: 0 2px;
  border-radius: 4px;
  background: var(--bg-primary, #f5f5f7);
}

.abs-q-miss {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-primary, #f5f5f7);
  color: var(--text-secondary, #86868b);
  font-size: 11px;
}

.abs-q-opts {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.abs-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: var(--bg-primary, #f5f5f7);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  color: var(--text-primary, #3a3a3c);
  cursor: pointer;
}

.abs-opt-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
}

.abs-opt b {
  flex: 0 0 16px;
  color: var(--text-secondary, #86868b);
  font-weight: 600;
}

.abs-q-opts .abs-q-img {
  max-height: 72px;
}

.abs-opt-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.abs-opt-empty {
  color: var(--text-secondary, #86868b);
}

.abs-opt.is-on {
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
  color: #3d4ed0;
}

.abs-opt.is-on b {
  color: #5b67d1;
}

.abs-opt:hover {
  filter: brightness(0.97);
}

.abs-works {
  margin-top: 8px;
}

.abs-works li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
}

.abs-works li span:last-child {
  color: var(--text-secondary, #86868b);
  font-size: 12px;
}
</style>
