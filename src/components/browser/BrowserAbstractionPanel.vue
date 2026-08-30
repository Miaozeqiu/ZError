<template>
  <div class="abs-panel" role="region" :aria-label="panelLabel">
    <div v-if="!layer" class="abs-empty">
      {{ parsing ? '正在识别当前页…' : emptyHint }}
    </div>

    <article v-else-if="layer.id === 'chaoxing-homework'" class="abs-card">
      <header class="abs-head">
        <div class="abs-head-left">
          <div class="abs-title">{{ homeworkTitle }}</div>
          <div
            v-if="homeworkCount"
            class="abs-ring"
            :title="`${homeworkFilled} / ${homeworkCount}`"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle class="abs-ring-track" cx="8" cy="8" r="6" />
              <circle
                class="abs-ring-arc"
                cx="8"
                cy="8"
                r="6"
                :stroke-dasharray="homeworkRingDash"
              />
            </svg>
          </div>
          <div v-else class="abs-sub">{{ homeworkSub }}</div>
        </div>
        <QuestionIndexSwitcher
          v-if="homeworkCount"
          class="abs-switcher"
          :index="currentQuestion"
          :total="homeworkQuestions.length || homeworkCount"
          blur-prefix="hw"
          @goto="gotoQuestion"
        />
      </header>
      <ol v-if="homeworkQuestions.length" ref="homeworkList" class="abs-list abs-body">
        <li
          v-for="(item, idx) in homeworkQuestions"
          :key="item.index"
          class="abs-q"
          :class="{ 'is-current': idx === currentQuestion }"
        >
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
      <ul v-else-if="homeworkWorks.length" class="abs-works abs-body">
        <li v-for="work in homeworkWorks" :key="work.title">
          <span>{{ work.title }}</span>
          <span>{{ work.status }}</span>
        </li>
      </ul>
      <div v-else class="abs-empty abs-body">{{ homeworkEmpty }}</div>
    </article>

    <article v-else-if="layer.id === 'chaoxing-study'" class="abs-card">
      <header class="abs-head">
        <div class="abs-head-left">
          <div class="abs-title">章节</div>
          <div
            v-if="chapterProgress"
            class="abs-ring"
            :title="`已完成任务点 ${chapterProgress.done} / ${chapterProgress.total}`"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle class="abs-ring-track" cx="8" cy="8" r="6" />
              <circle
                class="abs-ring-arc"
                cx="8"
                cy="8"
                r="6"
                :stroke-dasharray="chapterRingDash"
              />
            </svg>
          </div>
          <div v-if="chapterProgress" class="abs-count">
            {{ chapterProgress.done }} / {{ chapterProgress.total }}
          </div>
          <div v-else class="abs-sub">{{ studyStatus }}</div>
        </div>
      </header>
      <div
        v-if="orphanWatch"
        class="abs-ch-watch abs-head-watch"
        :class="`is-${orphanWatch.status}`"
      >
        <div class="abs-ch-watch-bar" aria-hidden="true">
          <span :style="{ width: `${orphanWatch.percent}%` }" />
        </div>
        <div class="abs-ch-watch-meta">
          <span>{{ orphanWatch.clock }}</span>
          <span>{{ orphanWatch.label }}</span>
          <span>{{ orphanWatch.percent }}%</span>
        </div>
      </div>
      <ol v-if="chapterTree.length" class="abs-list abs-tree abs-body">
        <li
          v-for="item in chapterTree"
          :key="item.key"
          class="abs-ch"
          :class="{
            'is-chapter': item.kind === 'chapter',
            'is-current': item.active,
            'is-open': item.unfinished,
            'is-go': item.kind !== 'chapter',
            'is-busy': openingKey === item.key,
            'is-watching': Boolean(item.watch),
          }"
          :style="{ '--depth': item.depth, '--watch-indent': item.index ? 'calc(5ch + 8px)' : '0px' }"
          :title="item.title"
          :tabindex="item.kind === 'chapter' ? undefined : 0"
          @click="openChapter(item)"
          @keydown.enter.prevent="openChapter(item)"
        >
          <div class="abs-ch-row">
            <span class="abs-ch-title">
              <i v-if="item.index">{{ item.index }}</i>
              <span>{{ item.name || item.title }}</span>
            </span>
            <em v-if="item.active">当前</em>
            <b v-else-if="item.jobs" class="abs-ch-jobs">{{ item.jobs }}</b>
          </div>
          <ul v-if="item.jobList?.length" class="abs-ch-joblist">
            <li
              v-for="(job, jobIdx) in item.jobList"
              :key="`${item.key}-job-${job.mid || job.jobid || job.label}-${jobIdx}`"
              class="abs-ch-job"
              :class="{
                'is-active': job.active,
                'is-done': job.jobDone,
                [`is-${job.kind}`]: true,
              }"
            >
              <div class="abs-ch-job-row">
                <span class="abs-ch-job-label">{{ job.label }}</span>
                <span v-if="job.jobDone && !job.active" class="abs-ch-job-state">完成</span>
                <span v-else-if="job.active && job.clock" class="abs-ch-job-state">{{ job.clock }}</span>
                <span v-else-if="job.kind === 'quiz'" class="abs-ch-job-state">测验</span>
                <span v-else-if="job.kind === 'doc'" class="abs-ch-job-state">文档</span>
              </div>
              <div
                v-if="job.active && job.duration"
                class="abs-ch-watch"
                :class="job.paused ? 'is-paused' : job.jobDone ? 'is-done' : 'is-watching'"
              >
                <div class="abs-ch-watch-bar" aria-hidden="true">
                  <span :style="{ width: `${job.percent || 0}%` }" />
                </div>
                <div class="abs-ch-watch-meta">
                  <span>{{ job.clock }}</span>
                  <span>{{ job.paused ? '暂停' : '播放中' }}</span>
                  <span>{{ job.percent || 0 }}%</span>
                </div>
              </div>
            </li>
          </ul>
          <div
            v-else-if="item.watch"
            class="abs-ch-watch"
            :class="`is-${item.watch.status}`"
          >
            <div class="abs-ch-watch-bar" aria-hidden="true">
              <span :style="{ width: `${item.watchPercent}%` }" />
            </div>
            <div class="abs-ch-watch-meta">
              <span>{{ item.watchClock }}</span>
              <span>{{ item.watchLabel }}</span>
              <span>{{ item.watchPercent }}%</span>
            </div>
          </div>
        </li>
      </ol>
      <div v-else class="abs-empty abs-body">{{ studyEmpty }}</div>
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
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import {
  abstractionParsing,
  lastHomeworkCard,
  primaryAbstraction,
} from '../../services/browser/abstractions'
import QuestionIndexSwitcher from '../ui/QuestionIndexSwitcher.vue'
import { chapterStateFor, openChapterFromCard } from '../../services/chaoxing/browser/chapters'
import type { ChapterJobItem } from '../../services/chaoxing/browser/chapters'
import {
  formatVideoClock,
  videoWatchFor,
} from '../../services/chaoxing/browser/watch'
import { pickHomeworkOption } from '../../services/chaoxing/homework'
import { cachedHwImage, normalizeHwImageUrl, resolveHwImage } from '../../services/chaoxing/homework/homeworkImages'

