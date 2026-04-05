<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text?: string
}>()

const normalizedText = computed(() => props.text?.trim() ?? '')
</script>

<template>
  <div class="tooltip-container">
    <slot />
    <span v-if="normalizedText" class="tooltip">{{ normalizedText }}</span>
  </div>
</template>

<style scoped>
.tooltip-container {
  --background: #333333;
  --color: #e8e8e8;
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%) scale(0);
  transform-origin: 50% 100%;
  padding: 0.45em 0.75em;
  opacity: 0;
  pointer-events: none;
  transition: all 0.28s cubic-bezier(0.23, 1, 0.32, 1);
  background: var(--background);
  color: var(--color);
  z-index: 20;
  border-radius: 8px;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: rgba(0, 0, 0, 0.25) 0 8px 15px;
}

.tooltip::before {
  position: absolute;
  content: '';
  height: 0.6em;
  width: 0.6em;
  bottom: -0.2em;
  left: 50%;
  transform: translate(-50%) rotate(45deg);
  background: var(--background);
}

.tooltip-container:hover .tooltip,
.tooltip-container:focus-within .tooltip {
  opacity: 1;
  transform: translateX(-50%) scale(1);
  animation: shake 0.5s ease-in-out both;
}

@keyframes shake {
  0% {
    rotate: 0;
  }

  25% {
    rotate: 7deg;
  }

  50% {
    rotate: -7deg;
  }

  75% {
    rotate: 1deg;
  }

  100% {
    rotate: 0;
  }
}
</style>
