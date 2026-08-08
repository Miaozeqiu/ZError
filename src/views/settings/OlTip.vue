<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  text?: string
}>()

const normalizedText = computed(() => props.text?.trim() ?? '')
const containerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const tooltipStyle = ref<Record<string, string>>({})

const updatePosition = () => {
  const el = containerRef.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  tooltipStyle.value = {
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top - 10}px`,
  }
}

const show = async () => {
  if (!normalizedText.value) return
  visible.value = true
  await nextTick()
  updatePosition()
}

const hide = () => {
  visible.value = false
}

const onScrollOrResize = () => {
  if (visible.value) updatePosition()
}

onMounted(() => {
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})

watch(normalizedText, (text) => {
  if (!text) hide()
})
</script>

<template>
  <div
    ref="containerRef"
    class="tooltip-container"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
    <Teleport to="body">
      <span
        v-if="normalizedText"
        ref="tooltipRef"
        class="ol-tip-tooltip"
        :class="{ visible }"
        :style="tooltipStyle"
      >{{ normalizedText }}</span>
    </Teleport>
  </div>
</template>

<style scoped>
.tooltip-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
</style>

<style>
.ol-tip-tooltip {
  --background: #333333;
  --color: #e8e8e8;
  position: fixed;
  transform: translate(-50%, -100%) scale(0);
  transform-origin: 50% 100%;
  padding: 0.45em 0.75em;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s cubic-bezier(0.23, 1, 0.32, 1), transform 0.28s cubic-bezier(0.23, 1, 0.32, 1);
  background: var(--background);
  color: var(--color);
  z-index: 1100;
  border-radius: 8px;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: rgba(0, 0, 0, 0.25) 0 8px 15px;
}

.ol-tip-tooltip::before {
  position: absolute;
  content: '';
  height: 0.6em;
  width: 0.6em;
  bottom: -0.2em;
  left: 50%;
  transform: translate(-50%) rotate(45deg);
  background: var(--background);
}

.ol-tip-tooltip.visible {
  opacity: 1;
  transform: translate(-50%, -100%) scale(1);
  animation: ol-tip-shake 0.5s ease-in-out both;
}

@keyframes ol-tip-shake {
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
