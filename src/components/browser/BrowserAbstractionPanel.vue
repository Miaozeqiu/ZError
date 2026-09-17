<template>
  <div class="abs-panel" role="region" :aria-label="panelLabel">
    <div v-if="!layer" class="abs-empty">
      {{ parsing ? '正在识别当前页…' : emptyHint }}
    </div>

    <article v-else-if="showHomework" class="abs-card">
      <header v-if="!chapterQuizDrill" class="abs-head">
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
      <footer v-if="homeworkQuestions.length && (homeworkCanSave || homeworkCanSubmit)" class="abs-hw-bar">
        <button
          v-if="homeworkCanSave"
          type="button"
          class="abs-hw-btn"
          :disabled="hwActing"
          @click="runHomeworkAction('save')"
        >暂存</button>
        <button
          v-if="homeworkCanSubmit"
          type="button"
          class="abs-hw-btn is-submit"
          :disabled="hwActing"
          @click="runHomeworkAction('submit')"
        >提交</button>
      </footer>
    </article>

    <article v-else-if="showStudy" class="abs-card">
      <div
        v-if="!isPlayerStudy && chapterProgressLabel"
        class="abs-now abs-catalog-progress"
      >
        <div class="abs-now-title">
          <span>章节目录</span>
          <em>{{ chapterProgressLabel }}</em>
        </div>
      </div>
      <div
        v-if="isPlayerStudy && orphanWatch"
        class="abs-ch-watch abs-head-watch"
        :class="`is-${orphanWatch.status}`"
      >
        <div class="abs-ch-watch-bar" aria-hidden="true">
          <span :style="{ width: `${orphanWatch.percent}%` }" />
        </div>
        <div class="abs-ch-watch-meta">
          <span>{{ orphanWatch.clock }}</span>
          <span
            v-if="watchMediaKind(orphanWatch.label)"
            class="abs-media"
            :aria-label="orphanWatch.label"
          >
            <AbsMediaIcon :kind="watchMediaKind(orphanWatch.label)" />
          </span>
          <span v-else>{{ orphanWatch.label }}</span>
          <span>{{ orphanWatch.percent }}%</span>
        </div>
      </div>
      <ol v-if="chapterTree.length" ref="chapterList" class="abs-list abs-tree abs-body">
        <li
          v-for="item in chapterTree"
          :key="item.key"
          class="abs-ch"
          :class="{
            'is-chapter': item.kind === 'chapter',
            'is-current': item.active,
            'is-open': item.unfinished,
            'is-watching': isPlayerStudy && (Boolean(item.watch) || item.jobList?.length),
          }"
          :style="{ '--depth': item.depth, '--watch-indent': item.index ? 'calc(5ch + 8px)' : '0px' }"
        >
          <div
            class="abs-ch-row"
            :class="{
              'is-go': item.kind !== 'chapter',
              'is-busy': openingKey === item.key,
            }"
            :title="item.kind === 'chapter' ? item.title : `打开并播放「${item.title}」`"
            :tabindex="item.kind === 'chapter' ? undefined : 0"
            role="button"
            @click="openChapter(item)"
            @keydown.enter.prevent="openChapter(item)"
          >
            <span class="abs-ch-title">
              <i v-if="item.index">{{ item.index }}</i>
              <span>{{ item.name || item.title }}</span>
            </span>
            <i v-if="openingKey === item.key" class="abs-spin abs-spin-sm" aria-hidden="true" />
            <b v-else-if="item.jobs && !item.active" class="abs-ch-jobs">{{ item.jobs }}</b>
          </div>
          <div
            v-if="isPlayerStudy && item.watch"
            class="abs-ch-watch"
            :class="`is-${item.watch.status}`"
          >
            <div class="abs-ch-watch-bar" aria-hidden="true">
              <span :style="{ width: `${item.watchPercent}%` }" />
            </div>
            <div class="abs-ch-watch-meta">
              <span>{{ item.watchClock }}</span>
              <span
                v-if="watchMediaKind(item.watchLabel)"
                class="abs-media"
                :aria-label="item.watchLabel"
              >
                <AbsMediaIcon :kind="watchMediaKind(item.watchLabel)" />
              </span>
              <span v-else>{{ item.watchLabel }}</span>
              <span>{{ item.watchPercent }}%</span>
            </div>
          </div>
          <div v-if="item.jobList?.length" class="abs-ch-joblist">
            <button
              v-for="(job, jobIdx) in item.jobList"
              :key="`job-${job.mid || job.jobid || job.label}-${jobIdx}`"
              type="button"
              class="abs-ch-job is-go"
              :class="{
                'is-active': job.active,
                'is-done': job.jobDone,
                'is-busy': openingKey === jobKey(item.key, job, jobIdx),
                [`is-${job.kind}`]: true,
              }"
              :title="job.kind === 'video'
                ? (job.active && job.paused === false ? '暂停此视频' : '播放此视频')
                : job.kind === 'quiz' ? '打开测验' : '打开任务点'"
              @click.stop="playJob(item, job, jobIdx)"
            >
              <div class="abs-ch-job-row">
                <span
                  class="abs-ch-job-mark"
                  :class="job.jobDone ? 'is-done' : 'is-todo'"
                  :title="job.jobDone ? '已完成' : '未完成'"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6.4" />
                    <path
                      v-if="job.jobDone"
                      d="M4.7 8.15 7.05 10.4 11.35 5.7"
                    />
                  </svg>
                </span>
                <span class="abs-ch-job-label">{{ job.label }}</span>
                <i v-if="openingKey === jobKey(item.key, job, jobIdx)" class="abs-spin abs-spin-sm" aria-hidden="true" />
                <span
                  v-else-if="job.kind === 'video'"
                  class="abs-ch-job-state abs-media"
                  :aria-label="job.active && job.paused === false ? '暂停' : '播放'"
                >
                  <AbsMediaIcon :kind="job.active && job.paused === false ? 'pause' : 'play'" />
                </span>
                <span v-else-if="job.kind === 'quiz'" class="abs-ch-job-state">测验</span>
                <span v-else-if="job.kind === 'doc'" class="abs-ch-job-state">文档</span>
              </div>
              <div
                v-if="job.kind === 'video' && (job.duration || job.current || job.clock)"
                class="abs-ch-watch"
                :class="job.paused ? 'is-paused' : job.jobDone ? 'is-done' : 'is-watching'"
              >
                <div class="abs-ch-watch-bar" aria-hidden="true">
                  <span :style="{ width: `${job.percent || 0}%` }" />
                </div>
                <div class="abs-ch-watch-meta">
                  <span>{{ job.clock }}</span>
                  <span
                    class="abs-media"
                    :aria-label="job.paused ? '暂停' : '播放中'"
                  >
                    <AbsMediaIcon :kind="job.paused ? 'pause' : 'play'" />
                  </span>
                  <span>{{ job.percent || 0 }}%</span>
                </div>
              </div>
            </button>
          </div>
        </li>
      </ol>
      <div v-else-if="studyBusy" class="abs-skel-wrap abs-body" aria-hidden="true">
        <div
          v-for="n in 8"
          :key="`skel-${n}`"
          class="abs-skel"
          :style="{ width: `${n % 3 === 0 ? 58 : n % 2 === 0 ? 78 : 70}%` }"
        />
      </div>
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
import { computed, defineComponent, h, nextTick, onUnmounted, ref, watch } from 'vue'
import {
  abstractionDrill,
  abstractionParsing,
  clearAbstractionDrill,
  isStudyUrl,
  lastHomeworkCard,
  primaryAbstraction,
  abstractionRole,
  setAbstractionDrill,
} from '../../services/browser/abstractions'
import QuestionIndexSwitcher from '../ui/QuestionIndexSwitcher.vue'
import { stopBrowserAgent } from '../../services/agent/chat'
import {
  chapterStateFor,
  openChapterFromCard,
  playChapterJobFromCard,
  refreshChapterCard,
  startChaoxingChapterParser,
} from '../../services/chaoxing/browser/chapters'
import type { ChapterJobItem } from '../../services/chaoxing/browser/chapters'
import {
  formatVideoClock,
  videoWatchFor,
} from '../../services/chaoxing/browser/watch'
import {
  inspectChaoxingHomework,
  pickHomeworkOption,
  saveChaoxingHomework,
  startHomeworkLiveSync,
  submitChaoxingHomework,
} from '../../services/chaoxing/homework'
import { cachedHwImage, normalizeHwImageUrl, resolveHwImage } from '../../services/chaoxing/homework/homeworkImages'

