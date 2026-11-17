<template>
  <aside class="task-sidebar">
    <div class="pane-header">
      <div class="header-title">任务</div>
      <button
        v-if="finishedCount > 0"
        class="header-action"
        type="button"
        @click="emit('clear-finished')"
      >
        清除已完成
      </button>
    </div>

    <div class="task-list">
      <button
        v-for="task in tasks"
        :key="task.id"
        class="task-item"
        :class="{ 'is-selected': task.id === selectedId }"
        type="button"
        @click="emit('select', task.id)"
      >
        <div class="task-item-top">
          <div class="task-item-name" :title="task.fileName">{{ task.fileName }}</div>
          <span class="task-status" :class="`is-${task.status}`">{{ statusLabel(task.status) }}</span>
        </div>
        <div class="task-item-sub">{{ task.progressText }}</div>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { ImportTask, ImportTaskStatus } from '../../services/app/importTasks'

defineProps<{
  tasks: ImportTask[]
  selectedId: string | null
  finishedCount: number
}>()

const emit = defineEmits<{
  select: [id: string]
  'clear-finished': []
}>()

const statusLabel = (status: ImportTaskStatus) => {
  switch (status) {
    case 'queued':
      return '排队中'
    case 'reading':
      return '查看中'
    case 'analyzing':
      return '查看中'
    case 'saving':
      return '写入中'
    case 'done':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return status
  }
}
</script>

<style scoped>
.task-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-primary, #fff);
  position: relative;
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.header-action:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.header-action:active {
  transform: scale(0.97);
}

.task-list {
  flex: 1;
  overflow: auto;
  padding: 6px;
}

.task-item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.task-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.task-item.is-selected {
  background: #e8e8ed;
}

.task-item:active {
  transform: scale(0.99);
}

.task-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-item-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item-sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary, #718096);
}

.task-status.is-analyzing,
.task-status.is-reading,
.task-status.is-saving,
.task-status.is-queued {
  color: #3b82f6;
}

.task-status.is-done {
  color: #16a34a;
}

.task-status.is-failed {
  color: #dc2626;
}

@media (prefers-reduced-motion: reduce) {
  .header-action:active,
  .task-item:active {
    transform: none;
  }
}
</style>
