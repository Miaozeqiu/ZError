<template>
  <div v-if="visible" class="model-warning__overlay" @click="onOverlay">
    <div class="model-warning__dialog" @click.stop>
      <div class="model-warning__header">
        <div class="model-warning__icon">
          <svg t="1763214359535" class="model-warning__icon-svg" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5469" width="24" height="24">
            <path d="M512 1024C230.4 1024 0 793.6 0 512S230.4 0 512 0s512 230.4 512 512-230.4 512-512 512z m0-938.666667C277.333333 85.333333 85.333333 277.333333 85.333333 512s192 426.666667 426.666667 426.666667 426.666667-192 426.666667-426.666667S746.666667 85.333333 512 85.333333z" fill="currentColor" p-id="5470"></path>
            <path d="M512 652.8c-25.6 0-42.666667-17.066667-42.666667-42.666667V273.066667c0-25.6 17.066667-42.666667 42.666667-42.666667s42.666667 17.066667 42.666667 42.666667v337.066666c0 25.6-17.066667 42.666667-42.666667 42.666667z" fill="currentColor" p-id="5471"></path>
            <path d="M512 746.666667m-42.666667 0a42.666667 42.666667 0 1 0 85.333334 0 42.666667 42.666667 0 1 0-85.333334 0Z" fill="currentColor" p-id="5472"></path>
          </svg>
        </div>
        <div class="model-warning__header-content">
          <h3 class="model-warning__title">还未选择模型</h3>
        </div>
      </div>

      <div class="model-warning__body">
        <div class="model-warning__section">
          <div class="model-warning__content">
            <div class="model-warning__message">
              <p>未选择AI模型，将无法调用AI,只能搜索题库中有的题目，</p>
              <p>请选择一个文本模型以正常使用AI功能</p>
            </div>
          </div>
        </div>
      </div>

      <div class="model-warning__notice-row">
        <div class="model-warning__checkbox">
          <Checkbox v-model="dontRemind" />
          <span>不再提醒</span>
        </div>
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
import Checkbox from '../checkbox.vue'

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

<style scoped>
.model-warning__overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: modelWarningFadeIn 0.2s ease-out;
}
.model-warning__dialog {
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  animation: modelWarningSlideIn 0.3s ease-out;
}
.model-warning__header {
  display: flex;
  align-items: center;
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
}
.model-warning__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
}
.model-warning__icon-svg { display: block; }
.model-warning__title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.model-warning__body { padding: 24px 24px; }
.model-warning__content { background: var(--bg-secondary); border-radius: 8px; padding: 16px; }
.model-warning__message { margin-bottom: 12px; color: var(--text-primary); font-size: 14px; line-height: 1.6; }
.model-warning__footer { display: flex; gap: 12px; padding: 16px 24px 24px; justify-content: flex-end; }
.model-warning__btn { padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
.model-warning__btn--secondary { border: 1px solid var(--dialog-button-secondary-border); background: var(--dialog-button-secondary-bg); color: var(--dialog-button-secondary-text); }
.model-warning__btn--primary { border: none; background: var(--dialog-button-primary-bg); color: var(--dialog-button-primary-text); }
.model-warning__notice-row { display: flex; align-items: center; justify-content: space-between; padding-left: 30px;}
.model-warning__checkbox { display: inline-flex; align-items: center; gap: 8px; color: var(--text-primary); }
@keyframes modelWarningFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes modelWarningSlideIn { from { opacity: 0; transform: translateY(-20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>