const props = defineProps<{
  browserId?: string
  url?: string
}>()

const parsing = abstractionParsing
const chapter = computed(() => chapterStateFor(props.browserId))
const videoWatch = computed(() => videoWatchFor(props.browserId))
const layer = computed(() => primaryAbstraction(props.url || ''))
const panelLabel = computed(() => {
  if (layer.value?.id === 'chaoxing-study') return '章节'
  if (layer.value?.id === 'chaoxing-homework') return '题卡'
  return layer.value?.name?.replace(/^学习通/, '') || '解析'
})
const emptyHint = computed(() => {
  if (/passport2|login/i.test(props.url || '')) return '当前是登录页，没有章节或题卡'
  return '当前页没有可解析的章节或题卡'
})
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
const HOMEWORK_RING = 2 * Math.PI * 6
const homeworkRingDash = computed(() => {
  const value = (homeworkPercent.value / 100) * HOMEWORK_RING
  return `${value} ${HOMEWORK_RING}`
})
const homeworkTitle = computed(() => {
  const title = String(homework.value?.title || '').replace(/^作业作答$/, '').trim()
  return title || '作业'
})
const homeworkSub = computed(() => {
  const pending = homework.value?.pendingCount || homework.value?.pending?.length || 0
  if (pending) return `待做 ${pending} 份`
  if (parsing.value) return '正在读取…'
  return '还没读到题目'
})
const currentQuestion = ref(0)
const homeworkList = ref<HTMLOListElement | null>(null)
let scrollRaf = 0

