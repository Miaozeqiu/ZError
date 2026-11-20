<template>
    <!-- 右侧弹出的请求详情面板 -->
    <div class="request-details-overlay" :class="{ 'show': slideIn }"
      :style="{ width: overlayWidth + 'px' }">
      <!-- 拖拽条 -->
      <div class="resizer" :class="{ active: isResizing }" @mousedown="startResize">
      </div>
      <div class="request-details-header">
        <button type="button" class="back-btn" aria-label="关闭请求详情" title="关闭详情" @click="$emit('close')">
          <svg viewBox="0 0 1536 1024" width="20" height="20" aria-hidden="true">
            <path
              d="M981.418667 71.893333A60.245333 60.245333 0 0 1 1070.506667 152.746667l-3.925334 4.309333L711.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F" opacity=".25"></path>
            <path
              d="M469.418667 71.893333A60.245333 60.245333 0 0 1 558.506667 152.746667l-3.925334 4.309333L199.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F"></path>
          </svg>
        </button>
        <ol class="process-stepper" aria-label="请求处理过程">
          <li v-for="(step, index) in processSteps" :key="step.id" :class="step.state">
            <button type="button" class="process-step-button"
              :aria-label="`${step.label}，${stepStateLabels[step.state]}`"
              :title="`${step.label} · ${stepStateLabels[step.state]}`"
              :aria-pressed="activeTab === step.id"
              @click="activeTab = step.id">
              <span class="process-step-indicator" aria-hidden="true">
                <svg v-if="step.state === 'completed' || step.state === 'no-result' || step.state === 'skipped'"
                  viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                  width="12" height="12">
                  <path :d="step.state === 'completed' ? 'm5 12 4 4L19 6' : 'M6 12h12'" />
                </svg>
                <span v-else>{{ step.state === 'failed' ? '!' : index + 1 }}</span>
              </span>
              <span>{{ step.label }}</span>
            </button>
          </li>
        </ol>
      </div>

      <div class="request-details-content">
        <div class="detail-scroll-wrap">
          <div class="tab-content" ref="contentRef">
            <div v-if="isReceive || activeTab === 'return'" class="exchange-details">
              <section v-if="isReceive" class="exchange-section">
                <h4 class="exchange-title">基本信息</h4>
                <div class="exchange-overview">
                  <dl class="receive-endpoint">
                    <dt>请求 URL</dt>
                    <dd><code>{{ requestUrl }}</code></dd>
                  </dl>
                  <dl class="exchange-meta">
                    <div>
                      <dt>请求方法</dt>
                      <dd><span class="receive-method">{{ log.method }}</span></dd>
                    </div>
                    <div>
                      <dt>HTTP 状态码</dt>
                      <dd>{{ log.httpStatus ?? (log.status == null ? '等待响应…' : '未记录') }}</dd>
                    </div>
                    <div>
                      <dt title="本地服务看到的连接对端">远程地址</dt>
                      <dd>{{ log.remoteAddress ?? '未记录' }}</dd>
                    </div>
                    <div>
                      <dt title="响应头声明的 Referrer-Policy">引荐来源政策</dt>
                      <dd>{{ referrerPolicy || '未记录' }}</dd>
                    </div>
                    <div>
                      <dt>接收时间</dt>
                      <dd>{{ formatTime(log.timestamp) }}</dd>
                    </div>
                    <div>
                      <dt>来源 IP</dt>
                      <dd>{{ log.ip }}</dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section v-else class="exchange-section">
                <h4 class="exchange-title">返回结果</h4>
                <div class="exchange-overview">
                  <dl class="exchange-meta">
                    <div>
                      <dt>状态码</dt>
                      <dd>{{ log.status ?? '处理中…' }}</dd>
                    </div>
                    <div>
                      <dt>响应时间</dt>
                      <dd>{{ log.responseTime == null ? '—' : `${log.responseTime} ms` }}</dd>
                    </div>
                  </dl>
                </div>
                <div v-if="queryResult?.answer || queryResult?.message" class="response-result">
                  <template v-if="queryResult?.answer">
                    <strong>最终返回的答案</strong>
                    <p>{{ queryResult.answer }}</p>
                  </template>
                  <p v-if="queryResult?.message" class="process-note">{{ queryResult.message }}</p>
                </div>
              </section>

              <section class="exchange-section">
                <h4 class="exchange-title">{{ isReceive ? '请求体' : '响应体' }}</h4>
                <JsonCodeViewer v-if="exchangeBody" :key="activeTab" class="exchange-body"
                  :content="formatJSON(exchangeBody)" />
                <p v-else class="exchange-empty">
                  {{ isReceive ? '暂无请求体数据' : log.status ? '暂无响应体记录' : '等待响应体…' }}
                </p>
              </section>

              <section class="exchange-section">
                <div class="exchange-section-heading">
                  <h4 class="exchange-title">{{ isReceive ? '请求头' : '响应头' }}</h4>
                  <span v-if="exchangeHeaders.length" class="exchange-header-count">{{ exchangeHeaders.length }} 项</span>
                </div>
                <dl v-if="exchangeHeaders.length" class="exchange-headers">
                  <div v-for="[name, value] in exchangeHeaders" :key="name" class="exchange-header-row">
                    <dt>{{ name }}</dt>
                    <dd>{{ value }}</dd>
                  </div>
                </dl>
                <p v-else class="exchange-empty">
                  {{ isReceive ? '暂无请求头数据' : log.status ? '暂无响应头记录' : '等待响应头…' }}
                </p>
              </section>
            </div>

            <template v-else>
              <section v-if="activeTab === 'local'" class="exchange-section">
                <div class="exchange-section-heading">
                  <h4 class="exchange-title">本地题库</h4>
                  <span v-if="similarLocalQuestions.length" class="exchange-header-count">
                    {{ similarLocalQuestions.length }} 道相似题
                  </span>
                </div>
                <p class="process-note local-search-note">{{ localSearchText }}</p>
                <ul v-if="similarLocalQuestions.length" class="local-match-list" aria-label="相似题目">
                  <li v-for="match in similarLocalQuestions" :key="match.id" class="local-match-row">
                    <p class="local-match-question">{{ match.question }}</p>
                    <div class="local-match-meta">
                      <span class="local-match-status" :class="match.status ?? 'similar'">
                        {{ localMatchLabels[match.status ?? 'similar'] }}
                      </span>
                      <span class="local-match-score">题干相似度 <strong>{{ formatSimilarity(match.similarity) }}</strong></span>
                    </div>
                    <p v-if="match.rejection_reason" class="process-note local-match-note">{{ match.rejection_reason }}</p>
                  </li>
                </ul>
              </section>

              <section v-else-if="activeTab === 'web'" class="detail-section process-step">
                <HomeSearchTraces :log="log" />
              </section>

              <section v-else-if="activeTab === 'ai'" class="detail-section process-step">
                <!-- ===== URL 题目视觉分析视图 ===== -->
                <template v-if="log.urlQuestion">
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

                <div v-if="answerModels.length > 1" class="multi-model-tabs">
                  <button v-for="model in answerModels" :key="model.modelId" type="button"
                    class="multi-model-tab" :class="{
                      active: selectedAnswerModel?.modelId === model.modelId,
                      loading: model.isLoading,
                      failed: !model.isLoading && isModelResponseErrorText(model.response),
                      success: !model.isLoading && !!model.response?.trim() && !isModelResponseErrorText(model.response),
                    }"
                    :aria-pressed="selectedAnswerModel?.modelId === model.modelId"
                    @click="activeModelTab = model.modelId">
                    <span v-if="model.isLoading" class="loading-spinner-sm" aria-hidden="true"></span>
                    <span>{{ model.modelName }}</span>
                  </button>
                </div>
                <div v-if="selectedAnswerModel" class="model-response-card" :class="{
                  'is-loading': selectedAnswerModel.isLoading,
                  'is-failed': !selectedAnswerModel.isLoading && isModelResponseErrorText(selectedAnswerModel.response),
                }">
                  <div class="model-response-card-header">
                    <div class="model-response-card-title">
                      <span class="card-model-name">{{ selectedAnswerModel.modelName }}</span>
                      <span v-if="selectedAnswerModel.platformName" class="card-platform-name">
                        {{ selectedAnswerModel.platformName }}
                      </span>
                    </div>
                    <div v-if="selectedAnswerModel.isLoading" class="card-loading-badge">
                      <span class="loading-spinner-sm" aria-hidden="true"></span>
                      <span>响应中</span>
                    </div>
                    <span v-else-if="isModelResponseErrorText(selectedAnswerModel.response)" class="card-failed-badge">失败</span>
                    <span v-else class="card-done-badge">完成</span>
                  </div>
                  <div class="model-response-card-body">
                    <AIOutputRender
                      v-if="selectedAnswerModel.reasoningContent || selectedAnswerModel.streamingReasoning || selectedAnswerModel.response"
                      :reasoning-content="selectedAnswerModel.reasoningContent"
                      :streaming-reasoning="selectedAnswerModel.streamingReasoning"
                      :response="selectedAnswerModel.response"
                      :is-loading="selectedAnswerModel.isLoading"
                    />
                    <p v-else class="process-note">{{ selectedAnswerModel.isLoading ? '等待模型响应…' : '暂无响应内容' }}</p>
                    <ModelResponseHint
                      v-if="!selectedAnswerModel.isLoading && isModelResponseErrorText(selectedAnswerModel.response)"
                      :message="selectedAnswerModel.response"
                    />
                  </div>
                </div>
                <p v-else-if="!log.urlQuestion" class="process-note">
                  {{ log.status ? '本次请求没有 AI 处理记录' : '等待 AI 处理…' }}
                </p>
              </section>

              <section v-else-if="activeTab === 'summary'" class="detail-section process-step">
                <div v-for="model in summaryModels" :key="model.modelId" class="model-response-card is-summary"
                  :class="{ 'is-failed': !model.isLoading && isModelResponseErrorText(model.response) }">
                  <div class="model-response-card-header">
                    <span class="card-model-name">{{ model.modelName }}</span>
                    <span v-if="model.isLoading" class="card-loading-badge">总结中…</span>
                    <span v-else-if="isModelResponseErrorText(model.response)" class="card-failed-badge">失败</span>
                    <span v-else class="card-done-badge">完成</span>
                  </div>
                  <div class="model-response-card-body">
                    <AIOutputRender
                      v-if="model.reasoningContent || model.streamingReasoning || model.response"
                      :reasoning-content="model.reasoningContent"
                      :streaming-reasoning="model.streamingReasoning"
                      :response="model.response"
                      :is-loading="model.isLoading"
                    />
                    <p v-else class="process-note">{{ model.isLoading ? '等待总结模型响应…' : '暂无总结内容' }}</p>
                    <ModelResponseHint
                      v-if="!model.isLoading && isModelResponseErrorText(model.response)"
                      :message="model.response"
                    />
                  </div>
                </div>
                <p v-if="!summaryModels.length" class="process-note">暂无总结模型记录</p>
              </section>
            </template>
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
import { defineAsyncComponent, computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ModelResponseHint from '../../components/ui/ModelResponseHint.vue'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import JsonCodeViewer from './JsonCodeViewer.vue'
import HomeSearchTraces from './HomeSearchTraces.vue'
import {
  formatJSON,
  formatTime,
  getQueryResult,
  isModelResponseErrorText,
} from './requestLogDisplay'
import type { MultiModelResponse, RequestLog } from './types'

const AIOutputRender = defineAsyncComponent(() => import('../../components/agent/AIOutputRender.vue').then(module => module.default))

const props = defineProps<{
  log: RequestLog
  slideIn: boolean
}>()

defineEmits<{
  close: []
  'retry-url-analysis': [requestId: string]
}>()

const activeModelTab = ref('')
const overlayWidth = ref(600)
const isResizing = ref(false)

const { contentRef, barRef, thumbRef, visible, enabled, onMousedown, bind, update } = useCustomScrollbar()

const modelResponses = computed<MultiModelResponse[]>(() => {
  const log = props.log
  if (log.multiModelResponses?.length) return log.multiModelResponses
  if (log.urlQuestion || !(log.isModelCalling || log.modelResponse || log.reasoningContent || log.streamingReasoning)) {
    return []
  }
  return [{
    modelId: log.modelInfo?.modelId || '',
    modelName: log.modelInfo?.modelName || 'AI 模型响应',
    platformName: log.modelInfo?.platformName || '',
    response: log.modelResponse || '',
    reasoningContent: log.reasoningContent,
    streamingReasoning: log.streamingReasoning,
    isLoading: !!log.isModelCalling,
  }]
})
const isSummaryModel = (model: MultiModelResponse) => model.modelId.startsWith('summary:') || model.modelName.startsWith('总结:')
const answerModels = computed(() => modelResponses.value.filter(model => !isSummaryModel(model)))
const summaryModels = computed(() => modelResponses.value.filter(isSummaryModel))
const selectedAnswerModel = computed(() =>
  answerModels.value.find(model => model.modelId === activeModelTab.value) ?? answerModels.value[0],
)
const getHeaderValue = (headers: RequestLog['headers'], name: string) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1]

