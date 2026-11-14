<template>
  <button
    class="chat-sidebar-toggle"
    type="button"
    :title="label"
    :aria-label="label"
    :aria-expanded="expanded"
    aria-controls="agent-chat-sidebar"
    data-tauri-drag-region-exclude
  >
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="4" />
      <path :d="expanded ? 'M9 4v16' : 'M7 8v8'" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ expanded: boolean }>()
const label = computed(() => props.expanded ? '收起对话列表' : '展开对话列表')
</script>

<style scoped>
.chat-sidebar-toggle {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.chat-sidebar-toggle:hover {
  background: color-mix(in srgb, var(--text-primary) 11%, transparent);
}

.chat-sidebar-toggle:focus-visible {
  outline: 2px solid var(--color-primary, #2563eb);
  outline-offset: 2px;
}
</style>
