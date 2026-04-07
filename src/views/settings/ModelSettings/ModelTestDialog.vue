<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel test-dialog-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" @click="closeDialog" title="关闭">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">测试模型：{{ modelName }}</h3>
        <button class="btn-confirm" @click="closeDialog">{{ testing ? '停止' : '关闭' }}</button>
      </div>
      <div class="dialog-body test-dialog-body">
        <!-- 测试进行中 -->
        <div v-if="testing" class="test-status testing">
          <div class="loading-spinner"></div>
          <p class="testing-tip">正在测试模型，请稍候...</p>
          <div v-if="streamingReasoning || streamingResponse" class="content-stack-wrapper">
            <AIOutputRender
              :streaming-reasoning="streamingReasoning"
              :response="streamingResponse"
              :is-loading="true"
            />
          </div>
        </div>
        
        <!-- 测试成功 -->
        <div v-else-if="testResult && testResult.success" class="test-status success">
          <div class="status-icon" aria-hidden="true">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M512 981.333333C252.8 981.333333 42.666667 771.2 42.666667 512S252.8 42.666667 512 42.666667s469.333333 210.133333 469.333333 469.333333-210.133333 469.333333-469.333333 469.333333z m-50.432-326.101333L310.613333 504.32a32 32 0 0 0-45.226666 45.226667l174.72 174.762666a32.341333 32.341333 0 0 0 0.341333 0.341334l0.256 0.213333a32 32 0 0 0 50.048-6.144l337.450667-379.605333a32 32 0 1 0-47.872-42.496l-318.762667 358.613333z" fill="#52C41A" />
            </svg>
          </div>
          <h4>测试成功</h4>
          <div class="test-details">
            <div class="test-meta">
              <p><strong>测试时间:</strong> {{ testResult.timestamp }}</p>
              <p v-if="testResult.testType"><strong>测试类型:</strong> {{ testResult.testType }}</p>
              <p v-if="testResult.modelType"><strong>模型类型:</strong> {{ testResult.modelType === 'vision' ? '视觉模型' : '文本模型' }}</p>
              <p v-if="testResult.tokenRate !== undefined"><strong>平均速度:</strong> {{ formatTokenRate(testResult.tokenRate) }}</p>
            </div>
            <div class="content-stack-wrapper">
              <AIOutputRender
                :reasoning-content="testResult.reasoning_content"
                :response="testResult.response"
              />
            </div>
          </div>
        </div>
        
        <!-- 测试失败 -->
        <div v-else-if="testError" class="test-status error">
          <div class="status-icon" aria-hidden="true">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M512 981.333333C252.8 981.333333 42.666667 771.2 42.666667 512S252.8 42.666667 512 42.666667s469.333333 210.133333 469.333333 469.333333-210.133333 469.333333-469.333333 469.333333z m44.245333-469.333333l159.914667-159.914667a31.274667 31.274667 0 1 0-44.245333-44.245333L512 467.754667 352.085333 307.84a31.274667 31.274667 0 1 0-44.245333 44.245333L467.754667 512l-159.914667 159.914667a31.274667 31.274667 0 1 0 44.245333 44.245333L512 556.245333l159.914667 159.914667a31.274667 31.274667 0 1 0 44.245333-44.245333L556.245333 512z" fill="#F5222D" />
            </svg>
          </div>
          <h4>测试失败</h4>
          <div class="error-details">
            <p class="error-message">{{ testError }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AIOutputRender from '../../../components/AIOutputRender.vue'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'

interface TestResult {
  success: boolean
  response: string
  timestamp: string
  testType?: string
  modelType?: 'text' | 'vision'
  reasoning_content?: string
  tokenRate?: number
}

interface Props {
  visible: boolean
  modelName: string
  testing: boolean
  testResult: TestResult | null
  testError: string
  streamingResponse?: string
  streamingReasoning?: string
}

const props = defineProps<Props>()

const formatTokenRate = (value: number) => `${value.toFixed(1)} tokens/s`

const emit = defineEmits<{
  close: []
  cancelTest: []
}>()

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
    
    closeDialog()
  }, 0)
}