const AbsMediaIcon = defineComponent({
  name: 'AbsMediaIcon',
  props: {
    kind: { type: String, required: true },
  },
  setup(props) {
    return () => h('svg', {
      class: 'abs-media-svg',
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
    }, props.kind === 'pause'
      ? [
          h('rect', { x: '4.2', y: '3.45', width: '2.5', height: '9.1', rx: '0.7' }),
          h('rect', { x: '9.3', y: '3.45', width: '2.5', height: '9.1', rx: '0.7' }),
        ]
      : [h('path', { d: 'M5.35 3.2a.7.7 0 0 1 1.07-.6l7.05 4.8a.7.7 0 0 1 0 1.2l-7.05 4.8a.7.7 0 0 1-1.07-.6Z' })])
  },
})

const watchMediaKind = (label: string): 'play' | 'pause' | '' => {
  if (label === '暂停') return 'pause'
  if (label === '播放中') return 'play'
  return ''
}

const props = defineProps<{
  browserId?: string
  url?: string
}>()

const parsing = abstractionParsing
const chapter = computed(() => chapterStateFor(props.browserId))

watch(
  () => [props.browserId, props.url] as const,
  ([id, url]) => {
    if (!id || !isStudyUrl(url || '')) return
    abstractionParsing.value = false
    startChaoxingChapterParser(id)
    void refreshChapterCard(id)
  },
  { immediate: true },
)
const videoWatch = computed(() => videoWatchFor(props.browserId))
const layer = computed(() => primaryAbstraction(props.url || ''))
const layerRole = computed(() => abstractionRole(layer.value))
const chapterQuizDrill = computed(() => {
  const drill = abstractionDrill.value
  if (!drill || drill.kind !== 'chapter-quiz') return null
  if (props.browserId && drill.browserId !== props.browserId) return null
  return drill
})
const showHomework = computed(() => layerRole.value === 'homework' || Boolean(chapterQuizDrill.value))
const showStudy = computed(() => layerRole.value === 'study' && !chapterQuizDrill.value)
const isPlayerStudy = computed(() => chapter.value?.kind === 'player' || /studentstudy/i.test(String(chapter.value?.url || '')))
const chapterProgressLabel = computed(() => {
  const progress = chapter.value?.progress
  if (progress && progress.total > 0) return `已完成任务点 ${progress.done}/${progress.total}`
  const left = Number(chapter.value?.unfinishedCount) || (chapter.value?.unfinished?.length || 0)
  if (left > 0) return `未完成 ${left} 节`
  if (chapter.value?.chapters?.length) return `${chapter.value.chapters.length} 节`
  return ''
})
const panelLabel = computed(() => {
  if (chapterQuizDrill.value) return '测验'
  if (layerRole.value === 'study') return '章节'
  if (layerRole.value === 'homework') return '题卡'
  return layer.value?.name?.replace(/^学习通|^智慧树/, '') || '解析'
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
const homeworkCanSave = computed(() => (
  Boolean(homework.value?.canSave) || homeworkQuestions.value.length > 0
))
const homeworkCanSubmit = computed(() => (
  Boolean(homework.value?.canSubmit) || homeworkQuestions.value.length > 0
))
const hwActing = ref(false)
const runHomeworkAction = async (action: 'save' | 'submit') => {
  const id = String(props.browserId || '').trim()
  if (!id || hwActing.value) return
  hwActing.value = true
  try {
    if (action === 'save') await saveChaoxingHomework(id)
    else await submitChaoxingHomework(id)
  } finally {
    hwActing.value = false
  }
}
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

type PanelWatch = {
  title: string
  current: number
  duration: number
  percent: number
  status: string
  videoCount: number
  videoIndex: number
  mid: string
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
      mid: String(agent.mid || ''),
    }
  }
  const video = chapter.value?.video
  if (!video || !(video.duration > 1 || video.current > 0.2)) return null
  const liveJob = (chapter.value?.jobs || []).find((item) => item.active && item.kind === 'video')
  return {
    title: video.title || chapter.value?.currentTitle || chapter.value?.current || '',
    current: video.current,
    duration: video.duration,
    percent: video.percent,
    status: video.ended ? 'done' : video.paused ? 'paused' : 'watching',
    videoCount: (chapter.value?.jobs || []).filter((item) => item.kind === 'video').length,
    videoIndex: liveJob
      ? (chapter.value?.jobs || []).filter((item) => item.kind === 'video').indexOf(liveJob) + 1
      : 0,
    mid: String(liveJob?.mid || ''),
  }
})

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

