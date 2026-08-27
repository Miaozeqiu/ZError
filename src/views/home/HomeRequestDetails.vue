<template>
    <!-- 右侧弹出的请求详情面板 -->
    <div class="request-details-overlay" :class="{ 'show': slideIn }"
      :style="{ width: overlayWidth + 'px' }">
      <!-- 拖拽条 -->
      <div class="resizer" :class="{ active: isResizing }" @mousedown="startResize">
      </div>
      <div class="request-details-header">
        <button class="back-btn" @click="$emit('close')">
          <svg t="1760584170728" class="icon" viewBox="0 0 1536 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
            p-id="13220" width="20" height="20">
            <path
              d="M981.418667 71.893333A60.245333 60.245333 0 0 1 1070.506667 152.746667l-3.925334 4.309333L711.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F" opacity=".25" p-id="13221"></path>
            <path
              d="M469.418667 71.893333A60.245333 60.245333 0 0 1 558.506667 152.746667l-3.925334 4.309333L199.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F" p-id="13222"></path>
          </svg>
        </button>
        <h3>请求详情</h3>
      </div>

      <div class="request-details-content">
        <!-- 标签页导航 -->
        <div class="detail-tabs">
          <button class="tab-button" :class="{ active: activeTab === 'modelResponse' }"
            @click="activeTab = 'modelResponse'">
            AI 模型响应
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'requestBody' }"
            @click="activeTab = 'requestBody'">
            请求体
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'responseBody' }"
            @click="activeTab = 'responseBody'">
            响应体
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'">
            基本信息
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'headers' }" @click="activeTab = 'headers'">
            请求头
          </button>
        </div>

        <!-- 标签页内容 -->
        <div class="detail-scroll-wrap">
          <div class="tab-content" ref="contentRef">

          <!-- 基本信息 -->
          <div v-if="activeTab === 'basic'" class="detail-section">
            <div class="detail-grid">
              <div class="detail-item">
                <label>时间:</label>
                <span>{{ log ? formatTime(log.timestamp) : '' }}</span>
              </div>
              <div class="detail-item">
                <label>方法:</label>
                <span :class="['method-badge', log ? log.method.toLowerCase() : '']">{{ log ?
                  log.method : '' }}</span>
              </div>
              <div class="detail-item">
                <label>路径:</label>
                <span>{{ log ? log.path : '' }}</span>
              </div>
              <div class="detail-item">
                <label>状态码:</label>
                <span v-if="log && log.status"
                  :class="['status-text', getStatusClass(log.status)]">{{ log.status }}</span>
                <span v-else class="status-text pending">处理中...</span>
              </div>
              <div class="detail-item">
                <label>IP地址:</label>
                <span>{{ log ? log.ip : '' }}</span>
              </div>
              <div class="detail-item">
                <label>响应时间:</label>
                <span v-if="log && log.responseTime">{{ log.responseTime }}ms</span>
                <span v-else class="pending">-</span>
              </div>
            </div>
          </div>

          <!-- 请求头 -->
          <div v-if="activeTab === 'headers'" class="detail-section">
            <div v-if="log && log.headers && Object.keys(log.headers).length > 0"
              class="headers-content">
              <div v-for="(value, key) in log.headers" :key="key" class="header-item">
                <strong>{{ key }}:</strong> {{ value }}
              </div>
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">暂无请求头数据</span>
            </div>
          </div>

          <!-- 请求体 -->
          <div v-show="activeTab === 'requestBody'" class="detail-section">
            <div v-if="log && log.requestBody">
              <JsonCodeViewer :content="formatJSON(log.requestBody)" />
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">暂无请求体数据</span>
            </div>
          </div>

          <!-- 响应体 -->
          <div v-show="activeTab === 'responseBody'" class="detail-section">
            <div v-if="log && log.responseBody">
              <JsonCodeViewer :content="formatJSON(log.responseBody)" />
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">
                <span v-if="log && !log.status">处理中，响应体暂未生成...</span>
                <span v-else>暂无响应体数据</span>
              </span>
            </div>
          </div>

          <!-- 模型响应部分 -->
          <div v-if="activeTab === 'modelResponse'" class="detail-section">

            <!-- ===== URL 题目视觉分析视图 ===== -->
            <template v-if="log && log.urlQuestion">
              <div class="url-analysis-panel">
                <!-- 题目图片区域：URL 转 base64 后渲染 -->
                <div class="url-image-box">
                  <div v-if="log.urlQuestion.renderedHtml" class="url-image-ready"
                    v-html="log.urlQuestion.renderedHtml"></div>
                  <div v-else class="loading-indicator">
                    <div class="loading-spinner"></div>
                    <span>图片加载中...</span>
                  </div>
                </div>

                <!-- 分析结果区域 -->
                <div class="url-analysis-result">
                  <div v-if="log.urlQuestion.analyzing">
                    <div v-if="!log.urlQuestion.streamingResponse && !log.urlQuestion.streamingReasoning" class="loading-indicator">
                      <div class="loading-spinner"></div>
                      <span>视觉模型分析中...</span>
                    </div>
                    <div v-if="log.urlQuestion.streamingResponse || log.urlQuestion.streamingReasoning" class="content-stack-wrapper">
                      <AIOutputRender 
                        :streaming-reasoning="log.urlQuestion.streamingReasoning" 
                        :response="log.urlQuestion.streamingResponse" 
                        :is-loading="true" 
                      />
                    </div>
                  </div>
                  <div v-else-if="log.urlQuestion.analysisResult || log.urlQuestion.reasoningContent">
                    <div class="content-stack-wrapper">
                      <AIOutputRender 
                        :reasoning-content="log.urlQuestion.reasoningContent" 
                        :response="log.urlQuestion.analysisResult || ''" 
                      />
                    </div>
                  </div>
                  <div v-else-if="log.urlQuestion.analysisError" class="url-analysis-error">
                    <span>{{ log.urlQuestion.analysisError }}</span>
                    <button class="retry-btn-sm" @click="$emit('retry-url-analysis', log.id)">重试</button>
                  </div>
                  <div v-else class="no-data">
                    <span class="no-data-text">暂无分析结果</span>
                  </div>
                </div>

              </div>
            </template>

            <!-- ===== 多模型切换视图 ===== -->
            <template
              v-if="log && log.multiModelResponses && log.multiModelResponses.length > 0 && !log.urlQuestion">
              <!-- 横向模型选择器 -->
              <div class="multi-model-tabs">
                <button v-for="mr in log.multiModelResponses" :key="mr.modelId" class="multi-model-tab" :class="{
                  active: activeModelTab === mr.modelId,
                  loading: mr.isLoading,
                  summary: mr.modelName.startsWith('总结:'),
                  failed: !mr.isLoading && isModelResponseErrorText(mr.response)
                }" @click="activeModelTab = mr.modelId">
                  <div v-if="mr.isLoading" class="loading-spinner-sm"></div>
                  <svg v-else-if="mr.modelName.startsWith('总结:')" width="12" height="12" viewBox="0 0 1024 1024"
                    xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                      fill="currentColor"></path>
                  </svg>


                  <span>{{ mr.modelName }}</span>
                </button>
              </div>

              <!-- 当前选中模型的响应内容 -->
              <template v-for="mr in log.multiModelResponses" :key="mr.modelId">
                <div
                  v-if="activeModelTab === mr.modelId || (!activeModelTab && log.multiModelResponses[0].modelId === mr.modelId)"
                  class="model-response-card"
                  :class="{
                    'is-loading': mr.isLoading,
                    'is-summary': mr.modelName.startsWith('总结:'),
                    'is-failed': !mr.isLoading && isModelResponseErrorText(mr.response)
                  }">
                  <div class="model-response-card-header">
                    <div class="model-response-card-title">
                      <div v-if="mr.modelName.startsWith('总结:')" class="summary-result-icon" title="最终总结答案">
                        <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                            fill="currentColor"></path>
                        </svg>

                      </div>

                      <span class="card-model-name">{{ mr.modelName }}</span>

                      <span class="card-platform-name">{{ mr.platformName }}</span>
                      <span v-if="mr.modelName.startsWith('总结:')" class="summary-tag">最终答案</span>
                    </div>
                    <div v-if="mr.isLoading" class="card-loading-badge">
                      <div class="loading-spinner-sm"></div>
                      <span>响应中</span>
                    </div>
                    <div v-else-if="isModelResponseErrorText(mr.response)" class="card-failed-badge">✗ 失败</div>
                    <div v-else class="card-done-badge">✓ 完成</div>
                  </div>
                  <div class="model-response-card-body">
                    <div v-if="mr.reasoningContent || mr.streamingReasoning || mr.response" class="content-stack-wrapper">
                      <AIOutputRender 
                        :reasoning-content="mr.reasoningContent" 
                        :streaming-reasoning="mr.streamingReasoning" 
                        :response="mr.response" 
                        :is-loading="mr.isLoading" 
                      />
                    </div>
                    <div v-else-if="mr.isLoading" class="card-waiting">
                      <div class="loading-dots"><span></span><span></span><span></span></div>
                    </div>
                    <div v-else class="no-data"><span class="no-data-text">暂无响应</span></div>
                  </div>

                </div>
              </template>
            </template>

            <!-- ===== 单模型视图（卡片化显示） ===== -->
            <template v-else-if="!log?.urlQuestion">
              <div
                v-if="log && (log.isModelCalling || log.modelResponse || log.reasoningContent || log.streamingReasoning)"
                class="model-response-card"
                :class="{
                  'is-loading': !!log.isModelCalling,
                  'is-summary': !!(log.modelInfo && log.modelInfo.modelName.startsWith('总结:')),
                  'is-failed': !log.isModelCalling && isModelResponseErrorText(log.modelResponse)
                }">
                <div class="model-response-card-header">
                  <div class="model-response-card-title">
                    <div
                      v-if="log.modelInfo && log.modelInfo.modelName.startsWith('总结:')"
                      class="summary-result-icon"
                      title="最终总结答案">
                      <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                          fill="currentColor"></path>
                      </svg>
                    </div>

                    <span class="card-model-name">{{ log.modelInfo?.modelName || 'AI 模型响应' }}</span>
                    <span v-if="log.modelInfo?.platformName" class="card-platform-name">{{ log.modelInfo.platformName }}</span>
                    <span
                      v-if="log.modelInfo && log.modelInfo.modelName.startsWith('总结:')"
                      class="summary-tag">最终答案</span>
                  </div>
                  <div v-if="log.isModelCalling" class="card-loading-badge">
                    <div class="loading-spinner-sm"></div>
                    <span>响应中</span>
                  </div>
                  <div v-else-if="isModelResponseErrorText(log.modelResponse)" class="card-failed-badge">✗ 失败</div>
                  <div v-else class="card-done-badge">✓ 完成</div>
                </div>
                <div class="model-response-card-body">
                  <div v-if="log.reasoningContent || log.streamingReasoning || log.modelResponse" class="content-stack-wrapper">
                    <AIOutputRender 
                      :reasoning-content="log.reasoningContent" 
                      :streaming-reasoning="log.streamingReasoning" 
                      :response="log.modelResponse" 
                      :is-loading="log.isModelCalling" 
                    />
                  </div>
                  <div v-else-if="log.isModelCalling" class="card-waiting">
                    <div class="loading-dots"><span></span><span></span><span></span></div>
                  </div>
                  <div v-else class="no-data"><span class="no-data-text">暂无响应</span></div>
                </div>

              </div>
              <div v-else class="no-data">
                <span class="no-data-text">
                  <span v-if="log && !log.status">等待AI模型响应...</span>
                  <span v-else>暂无AI模型响应数据</span>
                </span>
              </div>
            </template>

          </div>
          </div>
          <div class="custom-scrollbar" :class="{ 'is-visible': visible, 'has-overflow': enabled }"

            ref="barRef" @mousedown="onMousedown">
            <div class="custom-scrollbar-thumb" ref="thumbRef"></div>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AIOutputRender from '../../components/AIOutputRender.vue'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import JsonCodeViewer from './JsonCodeViewer.vue'
