<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-container" @click.stop>
      <div class="dialog-header">
        <h3>确认删除</h3>
        <button class="close-button" @click="$emit('cancel')">×</button>
      </div>
      
      <div class="dialog-content">
        <div class="warning-icon">⚠️</div>
        <div class="message">
          <p>确定要删除文件夹 <strong>"{{ folderName }}"</strong> 吗？</p>
          <p class="sub-message">此操作不可撤销</p>
        </div>
      </div>
      
      <div class="dialog-options">
        <label class="checkbox-container">
          <input 
            type="checkbox" 
            v-model="deleteQuestions"
            @change="$emit('update:deleteQuestions', deleteQuestions)"
          >
          <span class="checkmark"></span>
          <span class="checkbox-text">同时删除文件夹下的所有题目</span>
        </label>
        <p class="option-description">
          <template v-if="deleteQuestions">
            该文件夹及其所有子文件夹下的题目将被永久删除
          </template>
          <template v-else>
            该文件夹下的题目将转移到
            <template v-if="hasParent">父文件夹的"[未分类]"子文件夹</template>
            <template v-else>默认的"[未分类]"文件夹</template>
          </template>
        </p>
      </div>
      
      <div class="dialog-actions">
        <button class="cancel-button" @click="$emit('cancel')">取消</button>
        <button class="delete-button" @click="$emit('confirm')">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

interface Props {
  visible: boolean;
  folderName: string;
  hasParent: boolean;
  deleteQuestions?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  deleteQuestions: false
});

const deleteQuestions = ref(props.deleteQuestions);

// 监听 props 变化
watch(() => props.deleteQuestions, (newVal) => {
  deleteQuestions.value = newVal;
});

const emit = defineEmits<{
  'confirm': [];
  'cancel': [];
  'update:deleteQuestions': [value: boolean];
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
    
    emit('close')
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
  background: white;
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
  border-bottom: 1px solid #e1e4e8;
  background: #f6f8fa;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #24292e;
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
  color: #24292e;
  font-size: 14px;
  line-height: 1.5;
}

.sub-message {
  color: #586069 !important;
  font-size: 13px !important;
}

.dialog-options {
  padding: 0 20px 20px 20px;
  border-top: 1px solid #e1e4e8;
  margin-top: 0;
  padding-top: 20px;
}

.checkbox-container {
  display: flex;
  align-items: center;
  cursor: pointer;
  margin-bottom: 12px;
}

.checkbox-container input[type="checkbox"] {
  display: none;
}

.checkmark {
  width: 16px;
  height: 16px;
  border: 2px solid #d1d5da;
  border-radius: 3px;
  margin-right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.checkbox-container input[type="checkbox"]:checked + .checkmark {
  background: #0366d6;
  border-color: #0366d6;
}

.checkbox-container input[type="checkbox"]:checked + .checkmark::after {
  content: '✓';
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.checkbox-text {
  font-size: 14px;
  color: #24292e;
  user-select: none;
}

.option-description {
  margin: 0;
  font-size: 13px;
  color: #586069;
  line-height: 1.4;
  padding-left: 24px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid #e1e4e8;
  background: #f6f8fa;
}

.cancel-button, .delete-button {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.2s;
}

.cancel-button {
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border-color: var(--dialog-button-secondary-border);
}

.cancel-button:hover {
  background: var(--dialog-button-secondary-hover-bg);
  border-color: var(--dialog-button-secondary-hover-border);
}

.delete-button {
  background: var(--dialog-button-danger-bg);
  color: var(--dialog-button-danger-text);
  border-color: var(--dialog-button-danger-bg);
}

.delete-button:hover {
  background: var(--dialog-button-danger-hover);
  border-color: var(--dialog-button-danger-hover);
}
</style>