const requestUrl = computed(() => {
  const target = props.log.requestTarget ?? props.log.path
  const host = getHeaderValue(props.log.headers, 'host')
  return host ? `http://${host}${target}` : target
})
const referrerPolicy = computed(() => getHeaderValue(props.log.responseHeaders, 'referrer-policy'))
const queryResult = computed(() => props.log.path === '/query' ? getQueryResult(props.log.responseBody) : undefined)

const similarLocalQuestions = computed(() => props.log.localMatches?.filter(match => match.similarity > 0) ?? [])
const localMatchLabels = { similar: '仅相似', candidate: '已送判断', used: '已采用' }
const similarityPercent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 })
const formatSimilarity = (score: number) => {
  if (score < 0.001) return '<0.1%'
  if (score < 1 && score >= 0.9995) return '>99.9%'
  return similarityPercent.format(score)
}

const localSearchText = computed(() => {
  const log = props.log
  if (log.path !== '/query') return '本次请求不查询本地题库'
  const hasSimilar = similarLocalQuestions.value.length > 0
  switch (log.localSearch) {
    case 'hit': return '命中本地题库'
    case 'miss': return hasSimilar ? '找到相似题，未命中本地答案' : '本地题库未命中'
    case 'failed': return '本地题库查询失败'
    case 'unconfirmed': return '未能确认是否命中本地题库'
    default: return hasSimilar ? '已找到相似题' : log.status ? '暂无题库查询记录' : '等待题库查询结果…'
  }
})

