<template>
  <div class="browser-page">
    <section class="browser-main">
      <div class="browser-tabs">
        <div class="tab-list">
          <button
            v-for="item in browsers"
            :key="item.id"
            class="tab-item"
            type="button"
            :class="{ 'is-on': item.id === selectedId }"
            @click="selectTab(item.id)"
          >
            <span class="tab-title">{{ tabLabel(item) }}</span>
            <span
              class="tab-close"
              title="关闭"
              @click.stop="closeTab(item.id)"
            >×</span>
          </button>
        </div>
        <button class="tab-new" type="button" title="新标签页" @click="newTab">+</button>
      </div>
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
        <div class="chrome-place">{{ placeLabel }}</div>
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
      </div>
      <div v-if="selected" ref="hostRef" class="browser-host">
        <div v-if="errorText" class="browser-host-note">{{ errorText }}</div>
      </div>
      <div v-else class="browser-empty">正在打开浏览器</div>
    </section>
    <BrowserAgent
      :browser-id="selected?.id"
      :name="selected?.name"
      :url="selected?.url"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BrowserAgent from '../components/BrowserAgent.vue'
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
  getSelectedBrowserId,
  listenBrowserOpened,
  listenBrowserState,
  listAppBrowsers,
  navigateBrowserView,
  openBrowserView,
  reloadBrowserView,
  setSelectedBrowserId,
  patchAppBrowser,
  setBrowserBounds,
  setBrowserZoom,
  setAppAbovePage,
  removeAppBrowser,
  upsertAppBrowser,
  type AppBrowser,
} from '../services/browser/appBrowser'
import { clearBrowserChat } from '../services/agent/chat'
import { isChaoxingCourseUrl, startChaoxingChapterParser, stopChaoxingChapterParser } from '../services/chaoxing/chapters'
import {
  applyHomeworkLiveState,
  inspectChaoxingHomework,
  installHomeworkLiveSync,
  readHomeworkLiveState,
} from '../services/chaoxing/homework'
import {
  abstractionMenuOpen,
  abstractionParsing,
  isHomeworkUrl,
  lastHomeworkCard,
  setCurrentBrowserPage,
} from '../services/browser/abstractions'

const props = defineProps<{
  active?: boolean
}>()

const browsers = ref<AppBrowser[]>([])
const selectedId = ref('')
const hostRef = ref<HTMLElement | null>(null)
const address = ref('')
const errorText = ref('')

let unlistenState: (() => void) | null = null
let unlistenOpened: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
/** 已挂上原生视图的窗口，以及它当前的位置尺寸；用于跳过重复的原生调用 */
let shownId = ''
let shownBounds = ''

const selected = computed(() => browsers.value.find((item) => item.id === selectedId.value) || null)
const zoom = computed(() => clampBrowserZoom(selected.value?.zoom))
const zoomPercent = computed(() => Math.round(zoom.value * 100))
const placeLabel = computed(() => {
  if (isBrowserHome(address.value || selected.value?.url || '')) return '导航'
  return selected.value?.title || hostnameOf(address.value || selected.value?.url || '')
})

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
  if (current) {
    setSelectedBrowserId(current.id)
    address.value = current.url
    setCurrentBrowserPage(current.id, current.url)
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
  void closeBrowserView(id).catch(() => undefined)
  clearBrowserChat(id)
  if (shownId === id) shownId = ''
  loadBrowsers(selectedId.value === id ? fallback?.id || '' : selectedId.value)
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
}

const goHome = async () => {
  const current = selected.value
  if (!current) return
  const home = browserHomeUrl()
  upsertAppBrowser({ id: current.id, name: current.name, url: home, title: '导航' })
  address.value = home
  loadBrowsers()
  try {
    await navigateBrowserView(current.id, home)
  } catch {
    await syncView()
  }
}


const syncView = async () => {
  if (!props.active) {
    shownId = ''
    await hideAllBrowserViews().catch(() => undefined)
    return
  }
  const current = selected.value
  const bounds = hostBounds(hostRef.value)
  if (!current || !bounds) {
    shownId = ''
    await hideAllBrowserViews().catch(() => undefined)
    return
  }
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
  // 原生视图已经在位：位置没变就什么都不做，变了也只挪一下。
  // 重复调 browser_open 会反复 show/隐藏其他视图，让父子 webview 不停争抢鼠标光标。
  if (shownId === current.id) {
    if (shownBounds === key) return
    try {
      await setBrowserBounds(current.id, bounds)
      shownBounds = key
      return
    } catch {
      shownId = ''
    }
  }
  errorText.value = ''
  try {
    await openBrowserView(current.id, current.url, bounds)
    shownId = current.id
    shownBounds = key
    await applyNativeZoom(current.id, current.zoom)
  } catch (error) {
    shownId = ''
    errorText.value = error instanceof Error ? error.message : String(error)
  }
}

const updateBounds = async () => {
  await syncView()
}

const goBack = () => {
  const current = selected.value
  if (current) void goBackBrowserView(current.id).catch(() => undefined)
}

const goForward = () => {
  const current = selected.value
  if (current) void goForwardBrowserView(current.id).catch(() => undefined)
}

const reload = () => {
  const current = selected.value
  if (current) void reloadBrowserView(current.id).catch(() => undefined)
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
      stopParseLoop()
      abstractionMenuOpen.value = false
      document.documentElement.classList.remove('abs-over-page')
      await setAppAbovePage(false, selectedId.value).catch(() => undefined)
      await hideAllBrowserViews().catch(() => undefined)
    }
  },
)

