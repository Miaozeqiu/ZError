<template>
  <div
    v-if="props.activeTab === 'browser'"
    class="header-tabs"
  >
    <div class="tab-list">
      <button
        v-for="item in liveBrowserTabs"
        :key="item.id"
        class="tab-item"
        type="button"
        data-tauri-drag-region-exclude
        :class="{ 'is-on': item.id === liveBrowserTabId }"
        @click="browserTabHandlers?.selectTab(item.id)"
      >
        <span class="tab-title">{{ labelOf(item) }}</span>
        <span
          class="tab-close"
          title="关闭"
          @click.stop="browserTabHandlers?.closeTab(item.id)"
        >×</span>
      </button>
    </div>
    <button
      class="tab-new"
      type="button"
      title="新标签页"
      data-tauri-drag-region-exclude
      @click="browserTabHandlers?.newTab()"
    >+</button>
  </div>
</template>

<script setup lang="ts">
import type { AppBrowser } from '../../services/browser/appBrowser'
import { hostnameOf, isBrowserHome } from '../../services/browser/appBrowser'
import {
  browserTabHandlers,
  liveBrowserTabId,
  liveBrowserTabs,
} from '../../services/browser/tabBar'

const props = defineProps<{
  activeTab?: string
}>()

const labelOf = (item: AppBrowser) => {
  if (browserTabHandlers.value) return browserTabHandlers.value.tabLabel(item)
  if (isBrowserHome(item.url)) return '导航'
  return item.title || item.name || hostnameOf(item.url)
}
</script>

<style scoped>
.header-tabs {
  flex: 1;
  min-width: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
  pointer-events: none;
}

.tab-list {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  pointer-events: none;
}

.tab-item {
  max-width: 168px;
  min-width: 72px;
  height: 26px;
  padding: 0 6px 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  -webkit-appearance: none;
  appearance: none;
}

.tab-item:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: var(--text-primary, #2d3748);
}

.tab-item.is-on {
  background: color-mix(in srgb, var(--bg-secondary, #fff) 86%, transparent);
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
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  -webkit-appearance: none;
  appearance: none;
}

.tab-new:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, #2d3748);
}
</style>
