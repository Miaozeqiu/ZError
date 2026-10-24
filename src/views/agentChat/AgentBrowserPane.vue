<template>
  <Teleport to="body" :disabled="!agentBrowserExpanded">
  <Transition name="browser-pane">
  <aside v-show="active && !obscured" class="agent-browser-pane" :class="{ 'is-expanded': agentBrowserExpanded, 'is-macos': isMacOS }" :style="browserFrameStyle" aria-label="浏览器工作区">
    <div class="browser-pane-inner">
    <header class="browser-pane-head" :data-tauri-drag-region="agentBrowserExpanded ? '' : undefined">
      <span class="browser-pane-title"><Icon icon="lucide:monitor" width="15" height="15" /><span>{{ agentBrowserExpanded ? currentAgentBrowser?.title || '浏览器' : '浏览器' }}</span></span>
      <button v-if="agentBrowserExpanded" class="browser-icon-button browser-chrome-toggle" type="button" title="显示或隐藏浏览器工具栏" aria-label="浏览器工具栏" :aria-expanded="showBrowserChrome" @click="showBrowserChrome = !showBrowserChrome"><Icon icon="lucide:globe" width="15" height="15" /></button>
      <button ref="toggleRef" class="browser-icon-button" type="button" :title="agentBrowserExpanded ? '收起浏览器' : '放大浏览器'" :aria-label="agentBrowserExpanded ? '收起浏览器' : '放大浏览器'" :aria-expanded="agentBrowserExpanded" aria-controls="agent-browser-screen" @click="toggleBrowser">
        <Icon :icon="agentBrowserExpanded ? 'lucide:minimize-2' : 'lucide:maximize-2'" width="15" height="15" />
      </button>
    </header>

    <button v-if="!agentBrowserExpanded" class="browser-preview" type="button" aria-label="放大浏览器" @click="expandBrowser">
      <span class="browser-preview-screen">
        <img v-if="preview && previewId === currentAgentBrowser?.id" :src="preview" alt="当前网页预览" />
        <span v-else class="browser-preview-placeholder">
          <Icon :icon="currentAgentBrowser ? 'lucide:globe' : 'lucide:monitor'" width="28" height="28" />
          <span>{{ currentAgentBrowser ? '点击查看网页' : '浏览器待命' }}</span>
        </span>
        <span class="browser-preview-expand"><Icon icon="lucide:maximize-2" width="15" height="15" /></span>
      </span>
      <span class="browser-preview-caption" :title="currentAgentBrowser?.title || currentAgentBrowser?.url">
        <span class="browser-status-dot" :class="{ 'is-working': working }" />
        <span>{{ currentAgentBrowser?.title || (currentAgentBrowser ? hostnameOf(currentAgentBrowser.url) : '点击打开浏览器') }}</span>
      </span>
      <span class="browser-preview-hint">{{ userInControl ? '你正在操作 · 当前对话已停止' : working ? 'Agent 正在操作网页' : '点击放大，可随时收起' }}</span>
    </button>

    <AgentTaskHistory v-if="!agentBrowserExpanded" />

    <div v-show="agentBrowserExpanded" id="agent-browser-screen" class="browser-screen" @animationend="finishOpeningMotion">
      <div v-show="showBrowserChrome" class="browser-tabs" role="tablist" aria-label="浏览器标签页" @pointerdown.capture="takeControlFromUi">
        <div v-for="tab in currentAgentBrowsers" :key="tab.id" class="browser-tab" :class="{ 'is-selected': tab.id === currentAgentBrowser?.id }">
          <button type="button" role="tab" :aria-selected="tab.id === currentAgentBrowser?.id" :title="tab.title || tab.url" @click="selectTab(tab.id)">{{ tab.title || hostnameOf(tab.url) }}</button>
          <button class="browser-tab-close" type="button" :aria-label="`关闭 ${tab.title || '标签页'}`" @click="closeTab(tab.id)"><Icon icon="lucide:x" width="12" height="12" /></button>
        </div>
        <button class="browser-icon-button" type="button" title="新建标签页" aria-label="新建标签页" :disabled="currentAgentBrowsers.length >= 16" @click="newTab"><Icon icon="lucide:plus" width="15" height="15" /></button>
      </div>
      <form v-show="showBrowserChrome" class="browser-toolbar" @submit.prevent="navigate" @pointerdown.capture="takeControlFromUi">
        <button class="browser-icon-button" type="button" title="后退" aria-label="后退" :disabled="!currentAgentBrowser || busy" @click="runNavigation('back')"><Icon icon="lucide:chevron-left" width="15" height="15" /></button>
        <button class="browser-icon-button" type="button" title="前进" aria-label="前进" :disabled="!currentAgentBrowser || busy" @click="runNavigation('forward')"><Icon icon="lucide:chevron-right" width="15" height="15" /></button>
        <button class="browser-icon-button" type="button" title="刷新" aria-label="刷新" :disabled="!currentAgentBrowser || busy" @click="runNavigation('reload')"><Icon icon="lucide:refresh-cw" width="14" height="14" /></button>
        <input v-model="address" class="browser-address" aria-label="网址" placeholder="输入网址，按回车打开" spellcheck="false" autocomplete="off" @focus="focusAddress" @blur="blurAddress" @keydown.esc="blurAddress" />
        <button class="browser-icon-button" type="button" :title="muted ? '开启声音' : '关闭声音'" :aria-label="muted ? '开启声音' : '关闭声音'" :aria-pressed="muted" :disabled="!currentAgentBrowser || audioBusy" @click="toggleAudio"><Icon :icon="muted ? 'lucide:volume-x' : 'lucide:volume-2'" width="15" height="15" /></button>
        <button class="browser-zoom" type="button" :title="`当前缩放 ${zoomPercent}%，点击切换`" @click="cycleZoom">{{ zoomPercent }}%</button>
      </form>
      <div v-if="loading" class="browser-loading" role="progressbar" aria-label="网页加载中" />
      <div ref="hostRef" class="browser-host" @pointerdown.capture="takeControlFromUi" @keydown.capture="takeControlFromUi" @wheel.passive="takeControlFromUi"><img v-if="openingMotion && preview && previewId === currentAgentBrowser?.id" class="browser-opening-preview" :src="preview" alt="当前网页预览" /><span v-if="busy" class="browser-opening">正在打开浏览器…</span></div>
    </div>
    <div v-if="agentBrowserExpanded" class="browser-control-dock" role="group" aria-label="浏览器操作权">
      <div class="browser-control-pill" :class="{ 'is-controlling': displayedUserControl }">
        <template v-if="displayedUserControl">
          <span class="browser-control-status" role="status"><Icon icon="lucide:square-mouse-pointer" width="18" height="18" />你正在控制</span>
          <button class="browser-stop-control" type="button" :disabled="controlBusy" @click="changeControl">停止</button>
        </template>
        <template v-else>
          <span class="browser-view-button"><Icon icon="lucide:eye" width="14" height="14" />仅观看</span>
          <button class="browser-claim-button" type="button" :disabled="controlBusy || !currentAgentBrowser" @click="changeControl">取得控制权</button>
        </template>
      </div>
    </div>
    <p v-if="error" class="browser-error" role="alert">{{ error }} <button type="button" @click="retry">重试</button></p>
    <BrowserAgentWatchBar :browser-id="currentAgentBrowser?.id" />
    </div>
  </aside>
  </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import BrowserAgentWatchBar from '../../components/browser/BrowserAgentWatchBar.vue'