const stopListScroll = () => {
  if (!scrollRaf) return
  cancelAnimationFrame(scrollRaf)
  scrollRaf = 0
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

const scrollQuestionIntoList = (index: number) => {
  const list = homeworkList.value
  const el = list?.children[index] as HTMLElement | undefined
  if (!list || !el) return
  const nextTop = list.scrollTop + el.getBoundingClientRect().top - list.getBoundingClientRect().top
  const maxTop = Math.max(0, list.scrollHeight - list.clientHeight)
  const target = Math.max(0, Math.min(nextTop, maxTop))
  const start = list.scrollTop
  const dist = target - start
  if (Math.abs(dist) < 1) {
    list.scrollTop = target
    return
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    list.scrollTop = target
    return
  }
  stopListScroll()
  const duration = Math.min(320, 160 + Math.abs(dist) * 0.28)
  const t0 = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration)
    list.scrollTop = start + dist * easeOut(p)
    if (p < 1) scrollRaf = requestAnimationFrame(step)
    else scrollRaf = 0
  }
  scrollRaf = requestAnimationFrame(step)
}

const gotoQuestion = (index: number) => {
  const max = homeworkQuestions.value.length
  if (!max) return
  currentQuestion.value = Math.max(0, Math.min(max - 1, index))
  void nextTick(() => scrollQuestionIntoList(currentQuestion.value))
}

onUnmounted(stopListScroll)
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
  ].filter(Boolean).join(' · ') || (parsing.value ? '正在解析章节…' : '还没读到章节')
})
const catalogIndexOf = (value: string) => {
  const hit = String(value || '').trim().match(/^(\d+(?:\.\d+)+)\b/)
  return hit?.[1] || ''
}

