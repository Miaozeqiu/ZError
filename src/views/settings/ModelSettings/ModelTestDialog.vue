<template>
  <div v-if="visible" class="dialog-overlay" @click.self="handleOverlayClick">
    <section
      ref="dialogPanel"
      class="dialog-panel test-dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-test-title"
      tabindex="-1"
      @keydown.esc.stop.prevent="closeDialog"
    >
      <button
        type="button"
        class="dialog-close test-dialog-close"
        :title="closeLabel"
        :aria-label="closeLabel"
        @click="closeDialog"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M12 4 4 12m0-8 8 8" />
        </svg>
      </button>
      <header class="test-header">
        <h3 id="model-test-title" class="dialog-title">模型测试</h3>
        <div class="test-model">
          <span class="test-model-name" :title="modelName">{{ modelName }}</span>
          <span v-if="metrics" class="test-kind">{{ metrics.modelType === 'vision' ? '图像理解' : '文本对话' }}</span>
        </div>
      </header>

      <dl class="test-metrics" aria-label="测试指标">
        <div v-for="metric in metricItems" :key="metric.label" class="test-metric" :title="metric.hint">
          <dt>{{ metric.label }}</dt>
          <dd>
            <span :class="{ 'metric-unavailable': metric.value === undefined }">{{ metric.value ?? '—' }}</span>
            <span v-if="metric.value !== undefined && metric.unit" class="metric-unit">{{ metric.unit }}</span>
          </dd>
        </div>
      </dl>

      <div class="test-output">
        <div class="test-output-header">
          <h4>模型输出</h4>
          <span class="test-status" :class="statusKind" role="status">
            <span v-if="testing" class="status-spinner" aria-hidden="true"></span>
            <svg v-else-if="testError" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M8 3.5v5m0 3.5h.01" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m3.5 8 3 3 6-6" />
            </svg>
            {{ statusText }}
          </span>
        </div>

        <div ref="outputViewport" class="test-output-scroll" tabindex="0" aria-label="模型输出内容" @scroll.passive="updateFollowOutput">
          <div ref="outputBody" class="test-output-body">
            <template v-if="testError && !testing">
              <p class="test-error">{{ testError }}</p>
              <ModelResponseHint :message="testError" />
            </template>
            <AIOutputRender
              v-else-if="outputReasoning || outputResponse"
              class="test-output-render"
              :reasoning-content="outputReasoning"
              :response="outputResponse"
              :is-loading="testing"
            />
            <div v-else-if="testing" class="test-skeleton" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, computed, ref, watch } from 'vue'
import ModelResponseHint from '../../../components/ui/ModelResponseHint.vue'
import type { ModelTestMetrics, ModelTestResult } from './testModel'

const AIOutputRender = defineAsyncComponent(() => import('../../../components/agent/AIOutputRender.vue').then(module => module.default))

const props = defineProps<{
  visible: boolean
  modelName: string
  testing: boolean
  testResult: ModelTestResult | null
  testError: string
  metrics: ModelTestMetrics | null
  streamingResponse: string
  streamingReasoning: string
}>()

const emit = defineEmits<{ close: [] }>()

const dialogPanel = ref<HTMLElement | null>(null)
const outputViewport = ref<HTMLElement | null>(null)
const outputBody = ref<HTMLElement | null>(null)
let followOutput = true

const outputResponse = computed(() => props.testing ? props.streamingResponse : props.testResult?.response)
const outputReasoning = computed(() => props.testing ? props.streamingReasoning : props.testResult?.reasoning_content)
const closeLabel = computed(() => props.testing ? '关闭并停止测试' : '关闭')
const statusKind = computed(() => props.testing ? 'running' : props.testError ? 'failed' : 'succeeded')
const statusText = computed(() => {
  if (!props.testing) return props.testError ? '测试失败' : '测试成功'
  if (props.metrics?.phase === 'streaming') return '正在生成'
  if (props.metrics?.phase === 'preparing' && props.metrics.modelType === 'vision') return '准备测试图片'
  return '等待模型响应'
})

const formatTime = (ms: number | undefined) => ms === undefined ? undefined : (ms / 1000).toFixed(2)
const tokenFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
const metricItems = computed(() => {
  const metrics = props.metrics
  return [
    { label: '已用时间', value: formatTime(metrics?.elapsedMs), unit: 's', hint: '从开始测试到现在的耗时' },
    { label: '首 Token', value: formatTime(metrics?.firstTokenLatency), unit: 's', hint: '发出请求到收到第一段流式输出的耗时' },
    {
      label: '平均 TPS',
      value: metrics?.tokenRate === undefined
        ? undefined
        : `${metrics.tokenRateEstimated ? '≈' : ''}${metrics.tokenRate.toFixed(1)}`,
      unit: 'tokens/s',
      hint: '模型每秒生成的 Token 数。≈ 表示按已收到的流式输出估算。',
    },
    {
      label: '输出 Token',
      value: metrics?.outputTokens === undefined
        ? undefined
        : `${metrics.outputTokensEstimated ? '≈' : ''}${tokenFormat.format(metrics.outputTokens)}`,
      hint: '包含正文和思考内容。≈ 表示服务未返回输出用量，按可见内容估算。',
    },
  ]
})

