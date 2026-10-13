<template>
  <div class="browser-page">
    <section class="browser-main">
      <div v-if="selected" class="browser-chrome">
        <button class="chrome-btn" type="button" title="后退" @click="goBack">
          <svg viewBox="0 0 16 16"><path d="M10 3.2 5.2 8 10 12.8" /></svg>
        </button>
        <button class="chrome-btn" type="button" title="前进" @click="goForward">
          <svg viewBox="0 0 16 16"><path d="M6 3.2 10.8 8 6 12.8" /></svg>
        </button>
        <button class="chrome-btn" type="button" title="刷新" @click="reload">
          <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.4-3.4" /><path d="M13 2.6v3.2h-3.2" /></svg>
        </button>
        <button class="chrome-btn" type="button" title="回到导航" @click="goHome">
          <svg viewBox="0 0 16 16"><path d="M2.6 7.2 8 2.8l5.4 4.4" /><path d="M4 7.2V13h8V7.2" /></svg>
        </button>
        <input
          class="chrome-place"
          :value="addressText"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          placeholder="输入网址"
          @focus="focusAddress"
          @blur="blurAddress"
          @input="onAddressInput"
          @keydown.enter.prevent="submitAddress"
          @keydown.escape.prevent="cancelAddress"
        >
        <div class="chrome-zoom">
          <button
            class="chrome-btn"
            type="button"
            title="缩小"
            :disabled="zoom <= MIN_BROWSER_ZOOM"
            @click="zoomOut"
          >
            <svg viewBox="0 0 16 16"><path d="M3.5 8h9" /></svg>
          </button>
          <button class="chrome-zoom-label" type="button" title="重置为 100%" @click="resetZoom">
            {{ zoomPercent }}%
          </button>
          <button
            class="chrome-btn"
            type="button"
            title="放大"
            :disabled="zoom >= MAX_BROWSER_ZOOM"
            @click="zoomIn"
          >
            <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>
          </button>
        </div>
        <HeaderSiteGraphMenu />
        <HeaderAbstractionMenu />
        <div
          class="chrome-load"
          :class="{ 'is-on': loadLine.visible, 'is-fade': loadLine.fading }"
          role="progressbar"
          :aria-hidden="!loadLine.visible"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="Math.round(loadLine.progress * 100)"
        >
          <i :style="{ transform: `scaleX(${loadLine.progress})` }" />
        </div>
      </div>
      <div v-if="selected" ref="hostRef" class="browser-host" />
      <div v-else class="browser-empty">正在打开浏览器</div>
    </section>
    <aside v-if="siteGraphMenuOpen" class="browser-card">
      <div class="pane-header">
        <div class="header-title">图谱</div>
      </div>
      <BrowserSiteGraphPanel :url="address || selected?.url" />
    </aside>
    <aside v-else-if="abstractionMenuOpen" class="browser-card">
      <div class="pane-header">
        <template v-if="abstractionDrillView">
          <button
            type="button"
            class="header-back"
            title="返回章节"
            @click="backFromAbstractionDrill"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.2 3.2 5.4 8l4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <nav class="header-crumbs" aria-label="层级">
            <button type="button" class="header-crumb is-link" @click="backFromAbstractionDrill">章节</button>
            <span class="header-crumb-sep" aria-hidden="true">/</span>
            <span class="header-crumb" :title="abstractionDrillView.sectionTitle">
              {{ abstractionDrillView.sectionIndex ? `${abstractionDrillView.sectionIndex} ` : '' }}{{ abstractionDrillView.sectionTitle }}
            </span>
            <span class="header-crumb-sep" aria-hidden="true">/</span>
            <span class="header-crumb is-current">{{ abstractionDrillView.jobLabel }}</span>
          </nav>
          <div
            v-if="homeworkHeaderProgress"
            class="header-ring"
            :title="`${homeworkHeaderProgress.filled} / ${homeworkHeaderProgress.count}`"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle class="header-ring-track" cx="8" cy="8" r="6" />
              <circle
                class="header-ring-arc"
                cx="8"
                cy="8"
                r="6"
                :stroke-dasharray="homeworkHeaderRingDash"
              />
            </svg>
          </div>
          <div v-if="homeworkHeaderProgress" class="header-count">
            {{ homeworkHeaderProgress.filled }} / {{ homeworkHeaderProgress.count }}
          </div>
        </template>
        <template v-else>
          <div class="header-title">{{ abstractionPanelTitle }}</div>
          <div
            v-if="abstractionChapterProgress"
            class="header-ring"
            :title="`已完成任务点 ${abstractionChapterProgress.done} / ${abstractionChapterProgress.total}`"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle class="header-ring-track" cx="8" cy="8" r="6" />
              <circle
                class="header-ring-arc"
                cx="8"
                cy="8"
                r="6"
                :stroke-dasharray="abstractionChapterRingDash"
              />
            </svg>
          </div>
          <div v-if="abstractionChapterProgress" class="header-count">
            {{ abstractionChapterProgress.done }} / {{ abstractionChapterProgress.total }}
          </div>
        </template>
      </div>
      <BrowserAbstractionPanel
        :browser-id="selected?.id"
        :url="address || selected?.url"
      />
    </aside>
    <BrowserAgent
      :browser-id="selected?.id"
      :name="selected?.name"
      :url="selected?.url"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BrowserAgent from '../components/browser/BrowserAgent.vue'