import AgentTaskHistory from './AgentTaskHistory.vue'
import { activeChat, activeChatId, createChat, patchSession } from '../../services/agent/chatStore'
import {
  agentBrowserExpanded, bindChatBrowser, browserIdsForChat, currentAgentBrowser, currentAgentBrowsers,
  ensureAgentBrowser, refreshAgentBrowsers, startAgentBrowserWorkspace,
} from '../../services/agent/agentBrowser'
import {
  browserAudioMuted, browserHomeUrl, closeBrowserView, createAppBrowser, goBackBrowserView,
  goForwardBrowserView, hideAllBrowserViews, hostBounds, hostnameOf, isBrowserHome, listenBrowserLoad,
  navigateBrowserView, normalizeBrowserUrl, patchAppBrowser, reloadBrowserView, removeAppBrowser,
  screenshotBrowserView, setBrowserAudioMuted, setBrowserBounds, setBrowserZoom, showBrowserView,
} from '../../services/browser/appBrowser'
import { isTauriEnvironment } from '../../services/app/environmentDetector'
import { setBrowserControl, userControlsBrowser } from '../../services/browser/control'

const props = withDefaults(defineProps<{ active?: boolean; obscured?: boolean }>(), { active: true, obscured: false })
const isMacOS = /mac/i.test(navigator.platform || navigator.userAgent)
const browserInsets = { paddingRatio: 0.07, paddingMin: 16, paddingMax: 144, compactBreakpoint: 760, compactPadding: 12 }
const browserFrameStyle = {
  '--browser-wide-inset': `clamp(${browserInsets.paddingMin}px, ${browserInsets.paddingRatio * 100}vw, ${browserInsets.paddingMax}px)`,
  '--browser-compact-inset': `${browserInsets.compactPadding}px`,
}
const hostRef = ref<HTMLElement | null>(null)
const toggleRef = ref<HTMLButtonElement | null>(null)
const preview = ref('')
const previewId = ref('')
const address = ref('')
const addressFocused = ref(false)
const error = ref('')
const busy = ref(false)
const audioBusy = ref(false)
const loading = ref(false)
const showBrowserChrome = ref(false)
const controlBusy = ref(false)
const userInControl = computed(() => userControlsBrowser(activeChatId.value || ''))
// 按钮立即显示目标状态；实际操作权仍由原生切换和页面同步完成后确认。
const controlTarget = ref<{ sessionId: string; owner: 'agent' | 'user' } | null>(null)
const displayedUserControl = computed(() => controlTarget.value?.sessionId === activeChatId.value
  ? controlTarget.value.owner === 'user' : userInControl.value)