import {
  formatJSON,
  formatTime,
  getStatusClass,
  isModelResponseErrorText,
} from './requestLogDisplay'
import type { RequestLog } from './types'

const props = defineProps<{
  log: RequestLog
  slideIn: boolean
}>()

defineEmits<{
  close: []
  'retry-url-analysis': [requestId: string]
}>()

const activeTab = ref('basic')
const activeModelTab = ref(props.log.multiModelResponses?.[0]?.modelId || '')
const overlayWidth = ref(600)
const isResizing = ref(false)

const { contentRef, barRef, thumbRef, visible, enabled, onMousedown, bind, update } = useCustomScrollbar()

watch(() => props.log.urlQuestion, (q) => {
  if (q) activeTab.value = 'modelResponse'
})

watch(() => props.log.id, (id) => {
  activeModelTab.value = props.log.multiModelResponses?.[0]?.modelId || ''
  void id
})

watch(
  () => props.log.multiModelResponses?.[0]?.modelId,
  (modelId) => {
    if (modelId && !activeModelTab.value) activeModelTab.value = modelId
  },
)

const bindScroll = async () => {
  await nextTick()
  bind()
  update()
}

onMounted(() => {
  void bindScroll()
})

watch([activeTab, activeModelTab, overlayWidth, () => props.log.id], () => {
  void bindScroll()
})