import BrowserAbstractionPanel from '../components/browser/BrowserAbstractionPanel.vue'
import BrowserSiteGraphPanel from '../components/browser/BrowserSiteGraphPanel.vue'
import HeaderAbstractionMenu from './appHeader/HeaderAbstractionMenu.vue'
import HeaderSiteGraphMenu from './appHeader/HeaderSiteGraphMenu.vue'
import { browserTabHandlers, syncBrowserTabBar } from '../services/browser/tabBar'
import {
  browserHomeUrl,
  closeBrowserView,
  createAppBrowser,
  ensureDefaultBrowsers,
  BROWSER_ZOOM_STEP,
  MAX_BROWSER_ZOOM,
  MIN_BROWSER_ZOOM,
  clampBrowserZoom,
  goBackBrowserView,
  goForwardBrowserView,
  hideAllBrowserViews,
  hostnameOf,
  hostBounds,
  isBrowserHome,
  normalizeBrowserUrl,
  getSelectedBrowserId,
  listenBrowserOpened,
  listenBrowserLoad,
  listenBrowserState,
  listAppBrowsers,
  navigateBrowserView,
  openBrowserView,
  reloadBrowserView,
  setSelectedBrowserId,
  patchAppBrowser,
  setBrowserBounds,
  setBrowserZoom,
  showBrowserView,
  removeAppBrowser,
  upsertAppBrowser,
  type AppBrowser,
} from '../services/browser/appBrowser'
import { ensureBrowserChat } from '../services/agent/chat'
import {
  startHomeworkBackgroundParse,
  startHomeworkLiveSync,
  stopHomeworkBackgroundParse,
  stopHomeworkLiveSync,
} from '../services/chaoxing/homework'
import { kickParserClock, unwatchParserClock } from '../services/browser/pageClock'
import { questionHasContent } from '../services/chaoxing/homework/parse'
import {
  chapterStateFor,
  resyncChaoxingStudy,
  startChaoxingChapterParser,
  stopChaoxingChapterParser,
  syncChaoxingChapterUrl,
} from '../services/chaoxing/browser/chapters'
import {
  abstractionDrill,
  abstractionMenuOpen,
  abstractionParsing,
  abstractionPanelTitle,
  clearAbstractionDrill,
  lastHomeworkCard,
  parserPageKind,
  publishHomeworkCard,
  setCurrentBrowserPage,
} from '../services/browser/abstractions'
import { siteGraphMenuOpen } from '../services/browser/siteGraph'
import { stopWatchCourseTab, watchCourseTab } from '../services/platform/chaoxing/courseTab'
import { isChaoxingCourseUrl } from '../services/platform/chaoxing/nav'

const props = defineProps<{
  active?: boolean
}>()

const browsers = ref<AppBrowser[]>([])
const selectedId = ref('')
const hostRef = ref<HTMLElement | null>(null)
const address = ref('')

let unlistenState: (() => void) | null = null
let unlistenOpened: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let boundsRaf = 0
/** 已挂上原生视图的窗口，以及它当前的位置尺寸；用于跳过重复的原生调用 */
let shownId = ''
let shownBounds = ''

