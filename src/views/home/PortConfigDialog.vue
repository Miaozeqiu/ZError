<template>
  <Teleport to="body">
    <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
      <div class="dialog-panel port-config-panel" @click.stop>
        <div class="dialog-header">
          <button class="btn-back" @click="$emit('close')" title="取消">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
              <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
            </svg>
          </button>
          <h3 class="dialog-title" style="visibility:hidden">配置端口</h3>
          <button class="btn-confirm" @click="handleConfirm" :disabled="!isValid">确认</button>
        </div>

        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">端口号 (1-65535)</label>
            <input
              id="port-input"
              v-model="portValue"
              type="number"
              min="1"
              max="65535"
              class="form-input"
              placeholder="请输入端口号"
              @keyup.enter="handleConfirm"
              ref="portInput"
            />
            <div v-if="error" class="error-message">{{ error }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'

interface Props {
  show: boolean
  currentPort: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  confirm: [port: number]
}>()

const portValue = ref('')
const error = ref('')
const portInput = ref<HTMLInputElement>()

const isValid = computed(() => {
  const port = Number(portValue.value)
  return !isNaN(port) && port >= 1 && port <= 65535
})

const validatePort = () => {
  const port = Number(portValue.value)
  if (!portValue.value) {
    error.value = '请输入端口号'
  } else if (isNaN(port)) {
    error.value = '端口号必须是数字'
  } else if (port < 1 || port > 65535) {
    error.value = '端口号必须在 1-65535 之间'
  } else {
    error.value = ''
  }
}

const handleConfirm = () => {
  validatePort()
  if (isValid.value) {
    emit('confirm', Number(portValue.value))
  }
}

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('input')) return
  setTimeout(() => {
    if (window.getSelection()?.toString()) return
    const active = document.activeElement
    if (active?.tagName === 'INPUT') return
    emit('close')
  }, 0)
}

watch(() => props.show, async (show) => {
  if (show) {
    portValue.value = (props.currentPort ?? 8080).toString()
    error.value = ''
    await nextTick()
    portInput.value?.focus()
    portInput.value?.select()
  }
})

watch(portValue, validatePort)
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.port-config-panel {
  max-width: 400px;
}

.form-input::-webkit-outer-spin-button,
.form-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.form-input {
  -moz-appearance: textfield;
}

.error-message {
  margin-top: 6px;
  color: var(--color-error);
  font-size: 12px;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