const startResize = (event: MouseEvent) => {
  isResizing.value = true
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.classList.add('resizing')
  event.preventDefault()
}

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) return
  const newWidth = window.innerWidth - event.clientX
  const minWidth = 300
  const maxWidth = window.innerWidth * 0.8
  if (newWidth >= minWidth && newWidth <= maxWidth) {
    overlayWidth.value = newWidth
  }
}

const stopResize = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.classList.remove('resizing')
}

onUnmounted(() => {
  stopResize()
})
</script>

<style scoped>
/* 右侧弹出请求详情面板样式 */
.request-details-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--bg-primary);
  box-shadow: -2px 0 8px var(--request-details-shadow);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 初始状态：完全隐藏在右侧 */
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 显示状态：滑入到正常位置 */
.request-details-overlay.show {
  transform: translateX(0);
}

/* 拖拽条样式 */
.resizer {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background-color: transparent;
  cursor: ew-resize;
  z-index: 1001;
  transition: background-color 0.2s ease;
}

.resizer:hover {
  background-color: var(--request-details-resizer-hover);
}

.resizer.active {
  background-color: var(--request-details-resizer-active);
}

/* 拖拽时的全局样式 */
body.resizing {
  cursor: ew-resize !important;
  user-select: none;
}

.request-details-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  gap: 12px;
  flex-shrink: 0;
}

