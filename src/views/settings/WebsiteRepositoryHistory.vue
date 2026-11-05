<template>
  <Teleport to="body">
    <div ref="dialog" class="history-overlay" role="dialog" aria-modal="true" aria-labelledby="website-history-title" tabindex="-1" @click.self="emit('close')" @keydown="onKeydown">
      <section class="history-dialog">
        <header class="history-header">
          <div class="history-heading"><Icon icon="lucide:history" width="17" /><h3 id="website-history-title">时间线</h3><span class="history-host" :title="host">{{ host }}</span></div>
          <button type="button" class="history-close" aria-label="关闭提交历史" @click="emit('close')"><Icon icon="lucide:x" width="18" /></button>
        </header>
        <div class="history-toolbar">
          <div class="history-filter" role="radiogroup" aria-label="筛选时间线来源" :data-selected-index="sourceFilter === 'all' ? 0 : 1">
            <span class="history-filter-slider" aria-hidden="true"></span>
            <label v-for="option in sourceOptions" :key="option.value" class="history-filter-option">
              <input v-model="sourceFilter" type="radio" name="website-history-source" :value="option.value">
              <span>{{ option.label }}</span>
            </label>
          </div>
          <div class="history-toolbar-actions">
            <span class="history-sort"><span v-if="!loading">{{ entries.length }} 条已加载</span><Icon icon="lucide:git-fork" width="13" aria-hidden="true" />版本关系</span>
            <button type="button" class="history-refresh" :disabled="loading || remoteLoading || !!localError" :aria-busy="refreshing" aria-label="刷新 GitHub 提交历史" title="刷新 GitHub 提交历史" @click="refreshRemote">
              <Icon icon="lucide:refresh-cw" width="15" height="15" :class="{ 'is-spinning': refreshing }" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div id="website-history-panel" class="history-content" @scroll="clearHover()">
          <p v-if="localError" class="history-error" role="alert">{{ localError }}</p>
          <div v-if="currentId" class="history-version-status">
            <span>当前使用 <code>{{ currentId.startsWith('bundled:') ? '内置版本' : currentId.slice(0, 7) }}</code><template v-if="local?.pinned"> · 历史快照（只读）</template></span>
            <button v-if="local?.pinned" type="button" class="history-text-button" :disabled="switching || !allowSwitch" @click="changeVersion(null)">回到工作版本</button>
          </div>
          <p v-if="switching" class="history-note" role="status">正在切换版本…</p>
          <p v-if="switchError" class="history-error" role="alert">{{ switchError }}</p>
          <p v-if="!allowSwitch" class="history-note">请先保存或放弃编辑中的修改，再切换版本。</p>
          <p v-if="remoteRevision && local?.revision && remoteRevision !== local.revision && !local.revision.startsWith('bundled:')" class="history-note history-sync-note">远程版本已变化 · 本地仍基于 <code>{{ local.revision.slice(0, 7) }}</code></p>
          <p v-if="remoteError" class="history-error" role="alert">{{ remoteError }} <button type="button" class="history-text-button" :disabled="remoteLoading" @click="refreshFailed ? refreshRemote() : loadRemote()">重试</button></p>
          <ol class="history-list" aria-label="网站操作历史时间线">
            <li v-for="entry in entries" :key="entry.key" class="history-entry" :class="{ 'is-head': entry.current, 'is-local': entry.kind === 'local', 'history-remote-commit': entry.kind === 'github' }" :data-source="entry.kind">
              <button type="button" class="history-row" aria-haspopup="dialog" :aria-label="`${entry.kind === 'local' ? '本地修改' : '上游提交'}：${entry.title}${entry.badge ? '，' + entry.badge : ''}，${relativeDate(entry.timestamp)}`" :aria-expanded="hoverKey === entry.key" :aria-controls="hoverKey === entry.key ? 'website-commit-hover' : undefined"
                @pointerenter="queueHover($event, entry)" @pointerleave="scheduleHoverClose"
                :class="{ 'is-selected': selectedKey === entry.key }" :aria-current="entry.current || undefined"
                @focus="selectedKey = entry.key; queueHover($event, entry, true)" @blur="onHoverBlur"
                @click="openHover($event, entry)">
                <span class="history-node" aria-hidden="true">
                  <svg :width="entry.graph.width" height="22" :viewBox="`0 0 ${entry.graph.width} 22`" class="history-graph">
                    <path v-for="(path, index) in entry.graph.paths" :key="index" :d="path.d" :stroke="path.color" stroke-width="1" stroke-linecap="round" fill="none" />
                    <circle :cx="entry.graph.x" cy="11" :r="entry.current ? 6 : entry.graph.merge ? 5 : 4" :fill="entry.current || entry.graph.merge ? 'var(--history-row-background)' : entry.graph.color" :stroke="entry.current || entry.graph.merge ? entry.graph.color : 'var(--history-row-background)'" :stroke-width="entry.current ? 2 : 1" />
                    <circle v-if="entry.graph.merge && !entry.current" :cx="entry.graph.x" cy="11" r="2" :fill="entry.graph.color" />
                  </svg>
                </span>
                <span class="history-row-title"><strong>{{ entry.title }}</strong><span v-if="entry.current" class="history-current">当前使用</span><span v-for="ref in entry.refs" :key="ref.label" class="history-ref" :style="{ background: entry.graph.color }" :class="{ 'is-remote': ref.remote }"><Icon :icon="ref.remote ? 'lucide:cloud' : 'lucide:circle-dot'" width="13" height="13" />{{ ref.label }}</span></span>
              </button>
            </li>
          </ol>
          <p v-if="loading" class="history-empty" role="status">正在读取本地记录…</p>
          <p v-if="remoteLoading" class="history-empty" role="status">正在读取上游提交…</p>
          <p v-if="!entries.length && !loading && !remoteLoading && !localError && !remoteError" class="history-empty">暂无{{ sourceFilter === 'github' ? '上游提交' : '历史' }}记录。</p>
          <p v-if="sourceFilter !== 'github' && local?.truncated" class="history-note history-bottom-note">仅保留最近 200 条本地记录。</p>
          <button v-if="hasMore && !remoteError" type="button" class="history-more" :disabled="remoteLoading" @click="loadRemote">加载更多</button>
        </div>
      </section>
    <div v-if="hoverItem" id="website-commit-hover" ref="hoverCard" class="history-hover" :class="`is-${hoverItem.kind}`" :style="hoverStyle" role="dialog" aria-modal="false" aria-label="提交详情" tabindex="-1"
      @pointerenter="cancelHoverClose" @pointerleave="scheduleHoverClose" @focusin="cancelHoverClose" @focusout="onHoverBlur">
      <template v-if="hoverItem.kind === 'local'">
        <p class="history-hover-title">{{ localTitle(hoverItem.commit) }}</p>
        <p v-if="hoverItem.commit.kind === 'migrate'" class="history-note">这是已有改动的迁移节点；此前的逐次修改未记录。</p>
        <p v-if="hoverItem.commit.parent.startsWith('bundled:')" class="history-note">来自旧内置版本，没有可关联的 GitHub 父提交。</p>
        <dl class="history-properties"><dt>来源</dt><dd>本地修改 · 仅保存在本机</dd><dt>版本</dt><dd><code>{{ hoverItem.commit.id }}</code></dd><dt>父版本</dt><dd><code>{{ hoverItem.commit.parent }}</code></dd><dt>上游基准</dt><dd><code>{{ hoverItem.commit.upstreamRevision }}</code></dd><dt>时间</dt><dd>{{ formatDate(hoverItem.commit.createdAt) }}</dd></dl>
        <ul class="history-files" aria-label="修改的文件"><li v-for="path in hoverItem.commit.paths" :key="path"><Icon icon="lucide:file-text" width="14" /><code>{{ path }}</code></li></ul>
      </template>
      <template v-else>
        <p class="history-message">{{ hoverItem.commit.message }}</p>
        <dl class="history-properties"><dt>来源</dt><dd>上游 Git 提交</dd><dt>作者</dt><dd>{{ hoverItem.commit.author }}</dd><dt>提交</dt><dd><code>{{ hoverItem.commit.sha }}</code></dd><dt>时间</dt><dd>{{ formatDate(hoverItem.commit.date) }}</dd></dl>
        <a class="history-commit-link" :href="hoverItem.commit.url" target="_blank" rel="noopener noreferrer" @click.prevent="openCommit(hoverItem.commit.url)">在 GitHub 查看更改<Icon icon="lucide:external-link" width="13" /></a>
      </template>
      <div class="history-version-action">
        <span v-if="hoverKey === currentId">当前使用</span>
        <button v-else-if="hoverItem.kind === 'github' || local?.restorable?.includes(hoverKey)" type="button" class="history-text-button" :disabled="switching || !allowSwitch" @click="changeVersion(hoverKey)">使用此版本</button>
        <span v-else>此记录没有可恢复的快照</span>
      </div>
    </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import { GRAPH_LOCAL, GRAPH_REMOTE, orderHistoryGraph, layoutHistoryGraph, type HistoryGraphItem } from '../../utils/ui/websiteHistoryGraph'
