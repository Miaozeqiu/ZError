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
        <div class="header-title">{{ abstractionPanelTitle }}</div>
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
  listenBrowserState,
  listAppBrowsers,
  navigateBrowserView,
  openBrowserView,
  reloadBrowserView,
  setSelectedBrowserId,
  patchAppBrowser,
  setBrowserBounds,
  setBrowserZoom,
  removeAppBrowser,
  upsertAppBrowser,
  type AppBrowser,
} from '../services/browser/appBrowser'
import { clearBrowserChat } from '../services/agent/chat'
import {
  inspectChaoxingHomework,
  startHomeworkLiveSync,
  stopHomeworkLiveSync,
} from '../services/chaoxing/homework'
import {
  startChaoxingChapterParser,
  stopChaoxingChapterParser,
} from '../services/chaoxing/browser/chapters'
import {
  abstractionMenuOpen,
  abstractionParsing,
  abstractionPanelTitle,
  isHomeworkUrl,
  isStudyUrl,
  lastHomeworkCard,
  publishHomeworkCard,
  setCurrentBrowserPage,
} from '../services/browser/abstractions'
import { siteGraphMenuOpen } from '../services/browser/siteGraph'

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
let boundsSettle = 0
/** 已挂上原生视图的窗口，以及它当前的位置尺寸；用于跳过重复的原生调用 */
let shownId = ''
let shownBounds = ''

const selected = computed(() => browsers.value.find((item) => item.id === selectedId.value) || null)
const zoom = computed(() => clampBrowserZoom(selected.value?.zoom))
const zoomPercent = computed(() => Math.round(zoom.value * 100))
const addressText = ref('')
const addressFocused = ref(false)

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
  try {
    await navigateBrowserView(current.id, next)
  } catch {
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

const syncViewNow = async () => {
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
  // 切走的标签只隐藏，满 10 分钟没再打开才休眠回收。
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
      return
    }
    shownId = ''
    console.error('[browser]', error)
  }
}

const flushBounds = () => {
  boundsRaf = 0
  void syncView()
}

const updateBounds = () => {
  if (!boundsRaf) {
    boundsRaf = window.requestAnimationFrame(flushBounds)
  }
  window.clearTimeout(boundsSettle)
  boundsSettle = window.setTimeout(() => {
    boundsSettle = 0
    void syncView()
  }, 140)
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
      if (selectedId.value) stopChaoxingChapterParser(selectedId.value)
      stopHomeworkLiveSync()
      abstractionMenuOpen.value = false
      siteGraphMenuOpen.value = false
      await hideAllBrowserViews().catch(() => undefined)
    }
  },
)

watch(selectedId, async (id, prev) => {
  if (prev && prev !== id) stopChaoxingChapterParser(prev)
  await nextTick()
  bindHost()
  await syncView()
  void refreshCurrentParse()
})

/** 学习页：解析器后台轮询，不依赖打开「解析」面板 */
watch(
  () => [selectedId.value, address.value] as const,
  ([id, url]) => {
    if (!id) return
    if (isStudyUrl(url || '')) startChaoxingChapterParser(id)
    else stopChaoxingChapterParser(id)
  },
)

let parseTimer = 0
let liveTimer = 0
let parseBusy = false
let lastInspectUrl = ''

const homeworkCardUseful = () => {
  const card = lastHomeworkCard.value
  if (!card) return false
  return Boolean(
    card.questions?.length
    || card.works?.length
    || card.pending?.length
    || (card.questionCount || 0) > 0
    || (card.pendingCount || 0) > 0,
  )
}

const ensureHomeworkParseLoop = () => {
  if (parseTimer) return
  parseTimer = window.setInterval(() => {
    void refreshCurrentParse(false)
  }, 2000)
}

const refreshCurrentParse = async (force = false) => {
  const current = selected.value
  if (!current || parseBusy) return
  const url = address.value || current.url || ''
  if (isStudyUrl(url)) {
    stopParseLoop()
    stopHomeworkLiveSync()
    if (lastHomeworkCard.value) publishHomeworkCard(null)
    startChaoxingChapterParser(current.id)
    lastInspectUrl = url
    return
  }
  stopChaoxingChapterParser(current.id)
  if (!isHomeworkUrl(url)) {
    stopParseLoop()
    stopHomeworkLiveSync()
    if (lastHomeworkCard.value) publishHomeworkCard(null)
    lastInspectUrl = ''
    return
  }
  ensureHomeworkParseLoop()
  if (!force && homeworkCardUseful() && lastInspectUrl === url) {
    await startHomeworkLiveSync(current.id).catch(() => null)
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
    await startHomeworkLiveSync(current.id).catch(() => null)
  } catch {
    // keep last card
  } finally {
    window.clearTimeout(watchdog)
    parseBusy = false
    abstractionParsing.value = false
  }
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
  if (open) void refreshCurrentParse(true)
  // 侧栏显隐会挤动 webview 区域，立刻重算 bounds，避免原生视图盖住面板导致点不了
  void nextTick().then(() => updateBounds())
})

watch(siteGraphMenuOpen, () => {
  void nextTick().then(() => updateBounds())
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
  browserTabHandlers.value = { selectTab, closeTab, newTab, tabLabel }
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
      syncAddressText()
    }
    if (!urlChanged) {
      // 同址切章（chapterId 变了有时仍走 state）时也保持解析器
      if (selectedId.value === state.id && isStudyUrl(url)) {
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
  window.addEventListener('resize', updateBounds)
  window.addEventListener('keydown', onAbsKey)
  await nextTick()
  bindHost()
  if (props.active) {
    await syncView()
    void refreshCurrentParse()
  }
})

onUnmounted(() => {
  browserTabHandlers.value = null
  unlistenState?.()
  unlistenOpened?.()
  resizeObserver?.disconnect()
  if (boundsRaf) window.cancelAnimationFrame(boundsRaf)
  boundsRaf = 0
  window.clearTimeout(boundsSettle)
  boundsSettle = 0
  window.removeEventListener('resize', updateBounds)
  window.removeEventListener('keydown', onAbsKey)
  stopParseLoop()
  stopHomeworkLiveSync()
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
