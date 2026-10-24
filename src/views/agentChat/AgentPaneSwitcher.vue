<template>
  <div class="agent-pane-switcher" role="group" aria-label="Agent 工作区" data-tauri-drag-region-exclude>
    <button
      v-for="item in panes"
      :key="item.id"
      type="button"
      :class="{ 'is-selected': selectedAgentPane === item.id }"
      :aria-pressed="selectedAgentPane === item.id"
      :aria-label="item.label"
      :disabled="!item.available"
      :title="item.available ? `显示${item.label}` : item.empty"
      @click="selectAgentPane(item.id)"
    >
      <Icon :icon="item.icon" width="14" height="14" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import {
  availableGraphSubjectId, availableQuizKey, availableWriteStepId,
  selectAgentPane, selectedAgentPane, type AgentPane,
} from './useAgentChatPanes'

const panes = computed<Array<{ id: AgentPane; label: string; icon: string; available: boolean; empty: string }>>(() => [
  { id: 'browser', label: '浏览器', icon: 'lucide:globe', available: true, empty: '' },
  { id: 'quiz', label: '题目', icon: 'lucide:list-checks', available: !!availableQuizKey.value, empty: '当前对话暂无题目' },
  { id: 'graph', label: '图谱', icon: 'lucide:share-2', available: availableGraphSubjectId.value != null, empty: '当前对话尚未关联科目图谱' },
  { id: 'write', label: '入库', icon: 'lucide:book-open', available: !!availableWriteStepId.value, empty: '当前对话暂无入库记录' },
])
</script>

<style scoped>
.agent-pane-switcher { display: flex; align-items: center; gap: 3px; flex-shrink: 0; -webkit-app-region: no-drag; }
.agent-pane-switcher button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 9px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary, #718096); font-size: 12px; font-weight: 450; white-space: nowrap; cursor: pointer; }
.agent-pane-switcher button:hover:not(:disabled), .agent-pane-switcher button.is-selected { background: color-mix(in srgb, var(--text-primary, #2d3748) 9%, transparent); color: var(--text-primary, #2d3748); }
.agent-pane-switcher button:disabled { opacity: 0.4; cursor: default; }
.agent-pane-switcher button:focus-visible { outline: 2px solid var(--color-primary, #2563eb); outline-offset: 2px; }
@media (max-width: 900px) {
  .agent-pane-switcher button { padding: 0 7px; }
  .agent-pane-switcher button span { display: none; }
}
</style>
