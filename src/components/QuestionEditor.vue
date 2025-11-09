<template>
  <div v-if="visible" class="modal-overlay" @click="handleOverlayClick">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>添加题目</h2>
        <button class="close-button" @click="$emit('close')" title="关闭">
          ×
        </button>
      </div>
      
      <form @submit.prevent="handleSubmit" class="question-form">
        <div class="form-group">
          <label for="content">题目内容 *</label>
          <textarea
            id="content"
            v-model="formData.content"
            placeholder="请输入题目内容..."
            required
            rows="4"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="answer">答案 *</label>
          <textarea
            id="answer"
            v-model="formData.answer"
            placeholder="请输入答案..."
            required
            rows="6"
          ></textarea>
        </div>

        <div class="form-actions">
          <button type="button" @click="$emit('close')" class="cancel-button">
            取消
          </button>
          <button type="submit" class="submit-button" :disabled="!isFormValid">
            添加题目
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface Props {
  visible: boolean;
  selectedFolderId?: string | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  submit: [data: {
    content: string;
    answer: string;
    folderId: string | null;
  }];
}>();

// 表单数据
const formData = ref({
  content: '',
  answer: ''
});

// 表单验证
const isFormValid = computed(() => {
  return formData.value.content.trim() && formData.value.answer.trim();
});

// 重置表单
const resetForm = () => {
  formData.value = {
    content: '',
    answer: ''
  };
};

// 处理提交
const handleSubmit = () => {
  if (!isFormValid.value) return;
  
  emit('submit', {
    content: formData.value.content.trim(),
    answer: formData.value.answer.trim(),
    folderId: props.selectedFolderId || '0' // 默认使用文件夹ID为0
  });
  
  resetForm();
};

// 处理遮罩层点击
const handleOverlayClick = () => {
  emit('close');
  resetForm();
};

// 监听visible变化，重置表单
watch(() => props.visible, (newVisible) => {
  if (!newVisible) {
    resetForm();
  }
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--question-editor-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--question-editor-modal-bg);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--question-editor-header-border);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--question-editor-header-title);
}

.close-button {
  background: var(--dialog-button-close-bg);
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--dialog-button-close-text);
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-button:hover {
  background-color: var(--dialog-button-close-hover-bg);
  color: var(--dialog-button-close-hover-text);
}

.question-form {
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--question-editor-label-text);
  font-size: 14px;
}

.form-group textarea {
  width: 100%;
  padding: 12px;
  background: var(--question-editor-textarea-bg);
  border: 1px solid var(--question-editor-textarea-border);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: border-color 0.2s;
  resize: none;
  box-sizing: border-box;
  color: var(--question-editor-textarea-text);
}

.form-group textarea:focus {
  outline: none;
  border-color: var(--question-editor-textarea-focus-border);
  box-shadow: 0 0 0 2px var(--question-editor-textarea-focus-shadow);
}

.form-group textarea::placeholder {
  color: var(--question-editor-textarea-placeholder);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--question-editor-actions-border);
}

.cancel-button {
  padding: 10px 20px;
  border: 1px solid var(--dialog-button-secondary-border);
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.cancel-button:hover {
  background-color: var(--dialog-button-secondary-hover-bg);
  border-color: var(--dialog-button-secondary-hover-border);
}

.submit-button {
  padding: 10px 20px;
  border: none;
  background: var(--question-editor-submit-bg);
  color: var(--question-editor-submit-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.submit-button:hover:not(:disabled) {
  background: var(--question-editor-submit-hover-bg);
}

.submit-button:disabled {
  background: var(--question-editor-submit-disabled-bg);
  cursor: not-allowed;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .modal-content {
    width: 95%;
    margin: 20px;
  }
  
  .modal-header,
  .question-form {
    padding: 16px;
  }
  
  .form-actions {
    flex-direction: column;
  }
  
  .cancel-button,
  .submit-button {
    width: 100%;
  }
}
</style>