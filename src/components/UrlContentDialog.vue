<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content url-content-dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">URL内容处理</h3>
        <button class="dialog-close" @click="closeDialog">×</button>
      </div>
      
      <div class="dialog-body">
        <div class="content-info">
          <p><strong>检测到题目中包含URL，正在处理为图片显示：</strong></p>
        </div>
        
        <!-- 原始问题显示 -->
        <div class="original-question">
          <h4>原始问题：</h4>
          <div class="question-content">{{ originalQuestion }}</div>
        </div>
        
        <!-- 选项显示（如果有） -->
        <div v-if="originalOptions" class="original-options">
          <h4>选项：</h4>
          <div class="options-content">{{ originalOptions }}</div>
        </div>
        
        <!-- URL处理结果 -->
        <div class="url-processing">
          <h4>URL处理结果：</h4>
          <MarkdownRenderer :content="processedContent" />
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="btn btn-primary" @click="closeDialog">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownRenderer from './MarkdownRenderer.vue'

interface Props {
  visible: boolean
  originalQuestion: string
  originalOptions?: string
  serverResponse: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

// 处理后的内容，将原始问题和选项合并
const processedContent = computed(() => {
  let content = `**问题：** ${props.originalQuestion}\n\n`
  
  if (props.originalOptions) {
    content += `**选项：** ${props.originalOptions}\n\n`
  }
  
  return content
})

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.classList.contains('dialog-overlay')) {
    closeDialog()
  }
}

const closeDialog = () => {
  emit('close')
}
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
  z-index: 1000;
}

.url-content-dialog {
  width: 900px;
  max-width: 95vw;
  max-height: 90vh;
  overflow-y: auto;
}

.dialog-content {
  background: var(--bg-primary);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
}

.dialog-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.dialog-close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dialog-body {
  padding: 20px;
}

.dialog-footer {
  padding: 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
}

.content-info {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 20px;
}

.content-info p {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.original-question,
.original-options {
  margin-bottom: 20px;
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.original-question h4,
.original-options h4 {
  margin: 0 0 12px 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.question-content,
.options-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.url-processing {
  background: var(--bg-secondary);
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  padding: 16px;
}

.url-processing h4 {
  margin: 0 0 16px 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-color-hover);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .url-content-dialog {
    width: 95vw;
    margin: 20px;
  }
  
  .dialog-body {
    padding: 16px;
  }
  
  .original-question,
  .original-options,
  .url-processing {
    padding: 12px;
  }
}
</style>