type CatalogRow = {
  key: string
  kind: string
  depth: number
  index: string
  name: string
  title: string
  jobs: number
  unfinished: boolean
  active: boolean
  href?: string
  studyHref?: string
  chapterId?: string
}

type JobView = ChapterJobItem & { clock?: string; percent?: number }

type ChapterTreeRow = CatalogRow & {
  jobList: JobView[]
  watch: PanelWatch | null
  watchClock: string
  watchLabel: string
  watchPercent: number
}

const chapterCatalog = computed((): CatalogRow[] => {
  const raw = (chapter.value?.chapters || []).slice(0, 200)
  const rows = raw.map((item, i) => {
    const index = String(item.index || '').trim() || catalogIndexOf(item.title)
    const depth = chapterDepthOf({ ...item, index })
    return {
      key: `${item.kind}-${index}-${item.title}-${i}`,
      kind: item.kind || 'section',
      depth,
      index,
      name: chapterNameOf(item.title, index),
      title: item.title,
      jobs: item.jobs,
      unfinished: item.unfinished,
      active: Boolean(item.active),
      href: item.href,
      studyHref: item.studyHref,
      chapterId: item.chapterId,
    }
  })
  const sectionDepths = rows.filter((item) => item.depth > 0).map((item) => item.depth)
  const shift = sectionDepths.length ? Math.min(...sectionDepths) - 1 : 0
  if (shift > 0) {
    for (const item of rows) {
      if (item.depth > 0) item.depth = Math.max(1, item.depth - shift)
    }
  }
  return rows
})

