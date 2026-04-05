<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel delete-confirm-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">确认删除模型</h3>
        <button class="btn-danger-confirm" type="button" @click="$emit('confirm')">删除</button>
      </div>

      <div class="dialog-body">
        <div class="confirm-content">
          <div class="warning-icon">⚠️</div>
          <div class="message">
            <p>确定要删除模型 <strong>"{{ modelName }}"</strong> 吗？</p>
            <p class="sub-message">此操作不可撤销，删除后需要重新配置</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  visible: boolean;
  modelName: string;
}

defineProps<Props>();

const emit = defineEmits<{
  'confirm': [];
  'cancel': [];
}>();

const handleOverlayClick = (event: MouseEvent) => {
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || 
      target.closest('input') || target.closest('textarea') || target.closest('select')) {
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
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }
    
    emit('cancel')
  }, 0)
};
</script>

<style>
@import '../../../styles/dialog.css';
</style>

<style scoped>
.dialog-overlay {
  background: var(--platform-config-overlay-bg);
  z-index: 2000;
}

.delete-confirm-panel {
  max-width: 460px;
  display: flex;
  flex-direction: column;
}

.btn-danger-confirm {
  background: var(--dialog-button-danger-bg);
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--dialog-button-danger-text);
  padding: 6px 14px;
  border-radius: 999px;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.btn-danger-confirm:hover {
  opacity: 0.85;
}

.confirm-content {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.warning-icon {
  font-size: 22px;
  flex-shrink: 0;
  line-height: 1.4;
}

.message p {
  margin: 0 0 4px 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--platform-config-dialog-title-text);
}

.sub-message {
  font-size: 12px !important;
  color: var(--text-secondary) !important;
  margin: 0 !important;
}
</style>
