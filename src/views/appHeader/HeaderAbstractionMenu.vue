<template>
  <div
    v-if="props.activeTab === 'browser'"
    class="abstraction-entry"
    data-tauri-drag-region-exclude
  >
    <button
      class="abstraction-btn"
      type="button"
      title="查看当前页的抽象层"
      :class="{ 'is-open': abstractionMenuOpen }"
      @click="abstractionMenuOpen = !abstractionMenuOpen"
    >
      <svg class="abstraction-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.4" y="3" width="11.2" height="3.2" rx="1" />
        <rect x="2.4" y="7.4" width="11.2" height="2.2" rx="0.9" />
        <rect x="2.4" y="10.8" width="7.4" height="2.2" rx="0.9" />
      </svg>
      <span>{{ abstractionButtonLabel }}</span>
      <svg class="abstraction-chevron" :class="{ 'is-open': abstractionMenuOpen }" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.6 4.4 6 7.6 9.4 4.4" />
      </svg>
    </button>
    <BrowserAbstractionPanel
      v-if="abstractionMenuOpen"
      class="abstraction-menu"
      :style="abstractionMenuStyle"
      :browser-id="currentBrowserId"
      :url="currentBrowserUrl"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import BrowserAbstractionPanel from '../../components/BrowserAbstractionPanel.vue'
import { useExclusiveMenu } from '../../composables/useExclusiveMenu'
import {
  abstractionButtonLabel,
  abstractionMenuOpen,
  currentBrowserId,
  currentBrowserUrl,
} from '../../services/browser/abstractions'

const props = defineProps<{
  activeTab?: string
}>()

useExclusiveMenu('header-abstraction-menu', abstractionMenuOpen)

watch(
  () => props.activeTab,
  (tab) => {
    if (tab !== 'browser') abstractionMenuOpen.value = false
  },
)

const abstractionMenuStyle = ref<Record<string, string>>({})

const placeAbstractionMenu = () => {
  const btn = document.querySelector('.abstraction-btn') as HTMLElement | null
  const rect = btn?.getBoundingClientRect()
  const width = Math.min(520, Math.max(360, window.innerWidth - 48))
  const left = rect
    ? Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))
    : Math.max(12, (window.innerWidth - width) / 2)
  abstractionMenuStyle.value = {
    top: `${rect ? rect.bottom + 8 : 48}px`,
    left: `${left}px`,
    width: `${width}px`,
  }
}

const onAbsDocClick = (event: MouseEvent) => {
  const root = document.querySelector('.abstraction-entry')
  const target = event.target as Node | null
  if (root && target && !root.contains(target)) abstractionMenuOpen.value = false
}

watch(abstractionMenuOpen, async (open) => {
  if (open) {
    await nextTick()
    placeAbstractionMenu()
    document.addEventListener('mousedown', onAbsDocClick, true)
    window.addEventListener('resize', placeAbstractionMenu)
    return
  }
  document.removeEventListener('mousedown', onAbsDocClick, true)
  window.removeEventListener('resize', placeAbstractionMenu)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onAbsDocClick, true)
  window.removeEventListener('resize', placeAbstractionMenu)
})
</script>

<style scoped>
.abstraction-entry {
  display: flex;
  justify-content: center;
  margin: 0 auto;
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.abstraction-menu {
  position: fixed;
  z-index: 40;
  pointer-events: auto;
}

.abstraction-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px 0 8px;
  border: 1px solid color-mix(in srgb, var(--text-secondary, #718096) 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary, #fff) 78%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.abstraction-btn:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, var(--bg-secondary, #fff));
}

.abstraction-btn:active {
  transform: scale(0.97);
}

.abstraction-btn.is-open {
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, var(--bg-secondary, #fff));
  border-color: color-mix(in srgb, var(--color-primary, #667eea) 28%, transparent);
}

.abstraction-icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}

.abstraction-chevron {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 160ms ease-out;
}

.abstraction-chevron.is-open {
  transform: rotate(180deg);
}
</style>