const overlayJob = (job: ChapterJobItem, watch: PanelWatch | null, videoOrd: number): JobView => {
  const live = Boolean(
    watch
    && job.kind === 'video'
    && (
      (watch.mid && job.mid && watch.mid === job.mid)
      || (!watch.mid && watch.videoIndex > 0 && videoOrd === watch.videoIndex)
      || (!watch.mid && watch.videoIndex <= 0 && job.active)
    ),
  )
  const current = live ? watch!.current : job.current
  const duration = live ? watch!.duration : job.duration
  const percent = live ? watch!.percent : job.percent
  const paused = live
    ? (watch!.status === 'paused' || watch!.status === 'stalled' || watch!.status === 'lost')
    : job.paused
  return {
    ...job,
    current,
    duration,
    percent: Math.round(Number(percent) || 0),
    paused,
    clock: duration
      ? `${formatVideoClock(current || 0)} / ${formatVideoClock(duration)}`
      : '',
  }
}

const jobsWithWatch = (jobs: ChapterJobItem[], watch: PanelWatch | null) => {
  const videos = jobs.filter((job) => job.kind === 'video')
  let jobList = jobs.map((job) => overlayJob(job, watch, videos.indexOf(job) + 1))
  const fromParsed = jobList.filter((job) => job.kind === 'video').length
  const fromWatch = Number(watch?.videoCount) || 0
  const tabStyle = fromParsed <= 1 && fromWatch > 1 && fromWatch <= 8
  if (tabStyle && fromWatch > jobList.length) {
    const activeIndex = Math.max(1, Number(watch?.videoIndex) || jobList.findIndex((job) => job.active) + 1 || 1)
    const keep = jobList.slice()
    jobList = Array.from({ length: fromWatch }, (_, idx) => keep[idx] || {
      mid: '',
      jobid: '',
      label: `视频${idx + 1}`,
      kind: 'video' as const,
      jobDone: false,
      unfinished: true,
      active: idx + 1 === activeIndex,
      clock: '',
      percent: 0,
    })
  }
  return jobList
}

