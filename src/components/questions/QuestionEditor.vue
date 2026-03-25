<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="dialog-panel question-editor-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="handleOverlayClick" title="返回">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">添加题目</h3>
        <button class="btn-confirm" type="button" @click="handleSubmit" :disabled="!isFormValid">
          完成
        </button>
      </div>

      <div class="dialog-body">
        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label class="form-label">题目内容 <span class="required">*</span></label>
            <textarea class="form-textarea" v-model="formData.content" placeholder="请输入题目内容..." rows="4"></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">选项</label>
            <textarea class="form-textarea" v-model="formData.options" placeholder="请输入选项...（可选）" rows="4"></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">答案 <span class="required">*</span></label>
            <textarea class="form-textarea" v-model="formData.answer" placeholder="请输入答案..." rows="4"></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">题目类型</label>
            <div class="type-selector">
              <button
                v-for="t in questionTypes"
                :key="t.value"
                type="button"
                class="type-btn"
                :class="{ active: formData.questionType === t.value }"
                @click="formData.questionType = t.value"
              >{{ t.label }}</button>
            </div>
          </div>
        </form>
      </div>
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
    options?: string;
    answer: string;
    question_type?: string;
    folderId: string | null;
  }];
}>();

const questionTypes = [
  { label: '单选', value: '单选' },
  { label: '多选', value: '多选' },
  { label: '判断', value: '判断' },
  { label: '填空', value: '填空' },
];

// 表单数据
const formData = ref({
  content: '',
  options: '',
  answer: '',
  questionType: '' as string,
});

// 表单验证
const isFormValid = computed(() => {
  return formData.value.content.trim() && formData.value.answer.trim();
});

// 重置表单
const resetForm = () => {
  formData.value = {
    content: '',
    options: '',
    answer: '',
    questionType: '',
  };
};

// 处理提交
const handleSubmit = () => {
  if (!isFormValid.value) return;

  emit('submit', {
    content: formData.value.content.trim(),
    options: formData.value.options.trim() || undefined,
    answer: formData.value.answer.trim(),
    question_type: formData.value.questionType || undefined,
    folderId: props.selectedFolderId || '0',
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

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.question-editor-panel {
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}

.dialog-overlay {
  pointer-events: none;
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
}

.required {
  color: #e53e3e;
}

.type-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.type-btn {
  padding: 7px 18px;
  border: 1px solid var(--platform-config-dialog-header-border);
  border-radius: 20px;
  background: transparent;
  color: var(--platform-config-form-label-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s;
}

.type-btn:hover {
  border-color: var(--platform-config-form-input-focus-border);
  color: var(--platform-config-form-input-focus-border);
}

.type-btn.active {
  background: var(--question-editor-submit-bg);
  border-color: var(--question-editor-submit-bg);
  color: var(--question-editor-submit-text);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .question-editor-panel {
    width: 95%;
  }
}
</style>
