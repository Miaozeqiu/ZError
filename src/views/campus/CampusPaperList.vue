<template>
  <aside class="campus-col campus-papers">
    <div class="pane-header">
      <div class="header-title">试卷</div>
      <div v-if="visiblePaperCount" class="header-meta">{{ visiblePaperCount }}</div>
      <div v-if="platformOptions.length" class="platform-filter" @mousedown.stop>
        <button
          class="platform-select-trigger"
          type="button"
          :class="{ open: platformFilterOpen }"
          title="筛选平台"
          aria-haspopup="listbox"
          :aria-expanded="platformFilterOpen"
          @click="$emit('toggle-filter')"
        >
          <CampusPlatformIcon v-if="platformFilter" :name="platformFilter" />
          <span class="platform-select-label">{{ platformFilter || '全部' }}</span>
          <svg class="platform-select-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" fill="currentColor"/>
          </svg>
        </button>
        <Transition name="dropdown-pop">
          <div v-if="platformFilterOpen" class="platform-filter-menu" role="listbox" aria-label="筛选平台">
            <button
              class="platform-filter-item"
              type="button"
              :class="{ active: !platformFilter }"
              role="option"
              :aria-selected="!platformFilter"
              @click="$emit('set-platform-filter', '')"
            >全部</button>
            <button
              v-for="name in platformOptions"
              :key="name"
              class="platform-filter-item"
              type="button"
              :class="{ active: platformFilter === name }"
              role="option"
              :aria-selected="platformFilter === name"
              @click="$emit('set-platform-filter', name)"
            >
              <CampusPlatformIcon :name="name" />
              <span>{{ name }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
    <div v-if="papersLoading && !visiblePapers.length" class="list-empty">加载试卷中…</div>
    <div v-else-if="!visiblePapers.length" class="list-empty">{{ platformFilter ? '这个平台没有试卷' : '这门课还没有试卷' }}</div>
    <div v-else class="item-list">
      <button
        v-for="paper in visiblePapers"
        :key="paper.id"
        class="list-item paper-item"
        type="button"
        :class="{ 'is-selected': selectedPaperId === paper.id }"
        @click="$emit('select-paper', paper.id)"
      >
        <CampusPlatformIcon :name="paper.platform" />
        <div class="item-name">{{ paper.name }}</div>
        <div v-if="paper.question_count != null" class="item-count">{{ paper.question_count }}</div>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import CampusPlatformIcon from '../../components/campus/CampusPlatformIcon.vue'

export interface CampusPaperItem {
  id: number
  name: string
  platform?: string | null
  question_count?: number
}

defineProps<{
  visiblePaperCount: number
  platformOptions: string[]
  platformFilter: string
  platformFilterOpen: boolean
  papersLoading: boolean
  visiblePapers: CampusPaperItem[]
  selectedPaperId: number | null
}>()

defineEmits<{
  'toggle-filter': []
  'set-platform-filter': [name: string]
  'select-paper': [id: number]
}>()
</script>

<style scoped>
.campus-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.campus-papers {
  width: 240px;
  flex-shrink: 0;
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-meta {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  font-variant-numeric: tabular-nums;
}

.platform-filter {
  position: relative;
  margin-left: auto;
}

.platform-select-trigger {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 148px;
  min-height: 24px;
  padding: 0 6px 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--form-input-bg, #F7F7F7);
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.12s ease;
}

.platform-select-trigger:hover,
.platform-select-trigger.open {
  background: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.platform-select-trigger:active {
  transform: scale(0.97);
}

.platform-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-select-arrow {
  flex-shrink: 0;
  color: var(--text-secondary, #718096);
  transition: transform 0.16s ease;
}

.platform-select-trigger.open .platform-select-arrow {
  transform: rotate(180deg);
}

.platform-filter-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 8;
  min-width: 148px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 12px;
  background: var(--context-menu-bg, rgba(255, 255, 255, 0.4));
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.55));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
}

.platform-filter-item {
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--context-menu-item-text, #2d3748);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.platform-filter-item:hover,
.platform-filter-item.active {
  background-color: var(--context-menu-item-hover-bg, rgba(0, 0, 0, 0.06));
}

.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: top right;
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.item-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item {
  width: 100%;
  display: block;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.list-item:hover,
.list-item.is-selected {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.paper-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paper-item .item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-count {
  flex: 0 0 auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.item-name {
  font-size: 13px;
  line-height: 1.4;
}

.list-empty {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  padding: 16px 12px;
}
</style>
