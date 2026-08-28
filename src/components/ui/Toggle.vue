<template>
  <div :class="computedWrapperClass">
    <label :class="computedSwitchClass">
      <input 
        type="checkbox" 
        :checked="modelValue"
        @change="handleChange"
        :disabled="disabled"
        v-bind="$attrs"
      >
      <span :class="computedSliderClass"></span>
    </label>
    <span v-if="label" class="toggle-label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue: boolean
  disabled?: boolean
  label?: string
  size?: 'small' | 'medium' | 'large'
  variant?: 'default' | 'platform' | 'success' | 'warning' | 'danger'
  wrapperClass?: string
  switchClass?: string
  sliderClass?: string
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'change', value: boolean): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'medium',
  variant: 'default'
})

const emit = defineEmits<Emits>()

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const value = target.checked
  emit('update:modelValue', value)
  emit('change', value)
}

// 计算样式类
const computedWrapperClass = computed(() => [
  'toggle-wrapper',
  `toggle-${props.size}`,
  `toggle-${props.variant}`,
  {
    'toggle-disabled': props.disabled
  },
  props.wrapperClass
])

const computedSwitchClass = computed(() => [
  'toggle-switch',
  props.switchClass
])

const computedSliderClass = computed(() => [
  'toggle-slider',
  props.sliderClass
])
</script>

<style scoped>
.toggle-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--toggle-bg, #cbd5e0);
  transition: all 0.2s ease;
  border-radius: 20px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  background-color: var(--toggle-slider, #ffffff);
  transition: all 0.2s ease;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: var(--toggle-active, #3182ce);
}

input:checked + .toggle-slider:before {
  transform: translateX(var(--toggle-translate, 20px));
}

input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.toggle-label {
  font-size: 14px;
  color: var(--text-primary);
  user-select: none;
}

/* 尺寸变体 */
.toggle-small .toggle-switch {
  width: 32px;
  height: 16px;
}

.toggle-small .toggle-slider:before {
  height: 12px;
  width: 12px;
  left: 2px;
  bottom: 2px;
  --toggle-translate: 16px;
}

.toggle-medium .toggle-switch {
  width: 40px;
  height: 20px;
}

.toggle-medium .toggle-slider:before {
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  --toggle-translate: 20px;
}

.toggle-large .toggle-switch {
  width: 48px;
  height: 24px;
}

.toggle-large .toggle-slider:before {
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  --toggle-translate: 24px;
}

/* 颜色变体 */
.toggle-default {
  --toggle-bg: var(--toggle-default-bg, #4a5568);
  --toggle-slider: var(--toggle-default-slider, #ffffff);
  --toggle-active: var(--toggle-default-active, #3182ce);
}

.toggle-platform {
  --toggle-bg: var(--platform-toggle-bg, #e2e8f0);
  --toggle-slider: var(--platform-toggle-slider, #ffffff);
  --toggle-active: var(--platform-toggle-active, #48bb78);
}

.toggle-success {
  --toggle-bg: var(--toggle-success-bg, #cbd5e0);
  --toggle-slider: var(--toggle-success-slider, #ffffff);
  --toggle-active: var(--toggle-success-active, #48bb78);
}

.toggle-warning {
  --toggle-bg: var(--toggle-warning-bg, #cbd5e0);
  --toggle-slider: var(--toggle-warning-slider, #ffffff);
  --toggle-active: var(--toggle-warning-active, #ed8936);
}

.toggle-danger {
  --toggle-bg: var(--toggle-danger-bg, #cbd5e0);
  --toggle-slider: var(--toggle-danger-slider, #ffffff);
  --toggle-active: var(--toggle-danger-active, #e53e3e);
}

/* 悬停效果 */
.toggle-switch:hover .toggle-slider {
  opacity: 0.8;
}

input:checked + .toggle-slider:hover {
  background-color: var(--toggle-active-hover, var(--toggle-active));
}

.toggle-platform input:checked + .toggle-slider:hover {
  background-color: var(--platform-toggle-active-hover, var(--platform-toggle-active));
}
</style>