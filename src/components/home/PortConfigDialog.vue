<template>
  <Teleport to="body">
    <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3 class="dialog-title">配置端口</h3>

        </div>
        
        <div class="dialog-body">
          <div class="form-group">
            <label for="port-input">端口号 (1-65535):</label>
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
        
        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" @click="handleConfirm" :disabled="!isValid">确认</button>
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
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('input') || target.closest('textarea')) {
    return
  }
  
  // 使用 setTimeout 延迟检查文本选择状态，避免时序问题
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }
    
    // 检查是否有任何输入框处于焦点状态
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return
    }
    
    emit('close')
  }, 0)
}

// 当对话框显示时，设置初始值并聚焦输入框
watch(() => props.show, async (show) => {
  if (show) {
    portValue.value = (props.currentPort ?? 8080).toString()
    error.value = ''
    await nextTick()
    portInput.value?.focus()
    portInput.value?.select()
  }
})

// 监听输入变化，实时验证
watch(portValue, validatePort)
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.dialog-content {
  background: var(--bg-secondary);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 400px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-primary);
}

.dialog-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}





.dialog-body {
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  transition: border-color 0.2s;
  -moz-appearance: textfield;
}

.form-input::-webkit-outer-spin-button,
.form-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.error-message {
  margin-top: 8px;
  color: #e53e3e;
  font-size: 12px;
}

.dialog-actions {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-primary);
  justify-content: flex-end;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border: 1px solid var(--dialog-button-secondary-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--dialog-button-secondary-hover-bg);
  color: var(--dialog-button-secondary-hover-text);
}

.btn-primary {
  background: var(--dialog-button-primary-bg);
  color: var(--dialog-button-primary-text);
}

.btn-primary:hover {
  background: var(--dialog-button-primary-hover);
}


</style>
