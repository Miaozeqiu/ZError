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
          <button class="tab-button" :class="{ active: activeTab === 'search' }" @click="activeTab = 'search'">
            联网搜索
          </button>
        </div>

        <!-- 标签页内容 -->
        <div class="detail-scroll-wrap">
          <div class="tab-content" ref="contentRef">

          <HomeSearchTraces v-if="activeTab === 'search'" :log="log" />

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
import AIOutputRender from '../../components/agent/AIOutputRender.vue'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import JsonCodeViewer from './JsonCodeViewer.vue'
import HomeSearchTraces from './HomeSearchTraces.vue'
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

<style scoped src="./HomeRequestDetails.css"></style>
