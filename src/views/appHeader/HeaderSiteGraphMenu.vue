<template>
  <button
    class="graph-btn"
    type="button"
    title="查看当前网站的路由和解析器"
    :class="{ 'is-open': siteGraphMenuOpen }"
    :aria-pressed="siteGraphMenuOpen"
    @click="toggleSiteGraphMenu"
  >
    <svg class="graph-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <path d="M5.4 5.1 10.6 5.8M4.7 5.5 7.3 10.6M10.8 6.4 8.8 10.6" />
    </svg>
    <span>{{ siteGraphButtonLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import {
  siteGraphButtonLabel,
  siteGraphMenuOpen,
  toggleSiteGraphMenu,
} from '../../services/browser/siteGraph'
</script>

<style scoped>
.graph-btn {
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

.graph-btn:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.graph-btn:active {
  transform: scale(0.97);
}

.graph-btn.is-open {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, transparent);
}

.graph-icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
