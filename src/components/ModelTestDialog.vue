<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content test-dialog" @click.stop>
      <!-- <div class="dialog-header">
        <h3 class="dialog-title">测试模型: {{ modelName }}</h3>
        <button class="dialog-close" @click="closeDialog">×</button>
      </div> -->
      <div class="dialog-body">
        <!-- 测试进行中 -->
        <div v-if="testing" class="test-status testing">
          <div class="loading-spinner"></div>
          <p>正在测试模型，请稍候...</p>
          <!-- 流式响应显示区域 -->
          <div v-if="streamingResponse" class="streaming-response">
            <div class="response-section">
              <p><strong>实时响应:</strong></p>
              <div class="response-content streaming">
                <MarkdownRender :content="streamingResponse" />
              </div>
            </div>
            <!-- 原始输出内容 -->
            <!-- <div class="raw-response-section">
              <p><strong>原始输出:</strong></p>
              <div class="raw-response-content">{{ streamingResponse }}</div>
            </div> -->
          </div>
          <!-- 流式思考过程显示区域 -->
          <div v-if="streamingReasoning" class="reasoning-section">
            <p class="reasoning-title"><strong>实时思考过程:</strong></p>
            <div class="reasoning-content streaming">
              <MarkdownRender :content="streamingReasoning" />
            </div>
          </div>
        </div>
        
        <!-- 测试成功 -->
        <div v-else-if="testResult && testResult.success" class="test-status success">
          <div class="status-icon">✅</div>
          <h4>测试成功</h4>
          <div class="test-details">
            <p><strong>测试时间:</strong> {{ testResult.timestamp }}</p>
            <p v-if="testResult.testType"><strong>测试类型:</strong> {{ testResult.testType }}</p>
            <p v-if="testResult.modelType"><strong>模型类型:</strong> {{ testResult.modelType === 'vision' ? '视觉模型' : '文本模型' }}</p>
            <div class="response-section">
              <p><strong>模型响应:</strong></p>
              <div class="response-content">
                <MarkdownRender :content="testResult.response" />
              </div>
            </div>
            <!-- 思考过程（reasoning_content）显示 -->
            <div v-if="testResult.reasoning_content" class="reasoning-section">
              <p class="reasoning-title">🧠 思考过程</p>
              <div class="reasoning-content">
                <MarkdownRender :content="testResult.reasoning_content" />
              </div>
            </div>
            <!-- 原始输出内容 -->
            <!-- <div class="raw-response-section">
              <p><strong>原始输出:</strong></p>
              <div class="raw-response-content">{{ testResult.response }}</div>
            </div> -->
          </div>
        </div>
        
        <!-- 测试失败 -->
        <div v-else-if="testError" class="test-status error">
          <div class="status-icon">❌</div>
          <h4>测试失败</h4>
          <div class="error-details">
            <p class="error-message">{{ testError }}</p>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-primary" @click="closeDialog">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'

interface TestResult {
  success: boolean
  response: string
  timestamp: string
  testType?: string
  modelType?: 'text' | 'vision'
  reasoning_content?: string
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
const emit = defineEmits<{
  close: []
  cancelTest: []
}>()

// 打字动画状态
const typingText = ref('')
const isTyping = ref(false)
const typingSpeed = 50 // 毫秒

// 打字动画函数
const typeText = async (text: string, targetRef: any) => {
  if (!text) return
  
  isTyping.value = true
  typingText.value = ''
  
  for (let i = 0; i <= text.length; i++) {
    typingText.value = text.slice(0, i)
    await new Promise(resolve => setTimeout(resolve, typingSpeed))
  }
  
  isTyping.value = false
}

// 流式响应的打字动画
const streamingTypingText = ref('')
watch(() => props.streamingResponse, (newValue) => {
  if (newValue && props.testing) {
    streamingTypingText.value = newValue
  }
}, { immediate: true })

// 测试完成后的打字动画
const finalTypingText = ref('')
watch(() => props.testResult?.response, (newValue) => {
  if (newValue && !props.testing) {
    typeText(newValue, finalTypingText)
  }
}, { immediate: true })

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

// 监听测试状态变化
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    // 弹窗打开时的逻辑
  }
})
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

.test-dialog {
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.dialog-content {
  background: var(--bg-primary);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
  overflow: hidden;
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
  flex: 1;
  overflow-y: auto;
}

.dialog-footer {
  padding: 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
}

.test-status {
  text-align: center;
  padding: 20px;
}

.test-status.testing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
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
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.status-icon {
  font-size: 48px;
  margin-bottom: 10px;
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

.test-details p,
.error-details p {
  margin: 10px 0;
  color: var(--text-secondary);
}

.response-section {
  margin-top: 15px;
}

.response-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  margin-top: 8px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

.response-content.streaming {
  border-color: var(--primary-color);
  background: var(--bg-primary);
  animation: pulse 2s infinite;
}

/* 思考过程样式 */
.reasoning-section {
  margin-top: 16px;
  padding: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.reasoning-title {
  margin: 0 0 8px 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.reasoning-content {
  color: var(--text-primary);
}

.reasoning-content.streaming {
  min-height: 40px;
}

.streaming-response {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
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
  background: var(--dialog-button-primary-bg);
  color: var(--dialog-button-primary-text);
}

.btn-primary:hover {
  background: var(--dialog-button-primary-hover);
}
</style>