const openingMotion = ref(false)
const visible = computed(() => props.active && agentBrowserExpanded.value && !props.obscured && !openingMotion.value)
const muted = computed(() => Boolean(browserAudioMuted.value[currentAgentBrowser.value?.id || '']))
const zoomPercent = computed(() => Math.round((currentAgentBrowser.value?.zoom || 1) * 100))
const working = computed(() => Boolean(activeChat.value?.messages.some(message => message.status === 'streaming'
  && message.steps.some(step => step.name.startsWith('browser_') && step.status === 'running'))))
let resizeObserver: ResizeObserver | undefined
let unlistenLoad: (() => void) | undefined
let previewTimer = 0
let boundsRaf = 0
let syncFlight: Promise<void> | undefined
let syncAgain = false
let disposed = false
let capturing = false
let shownKey = ''
let shownId = ''
let takeFlight: Promise<void> | undefined
let openingTimer = 0

const finishOpeningMotion = (event?: AnimationEvent) => {
  if (event && (event.target !== event.currentTarget || !event.animationName.startsWith('browser-screen-open'))) return
  window.clearTimeout(openingTimer)
  openingMotion.value = false
}
watch(agentBrowserExpanded, expanded => {
  window.clearTimeout(openingTimer)
  openingMotion.value = expanded && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // The native CEF layer cannot follow CSS transforms. Show it once the host
  // settles; the preview remains visible during the compositor animation.
  if (openingMotion.value) openingTimer = window.setTimeout(finishOpeningMotion, 300)
}, { flush: 'sync', immediate: true })