import { onWebsiteRepositoryChanged, readWebsiteLocalHistory, readWebsiteGitHistory, readWebsiteGitHistoryRevision, refreshWebsiteGitHistory, repositorySourceFor, selectWebsiteRepositoryVersion } from '../../services/agent/websiteRepository'
import type { WebsiteLocalCommit } from '../../services/agent/websiteRepositoryCore'
import type { WebsiteGitCommit } from '../../services/agent/websiteRepositoryGitHub'

const props = withDefaults(defineProps<{ host: string; allowSwitch?: boolean }>(), { allowSwitch: true })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement>(), sourceFilter = ref<'all' | 'github'>('all')
const sourceOptions = [{ value: 'all', label: '全部记录' }, { value: 'github', label: '上游提交' }] as const
const local = ref<Awaited<ReturnType<typeof readWebsiteLocalHistory>>>(), localError = ref(''), loading = ref(true)
const remote = ref<WebsiteGitCommit[]>([]), remoteError = ref(''), remoteLoading = ref(false), hasMore = ref(false)
const remoteRevision = ref(''), refreshing = ref(false), refreshFailed = ref(false)
const selectedKey = ref('')
const switching = ref(false), switchError = ref('')
const workingId = computed(() => local.value?.workingId ?? (local.value?.hasFork ? local.value.commits[0]?.id : local.value?.revision))
const currentId = computed(() => local.value?.currentId ?? workingId.value)
let page = 1, disposed = false
const clock = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined
const previousFocus = document.activeElement as HTMLElement | null
const formatDate = (value: string | number) => new Date(value).toLocaleString()
const relativeDate = (value: string | number) => {
  const seconds = Math.max(0, (clock.value - new Date(value).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`
  return new Date(value).toLocaleDateString()
}
type HoverItem = { kind: 'local'; commit: WebsiteLocalCommit } | { kind: 'github'; commit: WebsiteGitCommit }
const hoverItem = shallowRef<HoverItem>(), hoverCard = ref<HTMLElement>()
const hoverKey = computed(() => hoverItem.value ? hoverItem.value.kind === 'local' ? hoverItem.value.commit.id : hoverItem.value.commit.sha : '')
const hoverStyle = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })
let hoverAnchor: HTMLElement | undefined, hoverTimer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined
let hoverWasVisible = false, hoverLocked = false, dismissedKey = ''
const itemKey = (item: HoverItem) => item.kind === 'local' ? item.commit.id : item.commit.sha
const cancelHoverClose = () => { if (closeTimer) clearTimeout(closeTimer); closeTimer = undefined }
const clearHover = (restoreFocus = false) => {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = undefined; cancelHoverClose()
  const anchor = hoverAnchor
  if (hoverKey.value) dismissedKey = hoverKey.value
  hoverItem.value = undefined; hoverAnchor = undefined; hoverLocked = false
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true })
}
const positionHover = () => {
  if (!hoverAnchor?.isConnected || !hoverCard.value) return
  const anchor = hoverAnchor.getBoundingClientRect(), card = hoverCard.value.getBoundingClientRect()
  const padding = 12, gap = 6
  const left = Math.max(padding, Math.min(anchor.left + 28, window.innerWidth - card.width - padding))
  const top = anchor.bottom + gap + card.height <= window.innerHeight - padding ? anchor.bottom + gap
    : Math.max(padding, Math.min(anchor.top - gap - card.height, window.innerHeight - card.height - padding))
  hoverStyle.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
}
const queueHover = (event: Event, item: HoverItem, immediate = false) => {
  if ('pointerType' in event && event.pointerType === 'touch') return
  if (!immediate && hoverLocked) return
  if (immediate && dismissedKey === itemKey(item)) return
  if (!immediate) dismissedKey = ''
  cancelHoverClose()
  if (hoverTimer) clearTimeout(hoverTimer)
  const anchor = event.currentTarget as HTMLElement
  const show = async () => {
    if (disposed || !anchor.isConnected) return
    hoverAnchor = anchor
    if (hoverKey.value !== itemKey(item)) hoverStyle.value.visibility = 'hidden'
    hoverItem.value = item; hoverWasVisible = true
    await nextTick(); if (!disposed) positionHover()
  }
  if (immediate || hoverWasVisible) void show()
  else hoverTimer = setTimeout(() => { hoverTimer = undefined; void show() }, 300)
}
const scheduleHoverClose = () => {
  if (hoverLocked) return
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = undefined; cancelHoverClose()
  closeTimer = setTimeout(() => {
    if (hoverCard.value?.contains(document.activeElement) || hoverAnchor?.matches(':focus-visible')) return
    clearHover()
  }, 160)
}
const onHoverBlur = (event: FocusEvent) => {
  const target = event.relatedTarget as Node | null
  if (target && (hoverCard.value?.contains(target) || hoverAnchor?.contains(target))) return
  clearHover()
}
const openHover = async (event: MouseEvent, item: HoverItem) => {
  selectedKey.value = item.kind === 'local' ? item.commit.id : item.commit.sha
  dismissedKey = ''
  queueHover(event, item, true)
  hoverLocked = true
  if (event.detail === 0) { await nextTick(); (hoverCard.value?.querySelector<HTMLElement>('a, button:not(:disabled)') || hoverCard.value)?.focus() }
}
const onOutsidePointer = (event: PointerEvent) => {
  const target = event.target as Node | null
  if (target && !hoverCard.value?.contains(target) && !hoverAnchor?.contains(target)) clearHover()
}
const localTitle = (commit: WebsiteLocalCommit) => ({ write: '保存本地修改',
  migrate: commit.parent.startsWith('bundled:') ? '从内置版本导入本地修改' : '导入已有本地改动', reset: '恢复仓库版本',
  'resolve-local': '解决冲突 · 保留本地', 'resolve-upstream': '解决冲突 · 采用仓库版本',
  update: `基准更新至 ${commit.upstreamRevision.startsWith('bundled:') ? '内置版本' : commit.upstreamRevision.slice(0, 7)} · 保留本地修改` })[commit.kind]
type TimelineEntry = HoverItem & HistoryGraphItem & { title: string; badge: string; refs: { label: string; remote: boolean }[] }
const entries = computed(() => {
  const result: TimelineEntry[] = []
  const branch = repositorySourceFor(props.host)?.branch || 'main'
  const byId = new Map(remote.value.map(commit => [commit.sha, commit]))
  const mainline = new Set<string>()
  let ancestor = byId.has(remoteRevision.value) ? remoteRevision.value : remote.value[0]?.sha
  while (ancestor && !mainline.has(ancestor) && byId.has(ancestor)) {
    mainline.add(ancestor)
    ancestor = byId.get(ancestor)?.parents?.[0]
  }
  for (const commit of local.value?.commits || []) {
    const current = commit.id === currentId.value, parents = [commit.parent]
    if (commit.kind === 'update' && !parents.includes(commit.upstreamRevision)) parents.push(commit.upstreamRevision)
    result.push({ kind: 'local', commit, key: commit.id, parents, timestamp: commit.createdAt, title: localTitle(commit), current,
      color: GRAPH_LOCAL, badge: current ? '当前使用' : '', refs: commit.id === workingId.value ? [{ label: '本地修改', remote: false }] : [] })
  }
  for (const commit of remote.value) {
    const cached = commit.sha === local.value?.revision, current = commit.sha === currentId.value
    const refs = [...(cached ? [{ label: commit.sha === workingId.value ? branch : '本地基准', remote: false }] : []), ...(commit.sha === remoteRevision.value ? [{ label: `origin/${branch}`, remote: true }] : [])]
    result.push({ kind: 'github', commit, key: commit.sha, parents: commit.parents || [], timestamp: Date.parse(commit.date), title: commit.message.split('\n')[0],
      current, color: GRAPH_REMOTE, mainline: mainline.has(commit.sha),
      badge: current ? '当前使用' : cached && local.value?.hasFork ? '上游基准' : '', refs })
  }
  const ordered = orderHistoryGraph(result).filter(entry => sourceFilter.value === 'all' || sourceFilter.value === entry.kind)
  const graph = layoutHistoryGraph(ordered)
  return ordered.map(entry => ({ ...entry, graph: graph.get(entry.key)! }))
})
const refreshLocal = async () => {
  const result = await readWebsiteLocalHistory(props.host)
  if (!disposed) local.value = result
  return result
}
const changeVersion = async (id: string | null) => {
  if (switching.value || !props.allowSwitch) return
  switching.value = true
  switchError.value = ''
  try {
    await selectWebsiteRepositoryVersion(props.host, id)
    if (disposed) return
    await refreshLocal()
    if (!disposed) clearHover(true)
  } catch (error) {
    if (!disposed) switchError.value = error instanceof Error ? error.message : '切换网站版本失败。'
  } finally {
    if (!disposed) switching.value = false
  }
}
const stopWatchingRepository = onWebsiteRepositoryChanged(host => {
  if (!disposed && host === props.host) void refreshLocal().catch(() => undefined)
})
const loadRemote = async () => {
  if (remoteLoading.value || !local.value) return
  if (!/^[a-f0-9]{40}$/.test(remoteRevision.value)) { remoteError.value = '当前使用离线内置副本，可点击刷新读取 GitHub 历史。'; return }
  remoteLoading.value = true; remoteError.value = ''
  refreshFailed.value = false
  try {
    const result = await readWebsiteGitHistory(props.host, remoteRevision.value, page)
    if (disposed) return
    const ids = new Set(remote.value.map(commit => commit.sha))
    remote.value.push(...result.commits.filter(commit => !ids.has(commit.sha)))
    hasMore.value = result.hasMore; page++
    await nextTick(); if (!disposed) positionHover()
  } catch (error) { if (!disposed) remoteError.value = error instanceof Error ? error.message : '读取 GitHub 历史失败，本地记录仍可查看。' }
  finally { if (!disposed) remoteLoading.value = false }
}
const refreshRemote = async () => {
  if (remoteLoading.value || !local.value) return
  clearHover()
  refreshing.value = true; remoteLoading.value = true; remoteError.value = ''; refreshFailed.value = false
  try {
    const result = await refreshWebsiteGitHistory(props.host)
    if (disposed) return
    const ids = new Set(result.commits.map(commit => commit.sha))
    // Preserve already loaded ancestors, including the local base, while
    // paging further requests against the newly fetched immutable revision.
    remote.value = [...result.commits, ...remote.value.filter(commit => !ids.has(commit.sha))]
    remoteRevision.value = result.revision
    hasMore.value = result.hasMore; page = 2
  } catch (error) {
    if (!disposed) { remoteError.value = error instanceof Error ? error.message : '刷新 GitHub 历史失败，已保留现有记录。'; refreshFailed.value = true }
  } finally { if (!disposed) { refreshing.value = false; remoteLoading.value = false } }
}
watch(sourceFilter, () => { clearHover(); dismissedKey = '' })
const openCommit = async (url: string) => {
  try { await (await import('@tauri-apps/plugin-opener')).openUrl(url) }
  catch { remoteError.value = '无法打开提交链接，请稍后重试。' }
}
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (hoverItem.value) clearHover(true); else emit('close'); return }
  const target = event.target as HTMLElement | null
  if (target?.matches('button.history-row') && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    const rows = [...dialog.value!.querySelectorAll<HTMLElement>('.history-row')]
    const index = rows.indexOf(target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
    event.preventDefault(); rows[next]?.focus(); return
  }
  if (target?.matches('button.history-row') && event.key === 'ArrowRight') {
    event.preventDefault()
    void nextTick(() => { (hoverCard.value?.querySelector<HTMLElement>('a, button:not(:disabled)') || hoverCard.value)?.focus() })
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...dialog.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="radio"]:checked, a[href]')].filter(element => element.tabIndex >= 0)
  const first = focusable[0], last = focusable.at(-1)
  if (document.activeElement === hoverCard.value) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  document.addEventListener('pointerdown', onOutsidePointer, true)
  window.addEventListener('resize', positionHover)
  clockTimer = setInterval(() => { clock.value = Date.now() }, 60_000)
  await nextTick(); dialog.value?.focus()
  try {
    const result = await refreshLocal()
    if (disposed) return
    remoteRevision.value = await readWebsiteGitHistoryRevision(props.host, result.revision)
    if (disposed) return
    void loadRemote()
  } catch (error) { if (!disposed) localError.value = error instanceof Error ? error.message : '读取本地提交失败。' }
  finally { if (!disposed) loading.value = false }
})
onBeforeUnmount(() => { disposed = true; stopWatchingRepository(); clearHover(); document.removeEventListener('pointerdown', onOutsidePointer, true); window.removeEventListener('resize', positionHover); if (clockTimer) clearInterval(clockTimer); if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<style scoped>
.history-overlay { outline: none; position: fixed; inset: 0; z-index: 2200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.25); backdrop-filter: blur(5px); }
.history-dialog { width: 640px; max-width: 100%; max-height: 80vh; display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: 16px; background: var(--platform-config-dialog-bg, var(--bg-primary, #fff)); color: var(--text-primary); box-shadow: 0 20px 60px rgba(0,0,0,.18); outline: none; overflow: hidden; }
.history-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; }
.history-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.history-heading > svg { color: var(--text-secondary); flex-shrink: 0; }
.history-header h3 { margin: 0; font-size: 15px; font-weight: 600; white-space: nowrap; }
.history-host { margin-left: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.history-close { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; background: var(--hover-bg, #eee); color: var(--text-secondary); cursor: pointer; }
.history-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--border-color); }
.history-filter { --pad: 3px; position: relative; display: flex; min-width: 0; padding: var(--pad); margin: 8px 0; border-radius: .5rem; background: var(--platform-toggle-bg); font-size: 14px; }
.history-filter-option { flex: 1 1 0; position: relative; z-index: 1; text-align: center; }
.history-filter-option input { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.history-filter-option span { display: flex; align-items: center; justify-content: center; padding: .2rem .6rem; border-radius: .4rem; color: var(--text-secondary); cursor: pointer; white-space: nowrap; user-select: none; transition: color .15s ease; }
.history-filter-option input:checked + span { font-weight: 600; color: var(--text-primary); }
.history-filter-option input:focus-visible + span { outline: 2px solid var(--color-primary, #6a8cc6); outline-offset: -2px; }
.history-filter-slider { position: absolute; top: var(--pad); left: var(--pad); width: calc((100% - var(--pad) * 2) / 2); height: calc(100% - var(--pad) * 2); border-radius: .4rem; background: var(--platform-toggle-slider); pointer-events: none; transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
.history-filter[data-selected-index="1"] .history-filter-slider { transform: translateX(100%); }
[data-theme="dark"] .history-filter-slider { background: #383838; }
@media (prefers-reduced-motion: reduce) { .history-filter-slider, .history-filter-option span { transition: none; } }
.history-sort { display: flex; align-items: center; gap: 5px; flex-shrink: 0; color: var(--text-secondary); font-size: 11px; }
.history-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.history-refresh { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.history-refresh:hover:not(:disabled) { background: var(--hover-bg); color: var(--text-primary); }
.history-refresh:disabled { opacity: .45; cursor: default; }
.is-spinning { animation: history-refresh-spin 1s linear infinite; }
@keyframes history-refresh-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .is-spinning { animation: none; } }
.history-content { padding: 12px 12px 20px; overflow-y: auto; min-height: 180px; font-size: 13px; overscroll-behavior: contain; }
.history-note, .history-empty { color: var(--text-secondary); line-height: 1.6; font-size: 11px; margin: 0 8px 10px; }
.history-empty { padding: 16px 0; text-align: center; }
.history-bottom-note { margin-top: 12px; }
.history-error { margin: 0 8px 10px; color: var(--color-danger, #d44); line-height: 1.6; }
.history-list { list-style: none; padding: 0; margin: 0; }
.history-entry { --history-row-background: var(--platform-config-dialog-bg, var(--bg-primary, #fff)); }
/* Microsoft VS Code SCM Graph: 22px lanes, 11px columns, radius-4 nodes and 2px node outlines. */
.history-row { display: flex; align-items: center; gap: 0; position: relative; width: 100%; height: 22px; padding: 0 4px 0 0; border: 0; border-radius: 0; background: var(--history-row-background); text-align: left; color: inherit; font: inherit; cursor: default; }
.history-node { display: flex; align-items: center; flex-shrink: 0; height: 22px; margin-right: 0; }
.history-graph { display: block; overflow: visible; flex-shrink: 0; }
.is-head .history-row-title strong { font-weight: 600; }
.history-row-title { flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0; line-height: 22px; padding-left: 4px; }
.history-row-title strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 400; }
.history-version-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 8px 8px; font-size: 12px; }
.history-current { flex-shrink: 0; padding: 0 5px; border-radius: 4px; background: var(--hover-bg, #eee); font-size: 11px; line-height: 17px; }
.history-version-action { margin-top: 10px; font-size: 12px; color: var(--text-secondary); }
.history-ref { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; max-width: 130px; overflow: hidden; border-radius: 10px; padding: 0 5px 0 2px; background: #006bb9; color: #fff; font-size: 12px; line-height: 18px; white-space: nowrap; }
.history-ref svg { flex-shrink: 0; }
.history-row[aria-expanded=true] { --history-row-background: color-mix(in srgb, var(--text-primary) 6%, var(--platform-config-dialog-bg, var(--bg-primary, #fff))); }
.history-row.is-selected { --history-row-background: color-mix(in srgb, var(--text-primary) 10%, var(--platform-config-dialog-bg, var(--bg-primary, #fff))); }
.history-hover { position: fixed; z-index: 2300; width: min(420px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 24px)); box-sizing: border-box; padding: 14px 16px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border-color, #ddd); border-radius: 7px; background: var(--platform-config-dialog-bg, var(--bg-primary, #fff)); color: var(--text-primary); box-shadow: 0 5px 20px rgba(0,0,0,.16); font-size: 12px; overflow-wrap: anywhere; outline: none; }
.history-hover-title { margin: 0 0 12px; font-weight: 550; font-size: 13px; }
.history-hover .history-note { margin: 0 0 12px; }
.history-hover code { font-size: 11px; user-select: text; }
.history-properties { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 16px; margin: 0; font-size: 11px; line-height: 1.5; }
.history-properties dt { color: var(--text-secondary); }
.history-properties dd { margin: 0; min-width: 0; }
.history-files { list-style: none; padding: 10px 0 0; margin: 10px 0 0; border-top: 1px solid var(--border-color); }
.history-files li { display: flex; align-items: center; gap: 7px; padding: 3px 0; }
.history-files svg { flex-shrink: 0; color: var(--text-secondary); }
.history-message { margin: 0 0 12px; white-space: pre-wrap; line-height: 1.6; }
.history-commit-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px; text-decoration: none; color: var(--color-primary, #5b82bd); }
.history-text-button, .history-more { border: none; color: var(--text-primary); background: var(--hover-bg, #f4f4f4); padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px; }
.history-more { display: block; margin: 12px auto 0; }
.history-dialog button:focus-visible, .history-dialog input:focus-visible, .history-hover a:focus-visible { outline: 2px solid var(--color-primary, #6a8cc6); outline-offset: -2px; }
.history-dialog .history-row:focus-visible { outline: 1px solid color-mix(in srgb, var(--color-primary, #6a8cc6) 45%, transparent); outline-offset: -1px; }
@media (hover: hover) and (pointer: fine) {
  .history-row:hover { --history-row-background: color-mix(in srgb, var(--text-primary) 6%, var(--platform-config-dialog-bg, var(--bg-primary, #fff))); }
  .history-filter-option:hover span, .history-close:hover { color: var(--text-primary); }
  .history-commit-link:hover { text-decoration: underline; }
}
.history-close:active, .history-more:active, .history-text-button:active { transform: scale(.97); }
@media (max-width: 480px) {
  .history-overlay { padding: 12px; }
  .history-header { padding: 14px 16px 10px; }
  .history-toolbar { padding: 0 16px; }
  .history-sort { display: none; }
  .history-content { padding: 10px 6px 16px; }
  .history-row-title { gap: 5px; }
}
</style>
