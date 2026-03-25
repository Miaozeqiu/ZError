<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel delete-confirm-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">确认删除</h3>
        <button class="btn-danger-confirm" type="button" @click="$emit('confirm')">删除</button>
      </div>

      <div class="dialog-body">
        <div class="confirm-content">
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

watch(() => props.deleteQuestions, (newVal) => {
  deleteQuestions.value = newVal;
});

const emit = defineEmits<{
  'confirm': [];
  'cancel': [];
  'update:deleteQuestions': [value: boolean];
}>();

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.closest('input')) return
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    const activeElement = document.activeElement
    if (activeElement && activeElement.tagName === 'INPUT') return
    emit('cancel')
  }, 0)
};
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.delete-confirm-panel {
  max-width: 440px;
  display: flex;
  flex-direction: column;
}

/* 危险操作确认按钮（红色，对齐 btn-confirm 风格） */
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

/* 警告内容区 */
.confirm-content {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;
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

/* 选项区 */
.dialog-options {
  border-top: 1px solid var(--platform-config-dialog-header-border);
  padding-top: 16px;
}

.checkbox-container {
  display: flex;
  align-items: center;
  cursor: pointer;
  margin-bottom: 10px;
  gap: 8px;
}

.checkbox-container input[type="checkbox"] {
  display: none;
}

.checkmark {
  width: 16px;
  height: 16px;
  border: 2px solid var(--platform-config-icon-display-border);
  border-radius: 3px;
  flex-shrink: 0;
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
  font-size: 11px;
  font-weight: bold;
}

.checkbox-text {
  font-size: 14px;
  color: var(--platform-config-form-label-text);
  user-select: none;
}

.option-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  padding-left: 24px;
}
</style>