const showError = (value: unknown) => { error.value = value instanceof Error ? value.message : String(value) }
const requireSession = () => activeChatId.value || createChat().id
const takeControl = async () => {
  if (userInControl.value) return takeFlight
  if (takeFlight) return takeFlight
  const sessionId = requireSession()
  const currentId = currentAgentBrowser.value?.id
  takeFlight = (async () => {
    const id = currentId || await ensureAgentBrowser(sessionId)
    await setBrowserControl(id, sessionId, 'user')
  })().finally(() => { takeFlight = undefined })
  return takeFlight
}
const takeControlFromUi = () => { void takeControl().catch(showError) }
const changeControl = async () => {
  if (controlBusy.value) return
  const returning = userInControl.value && !!currentAgentBrowser.value
  controlTarget.value = { sessionId: requireSession(), owner: returning ? 'agent' : 'user' }
  controlBusy.value = true
  try {
    if (returning && currentAgentBrowser.value) {
      await setBrowserControl(currentAgentBrowser.value.id, requireSession(), 'agent')
    } else await takeControl()
    error.value = ''
  } catch (value) { showError(value) }
  finally { controlTarget.value = null; controlBusy.value = false }
}
const selectTab = async (id: string) => {
  try { await takeControl(); bindChatBrowser(requireSession(), id) } catch (value) { showError(value) }
}
const newTab = async () => {
  if (currentAgentBrowsers.value.length >= 16) return
  try {
    await takeControl()
    const tab = createAppBrowser({ url: browserHomeUrl(), title: '导航' })
    bindChatBrowser(requireSession(), tab.id)
  } catch (value) { showError(value) }
}
const closeTab = async (id: string) => {
  const session = activeChat.value
  if (!session) return
  try {
    await takeControl()
    await closeBrowserView(id)
    removeAppBrowser(id)
    patchSession(session.id, current => {
      const ids = browserIdsForChat(current).filter(item => item !== id)
      return { ...current, browserIds: ids, browserId: current.browserId === id ? ids.at(-1) : current.browserId }
    })
    refreshAgentBrowsers()
    if (!currentAgentBrowsers.value.length) newTab()
  } catch (value) { showError(value) }
}
const syncAddress = () => {
  if (!addressFocused.value) address.value = isBrowserHome(currentAgentBrowser.value?.url || '') ? '' : currentAgentBrowser.value?.url || ''
}
const blurAddress = () => { addressFocused.value = false; syncAddress() }
const focusAddress = () => { addressFocused.value = true; takeControlFromUi() }
const navigate = async () => {
  const url = normalizeBrowserUrl(address.value || browserHomeUrl())
  try {
    await takeControl()
    const id = await ensureAgentBrowser(requireSession())
    await navigateBrowserView(id, url, true)
    patchAppBrowser(id, { url, title: hostnameOf(url) })
    refreshAgentBrowsers()
    blurAddress()
    error.value = ''
  } catch (value) { showError(value) }
}
const runNavigation = async (kind: 'reload' | 'back' | 'forward') => {
  const id = currentAgentBrowser.value?.id
  if (!id) return
  try {
    await takeControl()
    await ({ reload: reloadBrowserView, back: goBackBrowserView, forward: goForwardBrowserView })[kind](id, true)
    error.value = ''
  } catch (value) { showError(value) }
}
const toggleAudio = async () => {
  const id = currentAgentBrowser.value?.id
  if (!id || audioBusy.value) return
  audioBusy.value = true
  try { await takeControl(); await setBrowserAudioMuted(id, !muted.value); error.value = '' } catch (value) { showError(value) }
  finally { audioBusy.value = false }
}
const cycleZoom = async () => {
  const tab = currentAgentBrowser.value
  if (!tab) return
  const zoom = tab.zoom >= 1.5 ? 0.75 : tab.zoom < 1 ? 1 : tab.zoom < 1.25 ? 1.25 : 1.5
  try { await takeControl(); await setBrowserZoom(tab.id, zoom); patchAppBrowser(tab.id, { zoom }); refreshAgentBrowsers() } catch (value) { showError(value) }
}
const expandBrowser = async () => {
  agentBrowserExpanded.value = true
  if (!isTauriEnvironment()) { error.value = '请在桌面端使用浏览器'; return }
  requireSession()
  await syncView()
}
const capturePreview = async () => {
  const id = currentAgentBrowser.value?.id
  if (!id || disposed || !props.active || capturing || !isTauriEnvironment()) return
  capturing = true
  try {
    const shot = await screenshotBrowserView(id)
    if (!disposed && currentAgentBrowser.value?.id === id) { preview.value = shot.image; previewId.value = id }
  } catch { /* 预览失败不干扰工具与手动操作，下次动作后重试。 */ }
  finally { capturing = false }
}
const collapseBrowser = () => {
  agentBrowserExpanded.value = false
  void capturePreview()
  void nextTick(() => toggleRef.value?.focus())
}
const toggleBrowser = () => { if (agentBrowserExpanded.value) collapseBrowser(); else void expandBrowser() }
const retry = () => { error.value = ''; void syncView() }