const inactiveTreeRows = new WeakMap<CatalogRow, ChapterTreeRow>()

const chapterTree = computed(() => {
  const rows = chapterCatalog.value
  const watch = panelWatch.value
  const chapterJobs = (chapter.value?.jobs || []) as ChapterJobItem[]
  const mapped = rows.map((item) => {
    const matched = item.active
    if (!matched) {
      const prev = inactiveTreeRows.get(item)
      if (prev) return prev
      const next: ChapterTreeRow = {
        ...item,
        jobList: [],
        watch: null,
        watchClock: '',
        watchLabel: '',
        watchPercent: 0,
      }
      inactiveTreeRows.set(item, next)
      return next
    }
    const jobList = jobsWithWatch(chapterJobs, watch)
    const showWatch = Boolean(watch && !jobList.length)
    return {
      ...item,
      jobList,
      watch: showWatch ? watch : null,
      watchClock: showWatch && watch ? watchClockOf(watch) : '',
      watchLabel: showWatch && watch ? watchLabelOf(watch) : '',
      watchPercent: showWatch && watch ? Math.round(watch.percent) : 0,
    }
  })

  // 目录没标出当前节时，仍把已解析到的任务点挂到第一个小节上，避免顶部没有可点列表
  if (!mapped.some((item) => item.jobList?.length) && chapterJobs.length) {
    const activeAt = mapped.findIndex((item) => item.active)
    const sectionAt = mapped.findIndex((item) => item.kind !== 'chapter')
    const hostAt = activeAt >= 0 ? activeAt : (sectionAt >= 0 ? sectionAt : 0)
    const host = mapped[hostAt]
    if (host) {
      mapped[hostAt] = {
        ...host,
        jobList: jobsWithWatch(chapterJobs, watch),
      }
    }
  }
  return mapped
})

const chapterList = ref<HTMLOListElement | null>(null)

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
/** 连续点击时只认最后一次，避免 busy 锁死整块面板 */
let openGen = 0
const OPEN_BUSY_MS = 5000

const clearOpening = (gen: number) => {
  if (gen === openGen) openingKey.value = ''
}

const runOpen = (key: string, work: () => Promise<unknown>) => {
  const gen = ++openGen
  openingKey.value = key
  const timer = window.setTimeout(() => clearOpening(gen), OPEN_BUSY_MS)
  void work()
    .catch(() => null)
    .finally(() => {
      window.clearTimeout(timer)
      clearOpening(gen)
    })
}

watch(
  () => [props.browserId, props.url] as const,
  () => {
    openGen += 1
    openingKey.value = ''
  },
)