const selected = computed(() => browsers.value.find((item) => item.id === selectedId.value) || null)
const CHAPTER_RING = 2 * Math.PI * 6
const abstractionDrillView = computed(() => {
  const drill = abstractionDrill.value
  if (!drill || drill.kind !== 'chapter-quiz') return null
  if (selectedId.value && drill.browserId !== selectedId.value) return null
  return drill
})
const abstractionChapterProgress = computed(() => {
  if (abstractionDrillView.value) return null
  if (abstractionPanelTitle.value !== '章节') return null
  return chapterStateFor(selectedId.value)?.progress || null
})
const abstractionChapterRingDash = computed(() => {
  const progress = abstractionChapterProgress.value
  if (!progress?.total) return `0 ${CHAPTER_RING}`
  return `${(progress.done / progress.total) * CHAPTER_RING} ${CHAPTER_RING}`
})
const homeworkHeaderProgress = computed(() => {
  if (!abstractionDrillView.value) return null
  const card = lastHomeworkCard.value
  const count = Number(card?.questionCount || card?.questions?.length) || 0
  if (!count) return null
  return { count, filled: Number(card?.filledCount) || 0 }
})
const homeworkHeaderRingDash = computed(() => {
  const progress = homeworkHeaderProgress.value
  if (!progress?.count) return `0 ${CHAPTER_RING}`
  return `${(progress.filled / progress.count) * CHAPTER_RING} ${CHAPTER_RING}`
})
const backFromAbstractionDrill = () => {
  clearAbstractionDrill(selectedId.value)
}
const zoom = computed(() => clampBrowserZoom(selected.value?.zoom))
const zoomPercent = computed(() => Math.round(zoom.value * 100))
const addressText = ref('')
const addressFocused = ref(false)
const loadLine = ref({ visible: false, fading: false, progress: 0 })

let unlistenLoad: (() => void) | null = null
let loadRaf = 0
let loadFrom = 0
let loadAt = 0
let loadFinishing = false
let loadTab = ''
const loadingTabs = new Set<string>()
const reduceLoadMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const stopLoadTick = () => {
  if (loadRaf) window.cancelAnimationFrame(loadRaf)
  loadRaf = 0
}

const beginLoadLine = (id: string) => {
  if (!id) return
  loadingTabs.add(id)
  loadTab = id
  loadFinishing = false
  stopLoadTick()
  if (id !== selectedId.value) return
  const current = loadLine.value.visible && !loadLine.value.fading ? loadLine.value.progress : 0
  loadFrom = current >= 0.98 ? 0 : current
  loadAt = performance.now()
  loadLine.value = { visible: true, fading: false, progress: loadFrom || 0.04 }
  const tick = (now: number) => {
    if (loadFinishing || loadTab !== id) return
    const t = (now - loadAt) / 1000
    const cap = reduceLoadMotion() ? 0.7 : 0.86
    const eased = 1 - Math.exp(-t / (reduceLoadMotion() ? 0.28 : 1.15))
    loadLine.value = {
      visible: true,
      fading: false,
      progress: loadFrom + (cap - loadFrom) * eased,
    }
    loadRaf = window.requestAnimationFrame(tick)
  }
  loadRaf = window.requestAnimationFrame(tick)
}

const finishLoadLine = (id: string) => {
  if (!id) return
  loadingTabs.delete(id)
  if (loadTab && loadTab !== id) return
  loadFinishing = true
  stopLoadTick()
  if (id !== selectedId.value) {
    loadLine.value = { visible: false, fading: false, progress: 0 }
    return
  }
  loadLine.value = { visible: true, fading: true, progress: 1 }
  window.setTimeout(() => {
    if (!loadFinishing || loadTab !== id) return
    loadLine.value = { visible: false, fading: false, progress: 0 }
    loadFinishing = false
  }, reduceLoadMotion() ? 120 : 320)
}

const visibleUrl = (raw: string) => {
  if (isBrowserHome(raw)) return ''
  return raw
}

const syncAddressText = () => {
  if (addressFocused.value) return
  addressText.value = visibleUrl(address.value || selected.value?.url || '')
}

const onAddressInput = (event: Event) => {
  addressText.value = (event.target as HTMLInputElement).value
}

const focusAddress = () => {
  addressFocused.value = true
}

const blurAddress = () => {
  addressFocused.value = false
  syncAddressText()
}

const cancelAddress = () => {
  addressFocused.value = false
  addressText.value = visibleUrl(address.value || selected.value?.url || '')
}