.request-details-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--request-details-header-text);
  flex: 1;
}

.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--request-details-back-btn-text);
  /* 图标路径默认朝左；用 CSS 翻转（勿写在 SVG transform 上，Mac/Windows 表现不一致） */
  transform: scaleX(-1);
}

.back-btn:hover {
  background-color: var(--request-details-back-btn-hover);
}

.request-details-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: hidden;
  /* 仅让下方内容区滚动，标签固定 */
  padding: 0;
  /* 将内边距下移到 tab-content，避免滚动裁剪 */
}

/* 标签页导航样式 */
.detail-tabs {
  display: flex;
  border-bottom: 1px solid var(--bg-primary);
  margin-bottom: 0;
  /* 下方内容区自身有内边距 */
  gap: 4px;
  padding: 0 24px;
  /* 与内容区内边距对齐 */
}

.tab-button {
  padding: 12px 20px;
  border: none;
  background: transparent;
  color: var(--request-details-tab-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.tab-button::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 3px;
  background: var(--request-details-tab-active);
  transition: all 0.2s ease;
  transform: translateX(-50%);
}



.tab-button:hover::after {
  width: 20%;
}

.tab-button.active::after {
  width: 40%;
}


/* 标签页内容样式 */
.detail-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-content {
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 24px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tab-content::-webkit-scrollbar,
.tab-content::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  top: 8px;
  right: 6px;
  bottom: 8px;
  width: 6px;
  border-radius: 999px;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.has-overflow {
  pointer-events: auto;
}

.custom-scrollbar.is-visible.has-overflow {
  opacity: 1;
}

.custom-scrollbar-thumb {
  position: absolute;
  top: 0;
  right: 1px;
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s ease;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}


.detail-section {
  margin-bottom: 24px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section h4 {
  font-size: 16px;
  font-weight: 600;
  color: var(--request-details-section-title);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--request-details-section-border);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-item label {
  font-weight: 500;
  color: var(--request-details-label-text);
  min-width: 80px;
}

.detail-item span {
  color: var(--request-details-value-text);
}

.headers-content {
  background: var(--request-details-headers-bg);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--request-details-headers-border);
}

.header-item {
  margin-bottom: 8px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  color: var(--request-details-headers-text);
}

.header-item:last-child {
  margin-bottom: 0;
}

.header-item strong {
  color: var(--request-details-headers-strong);
}

.code-content {
  background: var(--request-details-code-bg);
  color: var(--request-details-code-text);
  border-radius: 8px;
  padding: 16px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid var(--request-details-code-border);
  overflow-y: auto;
}

.no-logs {
  text-align: center;
  padding: 60px 20px;
  color: var(--request-details-label-text);
}

.no-logs-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  opacity: 0.5;
}

.no-logs p {
  margin: 0;
  font-size: 16px;
}

/* 模型响应相关样式 */
/* 模型信息样式 */
.model-info {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--request-details-basic-bg);
  border-radius: 8px;
  border: 1px solid var(--request-details-basic-border);
}