const chapterTitlesMatch = (a: unknown, b: unknown) => {
  const ia = catalogIndexOf(String(a || ''))
  const ib = catalogIndexOf(String(b || ''))
  if (ia && ib && ia !== ib) return false
  const left = String(a || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ia
  const right = String(b || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ib
  if (!left || !right) return Boolean(ia && ib && ia === ib)
  if (ia && ib) return left === right
  return left === right || left.includes(right) || right.includes(left)
}

type PanelWatch = {
  title: string
  current: number
  duration: number
  percent: number
  status: string
  videoCount: number
  videoIndex: number
}

const panelWatch = computed((): PanelWatch | null => {
  const agent = videoWatch.value
  if (agent && (agent.duration > 1 || agent.status === 'quiz' || agent.status === 'captcha' || agent.status === 'done')) {
    return {
      title: agent.title || chapter.value?.currentTitle || '',
      current: agent.current,
      duration: agent.duration,
      percent: agent.percent,
      status: agent.status,
      videoCount: agent.videoCount,
      videoIndex: agent.videoIndex,
    }
  }
  const video = chapter.value?.video
  if (!video || !(video.duration > 1)) return null
  return {
    title: video.title || chapter.value?.currentTitle || chapter.value?.current || '',
    current: video.current,
    duration: video.duration,
    percent: video.percent,
    status: video.ended ? 'done' : video.paused ? 'paused' : 'watching',
    videoCount: 0,
    videoIndex: 0,
  }
})

const watchMatchesItem = (
  watch: PanelWatch,
  item: { title: string; index?: string; name?: string; active?: boolean },
) => {
  if (item.active) return true
  const want = String(watch.title || chapter.value?.currentTitle || '').trim()
  if (!want) return Boolean(item.active)
  return chapterTitlesMatch(item.title, want)
    || chapterTitlesMatch(item.name || '', want)
    || chapterTitlesMatch(item.index || '', want)
}

const watchClockOf = (watch: PanelWatch) => {
  if (!watch.duration) return formatVideoClock(watch.current)
  return `${formatVideoClock(watch.current)} / ${formatVideoClock(watch.duration)}`
}

const watchLabelOf = (watch: PanelWatch) => {
  if (watch.status === 'done') return '已完成'
  if (watch.status === 'captcha') return '验证码'
  if (watch.status === 'quiz') return '测验'
  if (watch.status === 'stalled') return '卡住'
  if (watch.status === 'paused') return '暂停'
  if (watch.status === 'lost') return '丢失'
  if (watch.videoCount > 1) return `${watch.videoIndex || 1}/${watch.videoCount}`
  return '播放中'
}

const chapterDepthOf = (item: { kind?: string; depth?: number; index?: string; title?: string }) => {
  if (item.kind === 'chapter') return 0
  if (Number(item.depth) > 0) return Number(item.depth)
  const index = String(item.index || '').trim() || catalogIndexOf(item.title || '')
  return index ? index.split('.').length : 1
}

const chapterNameOf = (title: string, index: string) => {
  let name = String(title || '').trim()
  if (index) name = name.replace(new RegExp(`^${index.replace(/\./g, '\\.')}\\s*`), '')
  return name === index ? '' : name
}

const chapterTree = computed(() => {
  const raw = (chapter.value?.chapters || []).slice(0, 200)
  const rows = raw.map((item) => {
    const index = String(item.index || '').trim() || catalogIndexOf(item.title)
    const depth = chapterDepthOf({ ...item, index })
    return {
      ...item,
      index,
      depth,
      name: chapterNameOf(item.title, index),
    }
  })
  const sectionDepths = rows.filter((item) => item.depth > 0).map((item) => item.depth)
  const shift = sectionDepths.length ? Math.min(...sectionDepths) - 1 : 0
  if (shift > 0) {
    for (const item of rows) {
      if (item.depth > 0) item.depth = Math.max(1, item.depth - shift)
    }
  }
  const watch = panelWatch.value
  const chapterJobs = (chapter.value?.jobs || []) as ChapterJobItem[]
  const watchHit = watch || chapterJobs.length
    ? (rows.find((item) => item.active)
      || (watch ? rows.find((item) => watchMatchesItem(watch, item)) : null)
      || null)
    : null
  return rows.map((item, i) => {
    const row = {
      key: `${item.kind}-${item.index}-${item.title}-${i}`,
      kind: item.kind || 'section',
      depth: item.depth,
      index: item.index,
      name: item.name,
      title: item.title,
      jobs: item.jobs,
      unfinished: item.unfinished,
      active: Boolean(item.active),
      href: item.href,
      studyHref: item.studyHref,
      chapterId: item.chapterId,
    }
    const matched = Boolean(watchHit && watchHit === item)
    const jobList = matched
      ? chapterJobs.map((job) => ({
          ...job,
          clock: job.duration
            ? `${formatVideoClock(job.current || 0)} / ${formatVideoClock(job.duration)}`
            : '',
          percent: Math.round(Number(job.percent) || 0),
        }))
      : []
    const showWatch = matched && watch && !jobList.length
    return {
      ...row,
      jobList,
      watch: showWatch ? watch : null,
      watchClock: showWatch && watch ? watchClockOf(watch) : '',
      watchLabel: showWatch && watch ? watchLabelOf(watch) : '',
      watchPercent: showWatch && watch ? Math.round(watch.percent) : 0,
    }
  })
})

const orphanWatch = computed(() => {
  const watch = panelWatch.value
  const hasJobs = chapterTree.value.some((item) => item.jobList?.length)
  if (hasJobs) return null
  if (!watch) return null
  if (chapterTree.value.some((item) => item.watch)) return null
  return {
    status: watch.status,
    percent: Math.round(watch.percent),
    clock: watchClockOf(watch),
    label: watchLabelOf(watch),
  }
})

const openingKey = ref('')

const openChapter = (item: {
  key: string
  kind: string
  title: string
  index?: string
  chapterId?: string
  href?: string
  studyHref?: string
  active?: boolean
}) => {
  if (!props.browserId || item.kind === 'chapter' || openingKey.value) return
  if (item.active) return
  openingKey.value = item.key
  void openChapterFromCard(props.browserId, item).finally(() => {
    if (openingKey.value === item.key) openingKey.value = ''
  })
}
const chapterProgress = computed(() => chapter.value?.progress || null)
const chapterRingDash = computed(() => {
  const progress = chapterProgress.value
  if (!progress?.total) return `0 ${HOMEWORK_RING}`
  return `${(progress.done / progress.total) * HOMEWORK_RING} ${HOMEWORK_RING}`
})
const studyEmpty = computed(() => {
  if (parsing.value || chapter.value?.status === 'reading') return '正在解析章节…'
  return studyStatus.value || '还没读到章节完成信息'
})

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
  if (currentQuestion.value >= list.length) {
    currentQuestion.value = Math.max(0, list.length - 1)
  }
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
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px 0;
  background: transparent;
}

.abs-empty {
  padding: 28px 8px;
  font-size: 13px;
  color: var(--text-secondary, #86868b);
  text-align: center;
}

.abs-card {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
}

.abs-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 2px 10px;
  background: var(--bg-secondary, #fff);
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 70%, transparent);
}

.abs-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.abs-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 14px;
  scrollbar-width: thin;
}