const submitAddress = async () => {
  const current = selected.value
  if (!current) return
  const raw = addressText.value.trim()
  if (!raw) {
    await goHome()
    return
  }
  const next = normalizeBrowserUrl(raw)
  address.value = next
  upsertAppBrowser({ id: current.id, name: current.name, url: next, title: hostnameOf(next) })
  loadBrowsers()
  addressFocused.value = false
  addressText.value = visibleUrl(next)
  beginLoadLine(current.id)
  try {
    await navigateBrowserView(current.id, next)
  } catch {
    finishLoadLine(current.id)
    await syncView()
  }
}

const MAX_TABS = 16

const tabLabel = (item: AppBrowser) => {
  if (isBrowserHome(item.url)) return '导航'
  return item.title || item.name || hostnameOf(item.url)
}

const loadBrowsers = (preferId = '') => {
  browsers.value = ensureDefaultBrowsers()
  const current = browsers.value.find((item) => item.id === preferId)
    || browsers.value.find((item) => item.id === selectedId.value)
    || browsers.value.find((item) => item.id === getSelectedBrowserId())
    || browsers.value[0]
    || null
  selectedId.value = current?.id || ''
  syncBrowserTabBar(browsers.value, selectedId.value)
  if (current) {
    setSelectedBrowserId(current.id)
    address.value = current.url
    setCurrentBrowserPage(current.id, current.url)
    syncAddressText()
  }
}

const selectTab = (id: string) => {
  if (!id || id === selectedId.value) return
  loadBrowsers(id)
}

const newTab = () => {
  if (browsers.value.length >= MAX_TABS) return
  const item = createAppBrowser({ url: browserHomeUrl(), name: '导航', title: '导航' })
  loadBrowsers(item.id)
}

const closeTab = async (id: string) => {
  const list = browsers.value
  if (list.length <= 1) {
    if (selected.value) await goHome()
    return
  }
  const index = list.findIndex((item) => item.id === id)
  const fallback = list[index + 1] || list[index - 1] || list[0]
  removeAppBrowser(id)
  stopChaoxingChapterParser(id)
  unwatchParserClock(id)
  void closeBrowserView(id).catch(() => undefined)
  if (shownId === id) shownId = ''
  const nextId = selectedId.value === id ? fallback?.id || '' : selectedId.value
  loadBrowsers(nextId)
  if (nextId) ensureBrowserChat({ browserId: nextId })
}

const acceptOpened = (state: { id: string; url: string; title?: string }) => {
  if (!state.id || !state.url) return
  if (browsers.value.length >= MAX_TABS && !browsers.value.some((item) => item.id === state.id)) return
  createAppBrowser({
    id: state.id,
    url: state.url,
    title: state.title || '',
    name: hostnameOf(state.url),
  })
  loadBrowsers(state.id)
  ensureBrowserChat({
    browserId: state.id,
    title: hostnameOf(state.url) ? `浏览 ${hostnameOf(state.url)}` : '网页助手',
  })
}

const goHome = async () => {
  const current = selected.value
  if (!current) return
  const home = browserHomeUrl()
  upsertAppBrowser({ id: current.id, name: current.name, url: home, title: '导航' })
  address.value = home
  loadBrowsers()
  beginLoadLine(current.id)
  try {
    await navigateBrowserView(current.id, home)
  } catch {
    finishLoadLine(current.id)
    await syncView()
  }
}


let syncing = false
let syncAgain = false

const syncView = async () => {
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  try {
    do {
      syncAgain = false
      await syncViewNow()
    } while (syncAgain)
  } finally {
    syncing = false
  }
}

const syncViewNow = async (opts?: { notify?: boolean }) => {
  if (!props.active) {
    shownId = ''
    await hideAllBrowserViews().catch(() => undefined)
    return
  }
  const current = selected.value
  const bounds = hostBounds(hostRef.value)
  if (!current) {
    shownId = ''
    await hideAllBrowserViews().catch(() => undefined)
    return
  }
  // 布局抖动时 host 可能短暂 <8px（开侧栏、重排、拖窗口），不要把当前 webview 藏掉。
  // 否则偶发白屏，要切标签（走 open/show）才能回来。
  if (!bounds) {
    return
  }
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
  // 原生视图已经在位：位置没变就什么都不做。尺寸没变时不要 was_resized。
  if (shownId === current.id) {
    if (shownBounds === key) return
    shownBounds = key
    const move = setBrowserBounds(current.id, bounds, false).catch(() => {
      shownId = ''
      shownBounds = ''
    })
    if (opts?.notify) await move
    return
  }
  try {
    await openBrowserView(current.id, current.url, bounds)
    shownId = current.id
    shownBounds = key
    await applyNativeZoom(current.id, current.zoom)
  } catch (error) {
    const text = String(error || '')
    if (/already exists/i.test(text)) {
      shownId = current.id
      shownBounds = key
      await setBrowserBounds(current.id, bounds).catch(() => undefined)
      await showBrowserView(current.id).catch(() => undefined)
      return
    }
    shownId = ''
    console.error('[browser]', error)
  }
}