// 原生窗口不能跟随 CSS transform；等待实际布局后，仅同步洞口，不改变网页舞台尺寸。
const syncView = () => {
  syncAgain = true
  if (syncFlight) return syncFlight
  syncFlight = (async () => {
    do {
      syncAgain = false
      if (disposed) break
      if (!visible.value) {
        shownKey = ''
        shownId = ''
        await hideAllBrowserViews().catch(() => undefined)
        continue
      }
      if (!isTauriEnvironment()) { error.value = '请在桌面端使用浏览器'; continue }
      const sessionId = requireSession()
      const initializing = shownId !== currentAgentBrowser.value?.id
      if (initializing) busy.value = true
      try {
        if (shownId && shownId !== currentAgentBrowser.value?.id) {
          await hideAllBrowserViews()
          shownId = ''
          shownKey = ''
        }
        const id = shownId || await ensureAgentBrowser(sessionId)
        if (initializing) await nextTick()
        if (disposed || !visible.value || activeChatId.value !== sessionId || currentAgentBrowser.value?.id !== id) { syncAgain = true; continue }
        const bounds = hostBounds(hostRef.value)
        if (!bounds) continue
        // 与展开样式的 clamp(16px, 7vw, 144px) 和 760px 窄窗规则对应。
        bounds.layout = {
          viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
          ...browserInsets,
        }
        const key = `${id}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}:${window.innerWidth},${window.innerHeight}`
        if (key !== shownKey) {
          await setBrowserBounds(id, bounds)
          if (disposed || !visible.value || activeChatId.value !== sessionId || currentAgentBrowser.value?.id !== id) { syncAgain = true; continue }
          // 位置更新不能反复 show/提升原生层级，也不能重新打开标签页。
          if (shownId !== id) await showBrowserView(id)
          shownId = id
          shownKey = key
          // 用户若在等待原生调用时收起或切换了对话，马上隐藏，禁止旧任务晚到后重新显示。
          if (!visible.value || activeChatId.value !== sessionId || currentAgentBrowser.value?.id !== id) syncAgain = true
        }
        error.value = ''
      } catch (value) { showError(value) }
      finally { if (initializing) busy.value = false }
    } while (syncAgain)
  })().finally(() => { syncFlight = undefined })
  return syncFlight
}
const updateBounds = () => {
  if (boundsRaf) return
  boundsRaf = window.requestAnimationFrame(() => { boundsRaf = 0; void syncView() })
}
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && visible.value && !(event.target instanceof HTMLInputElement)) collapseBrowser()
}
watch([visible, () => currentAgentBrowser.value?.id, activeChatId], () => { shownKey = ''; error.value = ''; void nextTick(syncView) })
watch(() => currentAgentBrowser.value?.url, syncAddress, { immediate: true })
watch(() => currentAgentBrowser.value?.id, () => { preview.value = ''; previewId.value = ''; addressFocused.value = false; syncAddress(); void capturePreview() })
watch(working, (value) => { if (!value && !agentBrowserExpanded.value) void capturePreview() })