.abs-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-primary, #1d1d1f);
}

.abs-sub {
  font-size: 12px;
  color: var(--text-secondary, #86868b);
}

.abs-switcher {
  flex-shrink: 0;
  margin-right: -8px;
}

.abs-ring {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.abs-ring svg {
  display: block;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.abs-ring-track,
.abs-ring-arc {
  fill: none;
  stroke-width: 2;
}

.abs-ring-track {
  stroke: color-mix(in srgb, var(--text-primary, #000) 10%, transparent);
}

.abs-ring-arc {
  stroke: var(--color-primary, #667eea);
  stroke-linecap: round;
  transition: stroke-dasharray 220ms cubic-bezier(0.23, 1, 0.32, 1);
}

.abs-count {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #86868b);
}

.abs-list,
.abs-works {
  margin: 0;
  padding: 0;
  list-style: none;
}

.abs-tree {
  padding: 2px 0 24px;
}

.abs-ch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  min-height: 28px;
  padding: 5px 8px 5px calc(6px + var(--depth, 0) * 12px);
  border-radius: 8px;
}

.abs-ch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.abs-ch.is-watching {
  padding-bottom: 8px;
}

.abs-ch-watch {
  margin: 5px 0 0 var(--watch-indent, 0px);
  min-width: 0;
}

.abs-head-watch {
  margin: 0 2px 10px;
}

.abs-ch-joblist {
  margin: 4px 0 0 var(--watch-indent, 0px);
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.abs-ch-job {
  padding: 4px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-primary, #000) 3.5%, transparent);
}

.abs-ch-job.is-active {
  background: color-mix(in srgb, var(--color-primary, #667eea) 8%, transparent);
}

.abs-ch-job.is-done:not(.is-active) {
  opacity: 0.72;
}

.abs-ch-job-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.abs-ch-job-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 550;
  color: var(--text-primary, #3a3a3c);
}

.abs-ch-job-state {
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #86868b);
}

.abs-ch-job .abs-ch-watch {
  margin-left: 0;
}

.abs-ch.is-chapter .abs-ch-watch {
  margin-left: calc(1.6ch + 8px);
}

.abs-ch-watch-bar {
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary, #86868b) 16%, transparent);
  overflow: hidden;
}

.abs-ch-watch-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2F6F78;
  transition: width 0.2s linear;
}

.abs-ch-watch.is-paused .abs-ch-watch-bar > span,
.abs-ch-watch.is-stalled .abs-ch-watch-bar > span {
  background: #c9a227;
}

.abs-ch-watch.is-quiz .abs-ch-watch-bar > span,
.abs-ch-watch.is-lost .abs-ch-watch-bar > span,
.abs-ch-watch.is-captcha .abs-ch-watch-bar > span {
  background: #c2410c;
}

.abs-ch-watch.is-done .abs-ch-watch-bar > span {
  background: #248a3d;
}

.abs-ch-watch-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #86868b);
}

.abs-ch-watch-meta span:first-child {
  font-weight: 550;
  color: var(--text-primary, #3a3a3c);
}

.abs-ch.is-chapter {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 12px 0 2px;
  padding: 8px 8px 7px;
  min-height: 26px;
  border-radius: 0;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 50%, transparent);
}

.abs-ch.is-chapter:first-child {
  margin-top: 2px;
}

.abs-ch.is-chapter::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 8px;
  background: linear-gradient(var(--bg-secondary, #fff), transparent);
  pointer-events: none;
}

.abs-ch.is-go {
  cursor: pointer;
}

.abs-ch.is-go:active {
  transform: scale(0.99);
}

.abs-ch.is-busy {
  opacity: 0.72;
}

.abs-ch:not(.is-chapter):hover {
  background: color-mix(in srgb, var(--text-primary, #000) 4%, transparent);
}

.abs-ch.is-current {
  background: color-mix(in srgb, var(--color-primary, #667eea) 9%, transparent);
}

.abs-ch.is-current:hover {
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
}

.abs-ch-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  line-height: 1.35;
  color: var(--text-primary, #1d1d1f);
}

.abs-ch.is-chapter .abs-ch-title {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--text-secondary, #6e6e73);
}

.abs-ch:not(.is-open):not(.is-current):not(.is-chapter) .abs-ch-title {
  color: var(--text-secondary, #86868b);
}

.abs-ch-title i {
  flex: 0 0 5ch;
  width: 5ch;
  font-style: normal;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 550;
  color: var(--text-secondary, #86868b);
}

.abs-ch.is-chapter .abs-ch-title i {
  flex-basis: 1.6ch;
  width: 1.6ch;
}

.abs-ch-title span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abs-ch em,
.abs-ch-jobs {
  flex-shrink: 0;
  font-style: normal;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.abs-ch em {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 14%, transparent);
  color: #5b67d1;
}

.abs-ch-jobs {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 99px;
  background: color-mix(in srgb, #f59e0b 16%, transparent);
  color: #9a6700;
  font-size: 10px;
}

.abs-ch.is-chapter .abs-ch-jobs {
  min-width: 0;
  height: auto;
  padding: 0;
  background: none;
  color: var(--text-secondary, #86868b);
  font-size: 11px;
  font-weight: 600;
}

.abs-q {
  padding: 12px 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
}

.abs-q.is-current {
  background: color-mix(in srgb, var(--color-primary, #667eea) 5%, transparent);
  border-radius: 8px;
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
