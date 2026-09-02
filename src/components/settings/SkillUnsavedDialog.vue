<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
      <div class="dialog-panel unsaved-panel" role="dialog" aria-modal="true" aria-labelledby="skill-unsaved-title" @click.stop>
        <div class="dialog-header">
          <button type="button" class="btn-back" title="取消" @click="emit('cancel')">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
              <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
            </svg>
          </button>
          <h3 id="skill-unsaved-title" class="dialog-title">{{ title }}</h3>
          <button type="button" class="btn-confirm" :disabled="saving" @click="emit('save')">
            {{ saving ? '保存中…' : saveLabel }}
          </button>
        </div>
        <div class="dialog-body">
          <p class="unsaved-msg">{{ message }}</p>
          <p v-if="detail" class="unsaved-detail">{{ detail }}</p>
          <p v-if="error" class="unsaved-error">{{ error }}</p>
          <button type="button" class="unsaved-discard" :disabled="saving" @click="emit('discard')">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M8 6V5.2C8 4.54 8.54 4 9.2 4h5.6C15.46 4 16 4.54 16 5.2V6M5 7h14M9 10.5v6M12 10.5v6M15 10.5v6M7.5 7l.6 11.2c.06.86.78 1.5 1.64 1.5h4.52c.86 0 1.58-.64 1.64-1.5L16.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ discardLabel }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  message?: string
  detail?: string
  saveLabel?: string
  discardLabel?: string
  saving?: boolean
  error?: string
}>(), {
  title: '未保存的修改',
  message: '离开后当前修改会丢失。',
  detail: '',
  saveLabel: '保存',
  discardLabel: '不保存',
  saving: false,
  error: '',
})

const emit = defineEmits<{
  cancel: []
  save: []
  discard: []
}>()

const handleOverlayClick = () => {
  if (!props.saving) emit('cancel')
}

const onKeydown = (event: KeyboardEvent) => {
  if (!props.visible || props.saving) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
}

watch(() => props.visible, (open) => {
  if (open) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
})

onMounted(() => {
  if (props.visible) window.addEventListener('keydown', onKeydown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.unsaved-panel {
  width: min(420px, 90vw);
  max-width: 420px;
}

.unsaved-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--platform-config-dialog-title-text);
}

.unsaved-detail {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.unsaved-error {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #c2410c;
}

.unsaved-discard {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  margin-top: 18px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dialog-button-danger-bg, #d73a49) 11%, transparent);
  color: var(--dialog-button-danger-bg, #d73a49);
  font-size: 13px;
  font-weight: 550;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease-out;
}

.unsaved-discard svg {
  flex-shrink: 0;
}

.unsaved-discard:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dialog-button-danger-bg, #d73a49) 18%, transparent);
}

.unsaved-discard:active:not(:disabled) {
  transform: scale(0.98);
}

.unsaved-discard:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