watch(selectedId, async (id) => {
  await nextTick()
  bindHost()
  await syncView()
  const current = browsers.value.find((item) => item.id === id)
  const url = current?.url || ''
  if (current && isChaoxingCourseUrl(url)) startChaoxingChapterParser(current.id)
  if (abstractionMenuOpen.value) void refreshCurrentParse()
})

const syncAppAbovePage = async (open: boolean) => {
  document.documentElement.classList.toggle('abs-over-page', open)
  await setAppAbovePage(open, selectedId.value).catch(() => undefined)
}

let parseTimer = 0
let liveTimer = 0
let parseBusy = false
let lastInspectUrl = ''
const refreshCurrentParse = async (force = false) => {
  const current = selected.value
  if (!current || parseBusy) return
  const url = address.value || current.url || ''
  if (!isHomeworkUrl(url)) return
  const haveCard = Boolean(lastHomeworkCard.value?.questions?.length)
  if (!force && haveCard && lastInspectUrl === url) {
    await installHomeworkLiveSync(current.id).catch(() => null)
    return
  }
  parseBusy = true
  abstractionParsing.value = true
  const watchdog = window.setTimeout(() => {
    parseBusy = false
    abstractionParsing.value = false
  }, 12000)
  try {
    lastInspectUrl = url
    await inspectChaoxingHomework(current.id, { vision: false })
    await installHomeworkLiveSync(current.id).catch(() => null)
  } catch {
    // keep last card
  } finally {
    window.clearTimeout(watchdog)
    parseBusy = false
    abstractionParsing.value = false
  }
}

const refreshLiveState = async () => {
  const current = selected.value
  if (!current || !isHomeworkUrl(address.value || current.url || '')) return
  const state = await readHomeworkLiveState(current.id).catch(() => null)
  if (!state?.states?.length) {
    await installHomeworkLiveSync(current.id).catch(() => null)
    return
  }
  applyHomeworkLiveState(state)
}

const stopParseLoop = () => {
  if (parseTimer) {
    window.clearInterval(parseTimer)
    parseTimer = 0
  }
  if (liveTimer) {
    window.clearInterval(liveTimer)
    liveTimer = 0
  }
}

watch(abstractionMenuOpen, (open) => {
  stopParseLoop()
  void syncAppAbovePage(open)
  if (!open) return
  void refreshCurrentParse(true)
  liveTimer = window.setInterval(() => { void refreshLiveState() }, 400)
})

const onAbsKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && abstractionMenuOpen.value) {
    abstractionMenuOpen.value = false
  }
}

onMounted(async () => {
  loadBrowsers()
  unlistenState = await listenBrowserState((state) => {
    const current = browsers.value.find((item) => item.id === state.id)
    if (!current) return
    const url = state.url || current.url
    const title = state.title || current.title
    patchAppBrowser(current.id, { url, title })
    loadBrowsers()
    const urlChanged = url !== address.value
    if (selectedId.value === state.id && url) {
      address.value = url
      setCurrentBrowserPage(current.id, url)
    }
    if (!urlChanged) return
    if (isChaoxingCourseUrl(url)) startChaoxingChapterParser(current.id)
    else stopChaoxingChapterParser(current.id)
    if (isHomeworkUrl(url)) {
      lastInspectUrl = url
      void inspectChaoxingHomework(current.id, { vision: false })
        .then(() => installHomeworkLiveSync(current.id))
        .catch(() => null)
    }
  }).catch(() => null)
  unlistenOpened = await listenBrowserOpened((state) => {
    acceptOpened(state)
    void nextTick().then(() => syncView())
  }).catch(() => null)
  window.addEventListener('resize', updateBounds)
  window.addEventListener('keydown', onAbsKey)
  await nextTick()
  bindHost()
  if (props.active) await syncView()
  for (const item of browsers.value) {
    if (isChaoxingCourseUrl(item.url)) startChaoxingChapterParser(item.id)
  }
})

onUnmounted(() => {
  unlistenState?.()
  unlistenOpened?.()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateBounds)
  window.removeEventListener('keydown', onAbsKey)
  stopParseLoop()
  abstractionMenuOpen.value = false
  document.documentElement.classList.remove('abs-over-page')
  void setAppAbovePage(false, selectedId.value).catch(() => undefined)
  void hideAllBrowserViews().catch(() => undefined)
})
</script>

<style scoped>
.browser-page {
  height: 100%;
  display: flex;
  gap: 4px;
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

.browser-tabs {
  height: 34px;
  min-height: 34px;
  padding: 4px 8px 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
  background: var(--bg-primary, #f5f5f7);
}

.tab-list {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
}

.tab-item {
  max-width: 180px;
  min-width: 72px;
  height: 28px;
  padding: 0 6px 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.tab-item:hover {
  background: color-mix(in srgb, var(--bg-secondary, #fff) 70%, transparent);
  color: var(--text-primary, #2d3748);
}

.tab-item.is-on {
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #2d3748);
}

.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  text-align: left;
}

.tab-close {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-secondary, #94a3b8);
}

.tab-close:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  color: var(--text-primary, #2d3748);
}

.tab-new {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  margin-bottom: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.tab-new:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, #2d3748);
}

.browser-empty,
.browser-host-note {
  padding: 24px 16px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.browser-chrome {
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
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--bg-tertiary, #f5f5f7);
  font-size: 12px;
  color: var(--text-secondary, #718096);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
}

.browser-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