const alignBrowserHole = async () => {
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  try {
    do {
      syncAgain = false
      await syncViewNow({ notify: true })
    } while (syncAgain)
  } finally {
    syncing = false
  }
}

const updateBounds = () => {
  if (boundsRaf) return
  // 只对齐洞口位置。网页宽高由原生 ZeCefHoleView 在尺寸变化时立刻 was_resized，不要在这里防抖。
  boundsRaf = window.requestAnimationFrame(() => {
    boundsRaf = 0
    void syncView()
  })
}

const goBack = () => {
  const current = selected.value
  if (!current) return
  beginLoadLine(current.id)
  void goBackBrowserView(current.id).catch(() => finishLoadLine(current.id))
}

const goForward = () => {
  const current = selected.value
  if (!current) return
  beginLoadLine(current.id)
  void goForwardBrowserView(current.id).catch(() => finishLoadLine(current.id))
}

const reload = () => {
  const current = selected.value
  if (!current) return
  beginLoadLine(current.id)
  void reloadBrowserView(current.id).catch(() => finishLoadLine(current.id))
}

const applyNativeZoom = async (id: string, value: number) => {
  try {
    await setBrowserZoom(id, value)
  } catch {
    // 视图还没挂上时忽略，下次 syncView 会再套一次
  }
}

const setZoom = async (value: number) => {
  const current = selected.value
  if (!current) return
  const next = clampBrowserZoom(value)
  patchAppBrowser(current.id, { zoom: next })
  loadBrowsers()
  await applyNativeZoom(current.id, next)
}

const zoomIn = () => {
  void setZoom(zoom.value + BROWSER_ZOOM_STEP)
}

const zoomOut = () => {
  void setZoom(zoom.value - BROWSER_ZOOM_STEP)
}

const resetZoom = () => {
  void setZoom(1)
}

const bindHost = () => {
  resizeObserver?.disconnect()
  if (!hostRef.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    void updateBounds()
  })
  resizeObserver.observe(hostRef.value)
}

watch(
  () => props.active,
  async (active) => {
    if (active) {
      await nextTick()
      bindHost()
      await syncView()
    } else {
      stopSiteClock(selectedId.value)
      if (selectedId.value) {
        stopChaoxingChapterParser(selectedId.value)
      }
      stopHomeworkBackgroundParse()
      stopHomeworkLiveSync()
      abstractionMenuOpen.value = false
      siteGraphMenuOpen.value = false
      stopWatchCourseTab()
      await hideAllBrowserViews().catch(() => undefined)
    }
  },
)

watch(
  () => parserPageKind(address.value || selected.value?.url || ''),
  () => { void refreshCurrentParse(true) },
)

watch(selectedId, async (id, prev) => {
  if (prev && prev !== id) {
    stopChaoxingChapterParser(prev)
    stopHomeworkBackgroundParse()
  }
  await nextTick()
  bindHost()
  await syncView()
  void refreshCurrentParse()
})

/** 学习页：章节 + 测验题卡都后台轮询，不依赖打开「解析」面板 */
watch(
  () => [selectedId.value, address.value] as const,
  ([id, url], prev) => {
    if (!id) return
    const href = url || selected.value?.url || ''
    const kind = parserPageKind(href)
    if (kind !== 'study') {
      if (url) stopChaoxingChapterParser(id)
      if (kind !== 'homework') stopHomeworkBackgroundParse()
      return
    }
    if (href && href !== prev?.[1]) syncChaoxingChapterUrl(id, href)
    else startChaoxingChapterParser(id)
    stopHomeworkBackgroundParse()
  },
)

watch(
  () => [selectedId.value, address.value, siteGraphMenuOpen.value] as const,
  ([id, url, graphOpen]) => {
    const href = url || selected.value?.url || ''
    if (id && (isChaoxingCourseUrl(href) || (graphOpen && /chaoxing\.com/i.test(href)))) {
      watchCourseTab(id, graphOpen)
    } else stopWatchCourseTab()
  },
)