watch(
  () => {
    const host = chapterTree.value.find((item) => item.active && item.jobList?.length)
    return host ? `${host.key}:${host.jobList?.length || 0}` : ''
  },
  async (key) => {
    if (!key) return
    await nextTick()
    const row = chapterList.value?.querySelector('.abs-ch.is-current')
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
)

const jobKey = (
  chapterKey: string,
  job: { mid?: string; jobid?: string; label?: string },
  jobIdx: number,
) => `${chapterKey}-job-${job.mid || job.jobid || job.label || jobIdx}`

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
  if (!props.browserId || item.kind === 'chapter') return
  stopBrowserAgent(props.browserId)
  runOpen(item.key, () => openChapterFromCard(props.browserId!, item))
}

const playJob = (
  item: {
    key: string
    kind: string
    title: string
    name?: string
    index?: string
    chapterId?: string
    href?: string
    studyHref?: string
    active?: boolean
    jobList?: Array<ChapterJobItem & { clock?: string; percent?: number }>
  },
  job: ChapterJobItem & { clock?: string; percent?: number },
  jobIdx: number,
) => {
  if (!props.browserId) return
  const key = jobKey(item.key, job, jobIdx)
  stopBrowserAgent(props.browserId)
  const videosBefore = (item.jobList || []).slice(0, jobIdx + 1).filter((entry) => entry.kind === 'video')
  const videoIndex = job.kind === 'video' ? videosBefore.length : 0
  const browserId = props.browserId
  runOpen(key, async () => {
    const result = await playChapterJobFromCard(browserId, item, job, {
      videoIndex: videoIndex || undefined,
      stepIndex: jobIdx + 1,
    })
    if (job.kind === 'quiz' || result?.quiz) {
      const sectionTitle = String(item.name || item.title || '').trim() || '本节'
      setAbstractionDrill({
        browserId,
        kind: 'chapter-quiz',
        sectionIndex: item.index,
        sectionTitle,
        jobLabel: String(job.label || '测验').trim() || '测验',
      })
      await inspectChaoxingHomework(browserId, { vision: true }).catch(() => null)
      await startHomeworkLiveSync(browserId).catch(() => null)
    } else {
      clearAbstractionDrill(browserId)
    }
  })
}
const studyBusy = computed(() => chapter.value?.status === 'reading' && !chapterTree.value.length)
const studyEmpty = computed(() => studyStatus.value || '还没读到章节完成信息')

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
  return cachedHwImage(url) || url
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