onMounted(async () => {
  await startAgentBrowserWorkspace()
  if (disposed) return
  if (import.meta.env.DEV) void import('../../services/agent/cursorBridge').then(m => m.startCursorBridge()).catch(() => undefined)
  if (isTauriEnvironment()) {
    const off = await listenBrowserLoad(state => {
      if (state.id !== currentAgentBrowser.value?.id) return
      loading.value = state.phase === 'started'
      if (!loading.value && !agentBrowserExpanded.value) void capturePreview()
    }).catch(() => undefined)
    if (disposed) { off?.(); return }
    unlistenLoad = off
  }
  resizeObserver = new ResizeObserver(() => { void syncView() })
  if (hostRef.value) resizeObserver.observe(hostRef.value)
  window.addEventListener('resize', updateBounds)
  window.addEventListener('keydown', onKey)
  previewTimer = window.setInterval(() => { if (working.value && !agentBrowserExpanded.value) void capturePreview() }, 5000)
  void capturePreview()
  void syncView()
})
onUnmounted(() => {
  disposed = true
  window.clearTimeout(openingTimer)
  unlistenLoad?.()
  resizeObserver?.disconnect()
  window.clearInterval(previewTimer)
  window.cancelAnimationFrame(boundsRaf)
  window.removeEventListener('resize', updateBounds)
  window.removeEventListener('keydown', onKey)
  void hideAllBrowserViews().catch(() => undefined)
})
</script>