let lastInspectUrl = ''

const homeworkCardUseful = () => {
  const card = lastHomeworkCard.value
  if (!card) return false
  if (card.works?.length || card.pending?.length || (card.pendingCount || 0) > 0) return true
  const questions = card.questions || []
  if (!questions.length) return false
  const withImages = questions.some((item) => (
    Boolean(item.images?.length)
    || (item.options || []).some((opt) => opt.image || opt.images?.length)
  ))
  if (withImages) return true
  return questions.every(questionHasContent)
}

const stopSiteClock = (id = selectedId.value) => {
  if (id) unwatchParserClock(id, 'site')
}

const refreshCurrentParse = async (force = false) => {
  const current = selected.value
  if (!current) return
  const url = address.value || current.url || ''
  stopSiteClock(current.id)
  const kind = parserPageKind(url)
  if (kind === 'study') {
    abstractionParsing.value = false
    startChaoxingChapterParser(current.id)
    stopHomeworkBackgroundParse()
    lastInspectUrl = url
    if (force) await kickParserClock(current.id)
    return
  }
  stopChaoxingChapterParser(current.id)
  if (kind === 'homework') {
    startHomeworkBackgroundParse(current.id)
    if (!force && homeworkCardUseful() && lastInspectUrl === url) {
      await startHomeworkLiveSync(current.id).catch(() => null)
      return
    }
    lastInspectUrl = url
    await kickParserClock(current.id)
    return
  }
  stopHomeworkBackgroundParse()
  stopHomeworkLiveSync()
  if (lastHomeworkCard.value) publishHomeworkCard(null)
  lastInspectUrl = ''
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopSiteClock()
    stopHomeworkBackgroundParse()
    stopHomeworkLiveSync()
  })
  lastInspectUrl = ''
  void nextTick().then(() => {
    loadBrowsers()
    if (!homeworkCardUseful()) void refreshCurrentParse(true)
  })
}

watch(abstractionMenuOpen, (open) => {
  // 面板打开只强制刷新一次；后台轮询不依赖此开关
  if (open) void refreshCurrentParse(true)
  void nextTick().then(() => alignBrowserHole())
})

watch(siteGraphMenuOpen, () => {
  void nextTick().then(() => alignBrowserHole())
})

const onAbsKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (abstractionMenuOpen.value) {
    abstractionMenuOpen.value = false
    return
  }
  if (siteGraphMenuOpen.value) siteGraphMenuOpen.value = false
}

onMounted(async () => {
  if (import.meta.env.DEV) {
    void import('../services/agent/cursorBridge').then((m) => m.startCursorBridge()).catch(() => {})
  }
  browserTabHandlers.value = { selectTab, closeTab, newTab, tabLabel }
  loadBrowsers()
  unlistenState = await listenBrowserState((state) => {
    const current = browsers.value.find((item) => item.id === state.id)
    if (!current) return
    const url = state.url || current.url
    const title = state.title
      || (isBrowserHome(url) ? '导航' : (url !== current.url ? hostnameOf(url) : current.title))
    patchAppBrowser(current.id, { url, title })
    loadBrowsers()
    const urlChanged = url !== address.value
    if (selectedId.value === state.id && url) {
      address.value = url
      setCurrentBrowserPage(current.id, url)
      syncAddressText()
    }
    if (!urlChanged) {
      // 同址切章（chapterId 变了有时仍走 state）时也保持解析器
      if (selectedId.value === state.id && parserPageKind(url) === 'study') {
        startChaoxingChapterParser(state.id)
      }
      return
    }
    void refreshCurrentParse()
  }).catch(() => null)
  unlistenOpened = await listenBrowserOpened((state) => {
    acceptOpened(state)
    void nextTick().then(() => syncView())
  }).catch(() => null)
  unlistenLoad = await listenBrowserLoad((state) => {
    if (state.phase === 'started') beginLoadLine(state.id)
    else if (state.phase === 'finished') {
      finishLoadLine(state.id)
      const href = state.url || address.value || ''
      if (selectedId.value === state.id && parserPageKind(href) === 'study') resyncChaoxingStudy(state.id, href)
    }
  }).catch(() => null)
  window.addEventListener('resize', updateBounds)
  window.addEventListener('keydown', onAbsKey)
  await nextTick()
  bindHost()
  if (props.active) {
    await syncView()
    void refreshCurrentParse()
  }
})

