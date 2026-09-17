<template>
  <div v-if="pending && pending.sessionId === sessionId" class="approval-bar" role="alertdialog">
    <div class="approval-copy">
      <div class="approval-title">{{ pending.title }}</div>
      <p v-if="pending.detail" class="approval-detail">{{ pending.detail }}</p>
    </div>
    <div class="approval-actions">
      <button type="button" class="approval-btn" @click="resolveAgentApproval(pending.id, false)">拒绝</button>
      <button type="button" class="approval-btn is-allow" @click="resolveAgentApproval(pending.id, true)">允许</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agentApprovalState, resolveAgentApproval } from '../../services/agent/agentApproval'

defineProps<{
  sessionId?: string
}>()

const pending = computed(() => agentApprovalState.pending)
</script>

<style scoped>
.approval-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.28));
  border-radius: 10px;
  background: var(--bg-elevated, var(--bg-secondary, transparent));
}

.approval-copy {
  min-width: 0;
}

.approval-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.approval-detail {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.approval-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.approval-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.approval-btn:hover {
  color: var(--text-primary);
}

.approval-btn.is-allow {
  color: var(--text-primary);
  font-weight: 600;
}
</style>