<style scoped>
.agent-browser-pane { --browser-pane-width: 252px; flex: 0 0 auto; width: var(--browser-pane-width); min-width: 0; display: flex; flex-direction: column; align-self: stretch; overflow: hidden; background: var(--bg-secondary, #fff); color: var(--text-primary, #2d3748); box-sizing: border-box; }
.browser-pane-inner { display: flex; flex-direction: column; flex: 1; min-height: 0; width: var(--browser-pane-width); padding: 0 14px; border-left: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent); box-sizing: border-box; }
.is-expanded .browser-pane-inner { width: 100%; padding: 0; border: 0; }
.browser-pane-enter-active:not(.is-expanded), .browser-pane-leave-active:not(.is-expanded) { transition: width 280ms cubic-bezier(0.32, 0.72, 0, 1); }
.browser-pane-enter-active:not(.is-expanded) .browser-pane-inner, .browser-pane-leave-active:not(.is-expanded) .browser-pane-inner { transition: opacity 200ms ease, transform 280ms cubic-bezier(0.32, 0.72, 0, 1); }
.browser-pane-enter-from:not(.is-expanded), .browser-pane-leave-to:not(.is-expanded) { width: 0; }
.browser-pane-enter-from:not(.is-expanded) .browser-pane-inner, .browser-pane-leave-to:not(.is-expanded) .browser-pane-inner { opacity: 0; transform: translateX(18px); }
@keyframes browser-screen-open { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
.is-expanded .browser-screen { animation: browser-screen-open 280ms cubic-bezier(0.32, 0.72, 0, 1); }
.browser-opening-preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.agent-browser-pane.is-expanded { position: fixed; inset: 0; z-index: 10000; width: 100vw; height: 100dvh; min-width: 0; padding: 44px var(--browser-wide-inset) 72px; border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--bg-secondary, #fff) 60%, transparent); -webkit-backdrop-filter: blur(24px) saturate(140%); backdrop-filter: blur(24px) saturate(140%); color: var(--text-primary, #2d3748); }
.browser-pane-head { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
.is-expanded .browser-pane-head { position: absolute; top: 0; left: 0; right: 0; height: 42px; padding: 0 16px; box-sizing: border-box; user-select: none; }
.is-expanded.is-macos .browser-pane-head { padding-left: 96px; }
.is-expanded .browser-pane-title { min-width: 0; max-width: min(65vw, 720px); color: var(--text-secondary, #718096); font-size: 12px; pointer-events: none; }
.is-expanded .browser-pane-title > svg { flex-shrink: 0; }
.is-expanded .browser-pane-title > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.browser-chrome-toggle { margin-left: auto; }
.is-expanded .browser-pane-head .browser-icon-button { color: var(--text-secondary, #718096); }
.is-expanded .browser-pane-head .browser-icon-button:hover:not(:disabled) { background: var(--bg-tertiary, #eef0f3); color: var(--text-primary, #2d3748); }
.browser-pane-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 550; color: var(--text-secondary, #718096); }
.browser-control-dock { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 7px; white-space: nowrap; }
.browser-control-pill { display: flex; align-items: center; gap: 2px; padding: 4px; border: 1px solid #dedede; border-radius: 999px; background: #fff; box-shadow: 0 3px 15px #0004; }
.browser-control-pill button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; padding: 4px 11px; border: none; border-radius: 999px; font-size: 12px; font-weight: 500; cursor: pointer; }
.browser-view-button { display: flex; align-items: center; gap: 6px; padding: 4px 11px; color: #666; font-size: 12px; font-weight: 500; }
.browser-claim-button { color: #fff; background: #111; }
.browser-control-pill.is-controlling { gap: 8px; padding: 5px; border-color: #e8e8e8; box-shadow: 0 3px 15px #0000001a; }
.browser-control-status { display: inline-flex; align-items: center; gap: 9px; padding: 0 8px 0 10px; color: #111; font-size: 14px; font-weight: 550; line-height: 30px; }
.browser-control-status > svg { flex-shrink: 0; }
.browser-control-pill .browser-stop-control { min-height: 30px; padding: 4px 12px; color: #111; background: #f0f0f0; font-size: 14px; }
.browser-stop-control:hover:not(:disabled) { background: #e5e5e5; }
.browser-control-pill button:disabled { cursor: default; }
.browser-control-pill button:active:not(:disabled) { transform: scale(.97); }
.browser-icon-button { width: 28px; height: 28px; padding: 0; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 6px; color: var(--text-secondary, #718096); background: transparent; cursor: pointer; transition: background 140ms ease, transform 140ms cubic-bezier(.23, 1, .32, 1); }
.browser-icon-button:active { transform: scale(.96); }
.browser-icon-button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary, #2563eb); outline-offset: 2px; }
.browser-preview { display: flex; flex-shrink: 0; flex-direction: column; gap: 9px; padding: 0; border: none; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.browser-preview-screen { position: relative; width: 100%; aspect-ratio: 16 / 10; display: grid; place-items: center; overflow: hidden; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent); background: var(--bg-tertiary, #f1f2f4); box-shadow: 0 2px 7px #00000005; transition: box-shadow 160ms ease; }
.browser-preview-screen img { width: 100%; height: 100%; object-fit: contain; }
.browser-preview-placeholder { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-secondary, #718096); font-size: 12px; }
.browser-preview-expand { position: absolute; right: 8px; bottom: 8px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: var(--bg-secondary, #fff); color: var(--text-secondary, #718096); opacity: 0; transition: opacity 140ms ease; }
.browser-preview:focus-visible .browser-preview-expand { opacity: 1; }
.browser-preview-caption { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; font-size: 12px; }
.browser-preview-caption > span:last-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.browser-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary, #718096); opacity: .4; flex: 0 0 auto; }
.browser-status-dot.is-working { background: var(--color-primary, #2563eb); opacity: 1; }
.browser-preview-hint { margin-left: 13px; color: var(--text-secondary, #718096); font-size: 11px; }
.browser-screen { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.is-expanded .browser-screen { border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 65%, transparent); border-radius: 12px; overflow: hidden; background: var(--bg-secondary, #fff); box-shadow: 0 12px 40px #00000020; }
.is-expanded .browser-host { border-radius: 11px; }
.is-expanded .browser-toolbar { background: var(--bg-secondary, #fff); }
.is-expanded :deep(.watch-bar) { position: absolute; left: 18px; bottom: 18px; max-width: 30%; color: var(--text-secondary, #718096); }
.is-expanded .browser-error { position: absolute; left: 20px; right: 20px; bottom: 72px; z-index: 1; text-align: center; }
.browser-tabs { min-height: 34px; padding: 2px 8px; display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: thin; background: var(--bg-primary, #f5f5f7); }
.browser-tab { display: flex; align-items: center; flex: 0 1 160px; min-width: 75px; border-radius: 7px; }
.browser-tab.is-selected { background: var(--bg-secondary, #fff); box-shadow: 0 1px 4px #0000000a; }
.browser-tab > button:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 7px 8px; border: none; background: transparent; color: var(--text-primary, #2d3748); text-align: left; font-size: 12px; cursor: pointer; }
.browser-tab-close { width: 23px; height: 24px; display: grid; place-items: center; border: none; border-radius: 5px; background: transparent; color: var(--text-secondary, #718096); cursor: pointer; }
.browser-toolbar { display: flex; align-items: center; gap: 3px; padding: 7px 8px; }
.browser-address { flex: 1; min-width: 0; height: 29px; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 65%, transparent); border-radius: 7px; background: var(--bg-primary, #f5f5f7); color: var(--text-primary, #2d3748); font-size: 12px; }
.browser-zoom { height: 28px; padding: 0 5px; border: none; border-radius: 5px; background: transparent; color: var(--text-secondary, #718096); font-size: 11px; cursor: pointer; }
.browser-host { flex: 1; min-height: 0; position: relative; overflow: hidden; background: var(--bg-primary, #f5f5f7); }
.browser-opening { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--text-secondary, #718096); }
.browser-loading { height: 2px; flex-shrink: 0; background: color-mix(in srgb, var(--color-primary, #2563eb) 55%, transparent); }
.browser-error { padding: 8px; margin: 0; color: var(--color-warning, #c2410c); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.browser-error button { padding: 0 4px; border: none; background: none; color: inherit; text-decoration: underline; cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .browser-icon-button:hover:not(:disabled), .browser-tab-close:hover { background: var(--bg-tertiary, #eef0f3); } .browser-preview:hover .browser-preview-screen { box-shadow: 0 5px 18px #00000014; } .browser-preview:hover .browser-preview-expand { opacity: 1; } }
@media (max-width: 1150px) { .agent-browser-pane { --browser-pane-width: 210px; } .agent-browser-pane:not(.is-expanded) .browser-pane-inner { padding: 0 10px; } }
@media (max-width: 760px) { .agent-browser-pane { --browser-pane-width: 150px; } .agent-browser-pane:not(.is-expanded) .browser-pane-inner { padding: 0 8px; } .agent-browser-pane.is-expanded { padding: 44px var(--browser-compact-inset) 72px; } .browser-preview-hint { display: none; } }
@media (prefers-reduced-motion: reduce) { .browser-icon-button, .browser-preview-screen, .browser-preview-expand, .browser-pane-enter-active:not(.is-expanded), .browser-pane-leave-active:not(.is-expanded), .browser-pane-enter-active .browser-pane-inner, .browser-pane-leave-active .browser-pane-inner { transition: none; } .is-expanded .browser-screen { animation: none; } }
</style>