const isBlankStem = (stem: string) => {
  const text = String(stem || '').replace(/[\s\u00a0\u3000]+/g, '')
  return !text || /^[（()）]+$/.test(text)
}

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
  const imgs = rawImages(item.images)
  if (imgs.length) {
    return imgs.map((src) => {
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
  padding: 6px 8px 0;
  background: transparent;
}

.abs-load {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 550;
  color: var(--text-secondary, #6e6e73);
  background: color-mix(in srgb, var(--text-primary, #000) 4%, transparent);
}

.abs-spin {
  flex-shrink: 0;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--color-primary, #667eea) 22%, transparent);
  border-top-color: var(--color-primary, #667eea);
  animation: abs-spin 700ms linear infinite;
}

.abs-spin-sm {
  width: 10px;
  height: 10px;
}

.abs-skel-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 2px 16px;
}

.abs-skel {
  height: 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-primary, #000) 8%, transparent);
  animation: abs-skel 1.05s ease-out infinite;
}

@keyframes abs-spin {
  to { transform: rotate(360deg); }
}

@keyframes abs-skel {
  50% { opacity: 0.42; }
}

@media (prefers-reduced-motion: reduce) {
  .abs-spin,
  .abs-skel {
    animation: none;
  }
}

.abs-empty {
  padding: 20px 8px;
  font-size: 12px;
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
  padding: 0 0 16px;
}

.abs-ch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  min-height: 22px;
  padding: 1px 0 1px calc(var(--depth, 0) * 10px);
}

.abs-ch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 6px;
  transition: transform 100ms ease-out, background-color 140ms ease-out;
}

.abs-ch-row.is-go {
  cursor: pointer;
}

.abs-ch-row.is-go:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.abs-ch-row.is-go:active {
  transform: scale(0.97);
}

.abs-ch-row.is-busy {
  opacity: 0.7;
}

.abs-ch.is-watching {
  padding-bottom: 8px;
}

.abs-ch-watch {
  margin: 5px 6px 0 calc(6px + var(--watch-indent, 0px));
  min-width: 0;
}

.abs-head-watch {
  margin: 0 2px 10px;
}

.abs-ch-joblist {
  margin: 4px 6px 0 var(--watch-indent, 0px);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  z-index: 2;
}

.abs-now {
  flex-shrink: 0;
  margin: 0 0 6px;
  padding: 5px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary, #667eea) 14%, transparent);
}

.abs-now-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary, #3a3a3c);
}

.abs-now-title em {
  font-style: normal;
  font-size: 10px;
  font-weight: 550;
  color: var(--text-secondary, #86868b);
}

.abs-ch-job {
  display: block;
  width: 100%;
  margin: 0;
  padding: 3px 5px;
  border: none;
  border-radius: 6px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: color-mix(in srgb, var(--text-primary, #000) 3.5%, transparent);
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  transition: transform 100ms ease-out, background-color 140ms ease-out;
}

.abs-ch-job.is-go:active {
  transform: scale(0.97);
}

.abs-ch-job.is-go:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
}

.abs-ch-job.is-busy {
  opacity: 0.55;
}

.abs-head-study {
  flex-wrap: wrap;
  align-items: flex-start;
}

.abs-hint {
  width: 100%;
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary, #86868b);
}

.abs-ch-job.is-active {
  background: color-mix(in srgb, var(--color-primary, #667eea) 8%, transparent);
}

.abs-ch-job.is-done:not(.is-active) {
  opacity: 1;
}

.abs-ch-job-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.abs-ch-job-mark {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
}

.abs-ch-job-mark svg {
  display: block;
  width: 13px;
  height: 13px;
}

.abs-ch-job-mark circle {
  fill: #fff;
  stroke-width: 1.7;
}

.abs-ch-job-mark path {
  fill: none;
  stroke: #1f8a3c;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.abs-ch-job-mark.is-done circle {
  stroke: #1f8a3c;
}

.abs-ch-job-mark.is-todo circle {
  fill: #f59e0b;
  stroke: #f59e0b;
}

.abs-ch-job-label {
  flex: 1;
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

.abs-media {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

.abs-media-svg {
  display: block;
  width: 11px;
  height: 11px;
  fill: currentColor;
}

.abs-ch-job-state.abs-media {
  width: 14px;
  height: 14px;
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
  margin: 6px 0 1px;
  padding: 4px 6px 3px;
  min-height: 20px;
  border-radius: 0;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 50%, transparent);
  /* 粘住时不要挡住下面可点的小节 / 任务点 */
  pointer-events: none;
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

.abs-ch.is-current .abs-ch-row {
  background: color-mix(in srgb, var(--color-primary, #667eea) 9%, transparent);
}

.abs-ch.is-current .abs-ch-row.is-go:hover {
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
}

.abs-ch-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-primary, #1d1d1f);
}

.abs-ch.is-chapter .abs-ch-title {
  font-size: 11px;
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
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
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

.abs-hw-bar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 8px 2px 10px;
}

.abs-hw-btn {
  flex: 1;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 13px;
  cursor: pointer;
}

.abs-hw-btn.is-submit {
  background: var(--accent-primary, #3b82f6);
  color: #fff;
}

.abs-hw-btn:disabled {
  opacity: 0.5;
  cursor: default;
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