type StepState = 'idle' | 'running' | 'completed' | 'failed' | 'skipped' | 'no-result'

const stepStateLabels: Record<StepState, string> = {
  idle: '暂无记录',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  'no-result': '无结果',
}

const modelStepState = (models: MultiModelResponse[], emptyState: StepState): StepState => {
  if (!models.length) return emptyState
  if (models.some(model => model.isLoading)) return 'running'
  return models.every(model => isModelResponseErrorText(model.response)) ? 'failed' : 'completed'
}

const processSteps = computed(() => {
  const { localSearch, path, status, searchTraces = [], urlQuestion } = props.log
  const unusedStep: StepState = status == null ? 'idle' : 'skipped'
  const local: StepState = path !== '/query' ? 'skipped'
    : localSearch === 'failed' ? 'failed'
    : localSearch === 'hit' || similarLocalQuestions.value.length > 0 ? 'completed'
    : localSearch === 'miss' ? 'no-result'
    : status == null && !localSearch ? 'running' : 'idle'
  const web: StepState = searchTraces.some(trace => trace.status === 'searching') ? 'running'
    : searchTraces.some(trace => trace.status === 'success' && trace.results.length > 0) ? 'completed'
    : searchTraces.some(trace => trace.status === 'success') ? 'no-result'
    : searchTraces.length ? 'failed' : unusedStep
  const ai: StepState = web === 'running' ? 'idle'
    : urlQuestion?.analyzing ? 'running'
    : urlQuestion?.analysisError ? 'failed'
    : urlQuestion?.analysisResult ? 'completed' : modelStepState(answerModels.value, unusedStep)
  const summary = modelStepState(summaryModels.value, unusedStep)
  const returnState: StepState = status == null ? 'idle' : status >= 400 ? 'failed' : 'completed'

  return [
    { id: 'receive', label: '接收', state: 'completed' },
    { id: 'local', label: '本地搜索', state: local },
    { id: 'web', label: '联网搜索', state: web },
    { id: 'ai', label: 'AI 处理', state: ai },
    { id: 'summary', label: '总结', state: summary },
    { id: 'return', label: '返回', state: returnState },
  ] as const
})

type ProcessStepId = typeof processSteps.value[number]['id']
const activeTab = ref<ProcessStepId>('receive')
const isReceive = computed(() => activeTab.value === 'receive')
const exchangeBody = computed(() => isReceive.value ? props.log.requestBody : props.log.responseBody)
const exchangeHeaders = computed(() => {
  const headers = isReceive.value ? props.log.headers : props.log.responseHeaders
  return Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right))
})

watch(() => props.log.id, () => {
  activeModelTab.value = ''
  activeTab.value = 'receive'
})

const bindScroll = async () => {
  await nextTick()
  bind()
  update()
}

onMounted(() => {
  void bindScroll()
})

watch([activeTab, () => props.log.id], () => {
  if (contentRef.value) contentRef.value.scrollTop = 0
}, { flush: 'post' })

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

<style scoped src="./RequestDetailsShared.css"></style>
<style scoped src="./HomeRequestDetails.css"></style>