const closeDialog = () => {
  if (props.testing) {
    // 如果正在测试，发出取消测试事件
    emit('cancelTest')
  }
  emit('close')
}

</script>

<style scoped>
@import '../../../styles/dialog.css';

.test-dialog-panel {
  width: min(760px, 92vw);
}

.test-dialog-body {
  max-height: calc(90vh - 96px);
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.test-dialog-body::-webkit-scrollbar {
  width: 0 !important;
  display: none !important;
}

.test-status {
  text-align: center;
  padding: 20px;
}

.test-status.testing {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 15px;
  text-align: left;
}

.test-status.success,
.test-status.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  align-self: center;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.status-icon {
  width: 52px;
  height: 52px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

.test-status h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 600;
}

.test-details,
.error-details {
  width: 100%;
  text-align: left;
  margin-top: 20px;
}

.testing-tip {
  margin: 0;
  color: var(--text-secondary);
  align-self: center;
  text-align: center;
}

.test-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.test-details p,
.error-details p {
  margin: 0;
  color: var(--text-secondary);
}

.test-meta p {
  padding: 12px 14px;
  border: none;
  border-radius: 10px;
}

.test-meta p strong {
  color: var(--text-primary);
}

.content-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 12px;
}

.response-section,
.reasoning-section {
  width: 100%;
  margin-top: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  overflow: visible;
  background: transparent;
  box-shadow: none;
}

.response-section {
  padding-top: 2px;
}

.response-content,
.reasoning-content {
  margin-top: 0;
  line-height: 1.85;
}

.response-content {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 500;
}

.response-content.streaming {
  animation: none;
}

.reasoning-section {
  padding: 8px 0 8px 16px;
  background: transparent;
  border-left: 1px solid var(--border-color);
  border-radius: 0;
}

.streaming-card {
  box-shadow: none;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, var(--text-secondary));
}

.reasoning-title {
  color: var(--text-secondary);
}

.reasoning-content {
  color: var(--text-secondary);
  font-size: 15px;
}

.reasoning-content.streaming {
  min-height: 40px;
}

.reasoning-content :deep(p),
.response-content :deep(p) {
  margin: 0 0 14px;
}

.reasoning-content :deep(p:last-child),
.response-content :deep(p:last-child),
.reasoning-content :deep(ul:last-child),
.response-content :deep(ul:last-child),
.reasoning-content :deep(ol:last-child),
.response-content :deep(ol:last-child),
.reasoning-content :deep(blockquote:last-child),
.response-content :deep(blockquote:last-child) {
  margin-bottom: 0;
}

.reasoning-content :deep(ul),
.response-content :deep(ul),
.reasoning-content :deep(ol),
.response-content :deep(ol) {
  margin: 0 0 14px;
  padding-left: 24px;
}

.reasoning-content :deep(li),
.response-content :deep(li) {
  margin: 6px 0;
}

.reasoning-content :deep(strong),
.response-content :deep(strong) {
  color: inherit;
  font-weight: 700;
}

.reasoning-content :deep(blockquote),
.response-content :deep(blockquote) {
  margin: 0 0 14px;
  padding-left: 14px;
  border-left: 3px solid var(--border-color);
}

.streaming-response {
  box-shadow: none;
}

.raw-response-section {
  margin-top: 16px;
}

.raw-response-content {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  margin-top: 8px;
  color: var(--text-primary);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  resize: vertical;
}

@keyframes pulse {
  0% { border-color: var(--primary-color); }
  50% { border-color: var(--primary-color-light); }
  100% { border-color: var(--primary-color); }
}

.error-message {
  background: var(--bg-secondary);
  border: 1px solid var(--danger-color);
  border-radius: 6px;
  padding: 12px;
  color: var(--danger-color);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}


</style>
