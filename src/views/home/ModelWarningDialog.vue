<template>
  <div v-if="visible" class="dialog-overlay" @click="onOverlay">
    <div class="dialog-panel model-warning-panel" @click.stop>
      <div class="dialog-header">
        <div class="model-warning__heading">
          <div class="model-warning__icon">
            <svg class="model-warning__icon-svg" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
              <path d="M512 1024C230.4 1024 0 793.6 0 512S230.4 0 512 0s512 230.4 512 512-230.4 512-512 512z m0-938.666667C277.333333 85.333333 85.333333 277.333333 85.333333 512s192 426.666667 426.666667 426.666667 426.666667-192 426.666667-426.666667S746.666667 85.333333 512 85.333333z" fill="currentColor"></path>
              <path d="M512 652.8c-25.6 0-42.666667-17.066667-42.666667-42.666667V273.066667c0-25.6 17.066667-42.666667 42.666667-42.666667s42.666667 17.066667 42.666667 42.666667v337.066666c0 25.6-17.066667 42.666667-42.666667 42.666667z" fill="currentColor"></path>
              <path d="M512 746.666667m-42.666667 0a42.666667 42.666667 0 1 0 85.333334 0 42.666667 42.666667 0 1 0-85.333334 0Z" fill="currentColor"></path>
            </svg>
          </div>
          <h3 class="dialog-title">还未选择模型</h3>
        </div>
      </div>

      <div class="dialog-body">
        <div class="model-warning__message">
          <p>未选择 AI 模型，将无法调用 AI，只能搜索题库中已有的题目。</p>
          <p>请选择一个文本模型以正常使用 AI 功能。</p>
        </div>

        <label class="model-warning__checkbox">
          <Checkbox v-model="dontRemind" />
          <span>不再提醒</span>
        </label>
      </div>

      <div class="model-warning__footer">
        <button class="model-warning__btn model-warning__btn--secondary" @click="stillOpen">
          仍然开启
        </button>
        <button class="model-warning__btn model-warning__btn--primary" @click="selectModel">
          选择模型
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Checkbox from '../../components/checkbox.vue'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'still-open', dontRemind: boolean): void
  (e: 'select-model', dontRemind: boolean): void
}>()

const dontRemind = ref(false)

const stillOpen = () => {
  emit('still-open', dontRemind.value)
}
const selectModel = () => {
  emit('select-model', dontRemind.value)
}
const onOverlay = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('input') || target.tagName === 'INPUT') return
  emit('close')
}
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.dialog-overlay {
  background: var(--platform-config-overlay-bg);
  z-index: 2000;
}

.model-warning-panel {
  max-width: 460px;
  display: flex;
  flex-direction: column;
}

.model-warning__heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.model-warning__icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #86868b);
}

.model-warning__icon-svg {
  display: block;
}

.model-warning__message {
  color: var(--platform-config-dialog-title-text, var(--text-primary));
  font-size: 14px;
  line-height: 1.7;
}

.model-warning__message p {
  margin: 0 0 8px;
}

.model-warning__message p:last-child {
  margin-bottom: 0;
}

.model-warning__checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.model-warning__footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px 24px;
  justify-content: flex-end;
}

.model-warning__btn {
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.model-warning__btn--secondary {
  background: var(--bg-tertiary, #e8e8ed);
  color: var(--text-primary, #1d1d1f);
}

.model-warning__btn--secondary:hover {
  background: color-mix(in srgb, var(--bg-tertiary, #e8e8ed) 88%, #000);
}

.model-warning__btn--primary {
  background: var(--dialog-button-primary-bg, #F8B62B);
  color: var(--dialog-button-primary-text, #fff);
}

.model-warning__btn--primary:hover {
  background: var(--dialog-button-primary-hover, #e5a827);
}
</style>
