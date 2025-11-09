<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-container" @click.stop>
      <div class="dialog-header">
        <h3>确认删除模型</h3>
        <button class="close-button" @click="$emit('cancel')">×</button>
      </div>
      
      <div class="dialog-content">
        <div class="warning-icon">⚠️</div>
        <div class="message">
          <p>确定要删除模型 <strong>"{{ modelName }}"</strong> 吗？</p>
          <p class="sub-message">此操作不可撤销，删除后需要重新配置</p>
        </div>
      </div>
      
      <div class="dialog-actions">
        <button class="cancel-button" @click="$emit('cancel')">取消</button>
        <button class="delete-button" @click="$emit('confirm')">删除</button>
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
  z-index: 2000;
}

.dialog-container {
  background: var(--bg-primary);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  min-width: 400px;
  max-width: 500px;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-button {
  background: var(--dialog-button-close-bg);
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--dialog-button-close-text);
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-button:hover {
  background: var(--dialog-button-close-hover-bg);
  color: var(--dialog-button-close-hover-text);
}

.dialog-content {
  padding: 20px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.warning-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.message {
  flex: 1;
}

.message p {
  margin: 0 0 8px 0;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
}

.sub-message {
  color: var(--text-secondary) !important;
  font-size: 13px !important;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.cancel-button, .delete-button {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.2s ease;
}

.cancel-button {
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border-color: var(--dialog-button-secondary-border);
}

.cancel-button:hover {
  background: var(--dialog-button-secondary-hover-bg);
  color: var(--dialog-button-secondary-hover-text);
  border-color: var(--dialog-button-secondary-hover-border);
}

.delete-button {
  background: #dc3545;
  color: white;
  border-color: #dc3545;
}

.delete-button:hover {
  background: #c82333;
  border-color: #bd2130;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(220, 53, 69, 0.3);
}
</style>