<template>
  <button
    class="abstraction-btn"
    type="button"
    title="查看当前页的章节或题卡"
    :class="{ 'is-open': abstractionMenuOpen }"
    :aria-pressed="abstractionMenuOpen"
    @click="toggleAbstractionMenu"
  >
    <svg class="abstraction-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.4" y="3" width="11.2" height="3.2" rx="1" />
      <rect x="2.4" y="7.4" width="11.2" height="2.2" rx="0.9" />
      <rect x="2.4" y="10.8" width="7.4" height="2.2" rx="0.9" />
    </svg>
    <span>{{ abstractionButtonLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import {
  abstractionButtonLabel,
  abstractionMenuOpen,
} from '../../services/browser/abstractions'
import { toggleAbstractionMenu } from '../../services/browser/siteGraph'
</script>

<style scoped>
.abstraction-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.abstraction-btn:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.abstraction-btn:active {
  transform: scale(0.97);
}

.abstraction-btn.is-open {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, transparent);
}

.abstraction-icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}
</style>