.model-info-header {
  margin-bottom: 12px;
}

.model-info-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--request-details-label-text);
}

.model-info-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-info-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-info-item label {
  font-weight: 500;
  color: var(--request-details-label-text);
  min-width: 60px;
  font-size: 13px;
}

.model-info-item span {
  color: var(--request-details-value-text);
  font-size: 13px;
  font-family: 'Courier New', monospace;
}

.model-calling {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--request-details-model-calling-bg);
  border-radius: 8px;
  color: var(--request-details-model-calling-text);
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.streaming-response {
  position: relative;
  margin-top: 12px;
}

.streaming-response .code-content.streaming {
  background: var(--request-details-streaming-bg);
  border-color: var(--request-details-streaming-border);
  color: var(--request-details-streaming-text);
  padding-right: 20px;
}





/* 无数据提示样式 */
.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background: var(--request-details-headers-bg);
  border-radius: 8px;
  border: 1px solid var(--request-details-headers-border);
}

.no-data-text {
  color: var(--request-details-label-text);
  font-size: 14px;
  opacity: 0.7;
  font-style: italic;
}
/* 多模型对比视图 */
.multi-model-header {
  margin-bottom: 16px;
}

.multi-model-comparison {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 横向模型切换 tab */
.multi-model-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.multi-model-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 20px;
  background: var(--multi-model-tab-bg);
  color: var(--multi-model-tab-text);
  box-shadow: var(--multi-model-tab-shadow);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
}

.multi-model-tab:hover {
  background: var(--multi-model-tab-hover-bg);
  border-color: var(--multi-model-tab-hover-border);
  color: var(--multi-model-tab-hover-text);
  box-shadow: var(--multi-model-tab-hover-shadow);
  transform: translateY(-1px);
}

.multi-model-tab.active {
  background: var(--multi-model-tab-active-bg);
  border-color: var(--multi-model-tab-active-border);
  color: var(--multi-model-tab-active-text);
  box-shadow: var(--multi-model-tab-active-shadow);
}

.multi-model-tab.summary {
  background: var(--multi-model-tab-summary-bg);
  color: var(--multi-model-tab-summary-text);
  box-shadow: none;
}

.multi-model-tab.summary:hover {
  background: var(--multi-model-tab-summary-hover-bg);
  border-color: var(--multi-model-tab-summary-hover-border);
  color: var(--multi-model-tab-summary-hover-text);
  box-shadow: none;
}