watch(() => props.visible, (visible) => {
  if (!visible) return
  followOutput = true
  dialogPanel.value?.focus({ preventScroll: true })
}, { flush: 'post' })

const updateFollowOutput = () => {
  const viewport = outputViewport.value
  if (viewport) followOutput = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 32
}

watch(outputBody, (body, _previous, onCleanup) => {
  if (!body || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(() => {
    const viewport = outputViewport.value
    if (viewport && followOutput && props.testing) viewport.scrollTop = viewport.scrollHeight
  })
  observer.observe(body)
  onCleanup(() => observer.disconnect())
})

const closeDialog = () => emit('close')
const handleOverlayClick = () => {
  setTimeout(() => {
    if (!window.getSelection()?.toString()) closeDialog()
  }, 0)
}
</script>

<style scoped>
@import '../../../styles/dialog.css';

.test-dialog-panel {
  --test-surface: color-mix(in srgb, var(--text-primary) 4%, var(--platform-config-dialog-bg));
  --test-divider: var(--platform-config-dialog-header-border, var(--border-color));
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(680px, calc(100vw - 32px));
  max-width: none;
  height: min(500px, calc(100vh - 36px));
  max-height: none;
  padding: 22px 24px 18px;
  gap: 18px;
  box-sizing: border-box;
  color: var(--text-primary);
  box-shadow: 0 18px 50px rgb(0 0 0 / 20%), 0 2px 8px rgb(0 0 0 / 6%);
  outline: none;
}

.test-output-header,
.test-model {
  display: flex;
  align-items: center;
}

.test-header {
  padding-right: 30px;
}

.test-output-header {
  justify-content: space-between;
  gap: 12px;
}

.test-model {
  min-width: 0;
}

.test-model {
  gap: 8px;
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.test-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-kind,
.test-status {
  flex: none;
  border-radius: 7px;
  padding: 3px 7px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  background: var(--test-surface);
}

.test-dialog-close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  background: var(--test-surface);
  transition: background-color 150ms ease, color 150ms ease;
}

.test-dialog-close:focus-visible,
.test-output-scroll:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.test-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 3px;
  border-radius: 10px;
  background: var(--test-surface);
}

.test-metric {
  min-width: 0;
  padding: 10px 12px;
  position: relative;
}

.test-metric + .test-metric::before {
  content: '';
  position: absolute;
  inset: 9px auto 9px 0;
  width: 1px;
  background: var(--test-divider);
}

.test-metric dt {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 16px;
}

.test-metric dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 4px;
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 26px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.metric-unavailable,
.metric-unit {
  color: var(--text-secondary);
}

.metric-unit {
  flex: none;
  font-size: 10px;
  font-weight: 500;
}

.test-output {
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.test-output-header {
  padding: 0 0 9px;
  border-bottom: 1px solid var(--test-divider);
}

.test-output-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.test-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
}

.test-status.succeeded {
  color: color-mix(in srgb, var(--model-response-card-success-text) 48%, var(--text-primary));
}

.test-status.failed {
  color: var(--context-menu-danger-text);
}

.status-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--test-divider);
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  box-sizing: border-box;
  animation: status-spin 850ms linear infinite;
}

@keyframes status-spin {
  to { transform: rotate(360deg); }
}

.test-output-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  flex: 1;
  border-radius: 4px;
}

.test-output-body {
  padding: 12px 6px 8px 0;
  overflow-wrap: anywhere;
}

.test-output-render {
  margin-top: 0;
}

.test-output-render :deep(.response-content) {
  font-size: 15px;
}

.test-output-render :deep(.reasoning-content) {
  font-size: 13px;
}

.test-skeleton {
  display: grid;
  gap: 10px;
  max-width: 360px;
  padding: 8px 0;
  animation: waiting-pulse 1.8s ease-in-out infinite;
}

.test-skeleton span {
  height: 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-primary) 8%, var(--platform-config-dialog-bg));
}

.test-skeleton span:nth-child(2) { width: 84%; }
.test-skeleton span:nth-child(3) { width: 58%; }

@keyframes waiting-pulse {
  50% { opacity: 0.46; }
}

.test-error {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger-color, #c64545) 8%, var(--platform-config-dialog-bg));
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

@media (max-width: 565px) {
  .test-dialog-panel {
    padding: 16px;
    gap: 14px;
  }

  .test-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .test-metric:nth-child(odd)::before {
    display: none;
  }

  .test-metric:nth-child(n + 3) {
    border-top: 1px solid var(--test-divider);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-overlay,
  .test-dialog-panel,
  .status-spinner,
  .test-skeleton {
    animation: none;
  }

  .test-dialog-close {
    transition: none;
  }
}
</style>