watch(selectedId, (id) => {
  if (id && loadingTabs.has(id)) beginLoadLine(id)
  else {
    stopLoadTick()
    loadLine.value = { visible: false, fading: false, progress: 0 }
  }
})

onUnmounted(() => {
  browserTabHandlers.value = null
  unlistenState?.()
  unlistenOpened?.()
  unlistenLoad?.()
  stopLoadTick()
  resizeObserver?.disconnect()
  if (boundsRaf) window.cancelAnimationFrame(boundsRaf)
  boundsRaf = 0
  window.removeEventListener('resize', updateBounds)
  window.removeEventListener('keydown', onAbsKey)
  stopSiteClock()
  stopHomeworkBackgroundParse()
  stopHomeworkLiveSync()
  stopWatchCourseTab()
  abstractionMenuOpen.value = false
  siteGraphMenuOpen.value = false
  void hideAllBrowserViews().catch(() => undefined)
})
</script>

<style scoped>
.browser-page {
  height: 100%;
  min-height: 0;
  display: flex;
  gap: 4px;
  overflow: hidden;
  background: var(--bg-primary, #f5f5f7);
}

.browser-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.browser-card {
  width: 320px;
  min-width: 260px;
  flex: 0 0 320px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.browser-card .pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.browser-card .pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.browser-card .header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.browser-card .header-back {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-left: -4px;
  border: 0;
  border-radius: 6px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
}

.browser-card .header-back:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  color: var(--text-primary, #2d3748);
}

.browser-card .header-back svg {
  width: 14px;
  height: 14px;
}

.browser-card .header-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.browser-card .header-crumb {
  min-width: 0;
  max-width: 9em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.browser-card .header-crumb.is-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
}

.browser-card .header-crumb.is-link:hover {
  color: var(--text-primary, #2d3748);
}

.browser-card .header-crumb.is-current {
  color: var(--text-primary, #2d3748);
  font-weight: 600;
  max-width: 6em;
}

.browser-card .header-crumb-sep {
  flex-shrink: 0;
  color: color-mix(in srgb, var(--text-secondary, #94a3b8) 80%, transparent);
  font-size: 11px;
}

.browser-card .header-ring {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.browser-card .header-ring svg {
  display: block;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.browser-card .header-ring-track,
.browser-card .header-ring-arc {
  fill: none;
  stroke-width: 2.5;
}

.browser-card .header-ring-track {
  stroke: color-mix(in srgb, var(--border-primary, #cbd5e1) 80%, transparent);
}

.browser-card .header-ring-arc {
  stroke: var(--accent-primary, #3b82f6);
  stroke-linecap: round;
}

.browser-card .header-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #64748b);
}

.browser-card :deep(.abs-panel),
.browser-card :deep(.graph-panel) {
  flex: 1;
  min-height: 0;
}

.browser-empty {
  padding: 24px 16px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.browser-chrome {
  position: relative;
  height: 40px;
  min-height: 40px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  background: var(--bg-secondary, #fff);
  border-bottom: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.chrome-load {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
}

.chrome-load.is-on {
  opacity: 1;
}

.chrome-load.is-fade {
  opacity: 0;
  transition: opacity 0.28s ease-out;
}

.chrome-load i {
  display: block;
  height: 100%;
  width: 100%;
  transform: scaleX(0);
  transform-origin: left center;
  background: #007aff;
  box-shadow: 0 0 8px rgba(0, 122, 255, 0.55);
  will-change: transform;
}

[data-theme="dark"] .chrome-load i {
  background: #0a84ff;
  box-shadow: 0 0 8px rgba(10, 132, 255, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .chrome-load.is-fade {
    transition-duration: 0.12s;
  }
}

.chrome-btn {
  box-sizing: border-box;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  overflow: visible;
  -webkit-appearance: none;
  appearance: none;
}

.chrome-btn:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.chrome-btn svg {
  display: block;
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chrome-place {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: var(--bg-tertiary, #f5f5f7);
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.chrome-place::placeholder {
  color: var(--text-secondary, #718096);
}

.chrome-zoom {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  margin-left: 2px;
}

.chrome-btn:disabled {
  opacity: 0.35;
  cursor: default;
  background: transparent;
}

.chrome-zoom-label {
  box-sizing: border-box;
  min-width: 44px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.chrome-zoom-label:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.chrome-zoom-label:active {
  transform: scale(0.97);
}

.browser-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  pointer-events: none;
}

.browser-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