.multi-model-tab.summary.active {
  background: var(--multi-model-tab-summary-active-bg);
  border-color: var(--multi-model-tab-summary-active-border);
  color: var(--multi-model-tab-summary-active-text);
  box-shadow: var(--multi-model-tab-active-shadow), var(--multi-model-tab-summary-active-glow);
}


.multi-model-tab.loading {
  opacity: 0.75;
}

.multi-model-tab.failed {
  background: var(--multi-model-tab-failed-bg);
  color: var(--multi-model-tab-failed-text);
  box-shadow: none;
}



.multi-model-tab.failed:hover {
  background: var(--multi-model-tab-failed-hover-bg);
  color: var(--multi-model-tab-failed-hover-text);
  box-shadow: inset 0 0 0 1px var(--multi-model-tab-failed-hover-border), var(--multi-model-tab-failed-shadow);
}

.multi-model-tab.failed.active {
  background: var(--multi-model-tab-failed-active-bg);
  color: var(--multi-model-tab-failed-active-text);
  box-shadow: inset 0 0 0 1px var(--multi-model-tab-failed-active-border), var(--multi-model-tab-failed-active-shadow);
}

.model-response-card {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid transparent;
  background: var(--model-response-card-bg);
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
}

.model-response-card.is-loading {
  border-color: transparent;
  box-shadow: none;
}

.model-response-card.is-summary {
  background: var(--model-response-card-summary-bg);
}

.model-response-card.is-summary .model-response-card-header {
  background: var(--model-response-card-summary-header-bg);
}

.model-response-card.is-summary .model-response-card-header::after {
  background: var(--model-response-card-summary-divider);
}

.summary-result-icon {
  color: var(--model-response-card-summary-accent);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.summary-tag {
  background: var(--model-response-card-summary-tag-bg);
  color: var(--model-response-card-summary-tag-text);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
}

.model-response-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  gap: 12px;
  position: relative;
}

.model-response-card-header::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 1px;
  background: var(--model-response-card-divider);
}

.model-response-card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.card-model-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--model-response-card-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-platform-name {
  font-size: 11px;
  color: var(--model-response-card-muted-text);
  opacity: 0.7;
  white-space: nowrap;
}

.card-loading-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--model-response-card-muted-text);
  flex-shrink: 0;
}

.card-failed-badge {
  font-size: 12px;
  color: #ef4444;
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}

.model-response-card.is-failed {
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.28);
}

.card-done-badge {
  font-size: 12px;
  color: var(--model-response-card-success-text);
  font-weight: 500;
  flex-shrink: 0;
}

.model-response-card-body {
  padding: 14px 16px;
}



/* Small spinner for card header */
.loading-spinner-sm {
  width: 12px;
  height: 12px;
  border: 2px solid var(--model-response-card-spinner-track);
  border-top-color: var(--model-response-card-spinner-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

/* Loading dots for card waiting state */
.card-waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
}

.loading-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}

.loading-dots span {
  width: 7px;
  height: 7px;
  background: var(--model-response-card-muted-text);
  border-radius: 50%;
  opacity: 0.4;
  animation: dot-pulse 1.2s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-pulse {

  0%,
  80%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }

  40% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* 思考过程展示参考 ModelTestDialog */
.content-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  border-left: 1px solid var(--model-response-card-divider);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--model-response-card-muted-text);
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


/* URL 题目视觉分析面板 */
.url-analysis-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.url-image-box {
  background: var(--bg-tertiary, #f8f9fa);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.url-rendered-image {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.url-analysis-result {
  min-height: 40px;
}

.url-analysis-error {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #e74c3c;
  font-size: 13px;
}

.retry-btn-sm {
  padding: 3px 10px;
  border: 1px solid var(--color-primary, #007acc);
  background: transparent;
  color: var(--color-primary, #007acc);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.15s;
}

.retry-btn-sm:hover {
  background: var(--color-primary, #007acc);
  color: white;
}
</style>
