<template>
  <div class="about-app">
    <div class="network-group">
      <div class="group-title">应用信息</div>
      <div class="app-info-item">
        <div class="app-icon">
          <img class="app-icon-image" src="/icons/favicon.ico" alt="logo">
        </div>
        <div class="app-details">
          <h3 class="app-name">ZError</h3>
          <p class="app-version">版本 {{ currentVersion }}</p>
          <p class="app-description">支持OCS的AI题库</p>
        </div>
        <div class="app-actions">
          <span v-if="updateStatus" class="update-status" :class="updateStatusType">{{ updateStatus }}</span>
          <button class="link-btn" :disabled="isCheckingUpdate" @click="checkForUpdatesManually">
            {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
          </button>
        </div>
      </div>
    </div>

    <div class="network-group request-group">
      <div class="group-title">请求记录</div>

      <div v-if="false" class="request-summary-grid">
        <div class="summary-card">
          <span class="summary-label">总请求数</span>
          <strong class="summary-value">{{ totalRequestCount }}</strong>
          <span class="summary-hint">当前已记录的 /query 请求</span>
        </div>
        <div class="summary-card">
          <span class="summary-label">AI 命中</span>
          <strong class="summary-value ai">{{ aiHitCount }}</strong>
          <span class="summary-hint">AI 返回并写入题库的次数</span>
        </div>
        <div class="summary-card">
          <span class="summary-label">数据库命中</span>
          <strong class="summary-value database">{{ databaseHitCount }}</strong>
          <span class="summary-hint">直接命中本地题库的次数</span>
        </div>
        <div class="summary-card">
          <span class="summary-label">最近一次请求</span>
          <strong class="summary-value latest">{{ latestRequestTimeText }}</strong>
          <span class="summary-hint">近 7 天 {{ weeklyRequestCount }} 次请求</span>
        </div>
      </div>

      <div class="request-chart-layout">
        <div class="request-chart-card heatmap-card">
          <div class="request-heatmap-toolbar">
            <div class="request-heatmap-summary">
              <p class="request-card-subtitle toolbar-subtitle">最近 365 天请求记录分布</p>
              <div class="heatmap-legend" aria-label="请求频次图例">
                <div class="heatmap-legend-scale">
                  <span
                    v-for="color in heatmapLegendColors"
                    :key="color"
                    class="heatmap-legend-block"
                    :style="{ backgroundColor: color }"
                  />
                </div>
              </div>
            </div>
            <button class="link-btn" :disabled="isLoadingRequestStats" @click="loadRequestLogs">
              {{ isLoadingRequestStats ? '刷新中...' : '刷新记录' }}
            </button>
          </div>

          <div v-if="requestStatsError" class="request-empty-state error">
            {{ requestStatsError }}
          </div>
          <div v-else class="request-heatmap-stage">
            <div
              ref="heatmapContainerRef"
              class="request-heatmap-scroll"
              :class="{ 'is-scrollable': heatmapShouldScroll }"
              @scroll="clearActiveHeatmapCell"
            >
              <div class="request-heatmap-board" :style="heatmapBoardStyle">
                <span
                  v-for="marker in heatmapMonthMarkers"
                  :key="marker.key"
                  class="heatmap-month-label"
                  :style="marker.style"
                >
                  {{ marker.label }}
                </span>
                <span
                  v-for="day in heatmapDayLabels"
                  :key="day.key"
                  class="heatmap-day-label"
                  :style="{ gridColumn: '1', gridRow: `${day.row}` }"
                >
                  {{ day.label }}
                </span>
                <span
                  v-for="cell in heatmapCells"
                  :key="cell.key"
                  class="heatmap-cell"
                  :class="{
                    'heatmap-cell--placeholder': cell.isPlaceholder,
                    'heatmap-cell--empty': !cell.isPlaceholder && cell.count === 0,
                    'heatmap-cell--active': activeHeatmapCell && activeHeatmapCell.key === cell.key
                  }"
                  :style="cell.style"
                  :tabindex="cell.isPlaceholder ? -1 : 0"
                  :aria-label="cell.title"
                  @mouseenter="handleHeatmapCellEnter(cell, $event)"
                  @focus="handleHeatmapCellEnter(cell, $event)"
                  @mouseleave="handleHeatmapCellLeave(cell)"
                  @blur="handleHeatmapCellLeave(cell)"
                />
              </div>
            </div>
            <div
              v-if="activeHeatmapCell"
              ref="heatmapTooltipRef"
              class="heatmap-hover-tooltip"
              :style="heatmapTooltipStyle"
              role="status"
              aria-live="polite"
            >
              {{ activeHeatmapCell.count > 0 ? `${activeHeatmapCell.count} 次请求 · ${activeHeatmapCell.label}` : `${activeHeatmapCell.label} 暂无请求` }}
            </div>
          </div>

          <div class="request-heatmap-footer">
            <span class="request-heatmap-total">总请求数：{{ totalRequestCount }}</span>
          </div>
        </div>

        <div v-if="false" class="request-chart-card donut-card">
          <div class="request-card-header compact">
            <div>
              <h3 class="request-card-title">命中占比</h3>
              <p class="request-card-subtitle">AI 与数据库命中次数统计</p>
            </div>
            <div class="request-chart-footnote">
              <span>未命中/异常：{{ unmatchedRequestCount }}</span>
              <span>命中率：{{ requestHitRateText }}</span>
            </div>
          </div>

          <div v-if="hitRequestCount === 0" class="request-empty-state">
            暂无可统计的命中数据
          </div>
          <VChart
            v-else
            class="request-donut-chart"
            :option="requestSourceDonutOption"
            autoresize
          />
        </div>
      </div>

      <div v-if="false" class="request-records-card">
        <div class="request-card-header compact">
          <div>
            <h3 class="request-card-title">最近请求</h3>
            <p class="request-card-subtitle">展示最近 {{ recentRequestLogs.length }} 条请求记录</p>
          </div>
        </div>

        <div v-if="recentRequestLogs.length === 0" class="request-empty-state">
          暂无请求记录
        </div>
        <div v-else class="request-record-list">
          <div v-for="log in recentRequestLogs" :key="log.id" class="request-record-item">
            <div class="request-record-main">
              <div class="request-record-title-row">
                <span class="request-method-badge" :class="log.method.toLowerCase()">{{ log.method }}</span>
                <span class="request-title" :title="log.title">{{ log.title }}</span>
              </div>
              <div class="request-record-meta">
                <span>{{ formatDateTime(log.timestamp) }}</span>
                <span>{{ log.path }}</span>
                <span v-if="log.responseTime !== undefined">{{ log.responseTime }}ms</span>
              </div>
            </div>
            <div class="request-record-side">
              <span class="request-source-badge" :class="log.sourceType">
                {{ getRequestSourceLabel(log.sourceType) }}
              </span>
              <span class="request-status-badge" :class="getStatusClass(log.status)">
                {{ log.status ?? '处理中' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="network-group">
      <div class="group-title">网站和社区</div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3 class="setting-title">官方网站</h3>
          </div>
          <p class="setting-description">访问 ZError 官方网站</p>
        </div>
        <div class="setting-control">
          <a href="https://app.zerror.cc" target="_blank" class="plain-link">app.zerror.cc</a>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-title-row">
            <svg width="16" height="16" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M630.125714 1001.033143l-78.774857-153.088H262.144l-24.868571 158.866286-155.794286-22.966858 21.284571-135.899428H0V694.857143h126.683429l59.830857-382.756572H0V159.012571h210.432L235.300571 0l155.794286 22.966857-21.284571 135.972572h389.705143L783.945143 0l155.794286 22.966857-20.918858 136.045714H1024v153.088h-128.731429L836.461714 694.857143H1024v153.088h-211.017143L785.92 1024l-155.794286-22.966857z m105.837715-689.005714H345.965714L285.988571 694.857143h265.289143l104.96 135.899428 79.725715-518.656z" fill="currentColor"/>
            </svg>
            <h3 class="setting-title">QQ 频道</h3>
          </div>
          <p class="setting-description">加入 ZError QQ 频道，获取最新动态与交流支持</p>
        </div>
        <div class="setting-control">
          <a href="https://pd.qq.com/s/b0vebzqkc" target="_blank" class="plain-link">pd.qq.com/s/b0vebzqkc</a>
        </div>
      </div>

    </div>

    <div class="network-group">
      <div class="group-title">开源</div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3 class="setting-title">GitHub 仓库</h3>
          </div>
          <p class="setting-description">查看源代码、提交 Issue 或参与贡献</p>
        </div>
        <div class="setting-control">
          <a href="https://github.com/Miaozeqiu/ZError" target="_blank" class="plain-link">github.com/Miaozeqiu/ZError</a>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-title-row">
            <svg t="1774599738280" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M899.2 136.533333H124.8A82.346667 82.346667 0 0 0 42.666667 218.666667v586.666666a82.346667 82.346667 0 0 0 82.133333 82.133334h774.4A82.346667 82.346667 0 0 0 981.333333 805.333333v-586.666666a82.346667 82.346667 0 0 0-82.133333-82.133334z m11.733333 668.8a11.733333 11.733333 0 0 1-11.733333 11.733334H124.8a11.733333 11.733333 0 0 1-11.733333-11.733334v-586.666666a11.733333 11.733333 0 0 1 11.733333-11.733334h774.4a11.733333 11.733333 0 0 1 11.733333 11.733334z" fill="currentColor"></path><path d="M343.68 267.093333a154.88 154.88 0 0 0-154.666667 154.666667 152.96 152.96 0 0 0 32 93.866667v207.573333a33.706667 33.706667 0 0 0 49.706667 29.653333l72.96-39.893333 72.746667 39.893333a36.48 36.48 0 0 0 16.213333 4.053334 33.92 33.92 0 0 0 33.706667-33.706667v-207.573333a154.453333 154.453333 0 0 0-122.666667-248.533334z m69.333333 423.04L359.68 661.333333a34.346667 34.346667 0 0 0-32.213333 0l-53.12 29.226667v-130.773333a152.746667 152.746667 0 0 0 138.666666 0z m-69.333333-167.04a101.333333 101.333333 0 1 1 101.333333-101.333333 101.333333 101.333333 0 0 1-101.333333 101.333333zM802.346667 476.8H573.013333a35.413333 35.413333 0 0 0 0 70.4h224a35.2 35.2 0 1 0 5.333334-70.4zM573.013333 413.866667h224a35.2 35.2 0 1 0 5.333334-70.4 21.333333 21.333333 0 0 0-5.333334 0h-224a35.413333 35.413333 0 0 0 0 70.4zM802.346667 610.133333a21.333333 21.333333 0 0 0-5.333334 0h-224a35.413333 35.413333 0 0 0 0 70.4h224a35.2 35.2 0 1 0 5.333334-70.4z" fill="currentColor"></path></svg>
            <h3 class="setting-title">开源许可证</h3>
          </div>
          <p class="setting-description">本项目基于 MIT License 开源</p>
        </div>
        <div class="setting-control">
          <a href="https://mit-license.org/" target="_blank" class="link-btn">MIT License</a>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-title-row">
            <svg t="1774599698349" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M794.24 161.92H229.76A96 96 0 0 0 133.76 256v512a96 96 0 0 0 96 96h564.48a96 96 0 0 0 96-96V256a96 96 0 0 0-96-94.08z m32 604.16a32.64 32.64 0 0 1-32 32H229.76a32.64 32.64 0 0 1-32-32V256a32.64 32.64 0 0 1 32-32h564.48a32.64 32.64 0 0 1 32 32z" fill="currentColor" p-id="8314"></path><path d="M544 505.6a32.64 32.64 0 0 0-9.6-23.04L350.72 298.88a32 32 0 0 0-45.44 45.44L466.56 505.6l-161.28 161.28a32 32 0 0 0 0 45.44 31.36 31.36 0 0 0 22.4 9.6 32.64 32.64 0 0 0 23.04-9.6l183.68-184.32a30.08 30.08 0 0 0 9.6-22.4zM736.64 657.92H540.16a32 32 0 0 0-32 32 32.64 32.64 0 0 0 32 32h196.48a32 32 0 0 0 32-32 32 32 0 0 0-32-32z" fill="currentColor" p-id="8315"></path></svg>
            <h3 class="setting-title">调试面板</h3>
          </div>
          <p class="setting-description">开启开发者调试工具，用于问题诊断和性能分析</p>
        </div>
        <div class="setting-control">
          <button class="link-btn" @click="openDebugPanel">打开调试面板</button>
        </div>
      </div>
    </div>

    <UpdateDialog
      :visible="showUpdateDialog"
      :version-info="updateInfo"
      :current-version="currentVersion"
      @close="handleUpdateDialogClose"
      @later="handleLater"
      @week-later="handleWeekLater"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import VChart from 'vue-echarts'

type CSSProperties = Record<string, string>
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import type { ECBasicOption } from 'echarts/types/dist/shared'
import UpdateDialog from '../UpdateDialog.vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { useModelConfig } from '../../services/modelConfig'
import { environmentDetector } from '../../services/environmentDetector'
import { VersionCheckService, type VersionInfo } from '../../services/versionCheck'

use([
  CanvasRenderer,
  PieChart,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
])

interface RawRequestLog {
  id: string
  timestamp: string
  method: string
  path: string
  status?: number
  response_time?: number
  request_body?: string
  response_body?: string
  headers?: Record<string, string>
  ip?: string
  user_agent?: string
  stage?: string
}

type RequestSourceType = 'ai' | 'database' | 'unknown'

interface QueryResponseData {
  question?: string
  answer?: string
  is_ai?: boolean
}

interface RequestOverviewLog {
  id: string
  timestamp: number
  method: string
  path: string
  status?: number
  responseTime?: number
  requestBody: string
  responseBody: string
  headers: Record<string, string>
  sourceType: RequestSourceType
  title: string
  stage: string
}

interface HeatmapRenderCell {
  key: string
  dateKey: string
  count: number
  isPlaceholder: boolean
  title: string
  label: string
  detail: string
  color: string
  style: CSSProperties
}

interface HeatmapMonthMarker {
  key: string
  label: string
  style: CSSProperties
}

const { settings } = useSettingsManager()
const { settings: modelSettings } = useModelConfig()

const debugInfo = ref({
  tauriEnv: false,
  tauriObject: false,
  tauriInternals: false,
  environmentType: 'browser' as 'tauri' | 'browser',
  availableApis: [] as string[]
})

const currentVersion = VersionCheckService.getCurrentVersion()
const isCheckingUpdate = ref(false)
const showUpdateDialog = ref(false)
const updateInfo = ref<VersionInfo | null>(null)
const updateStatus = ref('')
const updateStatusType = ref<'success' | 'error' | ''>('')

const isLoadingRequestStats = ref(false)
const requestStatsError = ref('')
const requestLogs = ref<RequestOverviewLog[]>([])
const heatmapContainerRef = ref<HTMLElement | null>(null)
const heatmapTooltipRef = ref<HTMLElement | null>(null)
const heatmapContainerWidth = ref(0)
const isDarkTheme = ref(typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark')
const activeHeatmapCell = ref<HeatmapRenderCell | null>(null)
const heatmapTooltipStyle = ref<CSSProperties>({ left: '0px', top: '0px' })

let themeObserver: MutationObserver | null = null
let heatmapResizeObserver: ResizeObserver | null = null
let heatmapResizeFrame = 0

const syncThemeState = () => {
  if (typeof document === 'undefined') {
    return
  }

  isDarkTheme.value = document.documentElement.getAttribute('data-theme') === 'dark'
}

const syncHeatmapContainerWidth = () => {
  if (!heatmapContainerRef.value) {
    return
  }

  heatmapContainerWidth.value = Math.floor(heatmapContainerRef.value.clientWidth)
}

const scheduleHeatmapContainerWidthSync = () => {
  if (typeof window === 'undefined') {
    syncHeatmapContainerWidth()
    return
  }

  if (heatmapResizeFrame) {
    window.cancelAnimationFrame(heatmapResizeFrame)
  }

  heatmapResizeFrame = window.requestAnimationFrame(() => {
    heatmapResizeFrame = 0
    syncHeatmapContainerWidth()
  })
}

const checkEnvironment = () => {
  const envInfo = environmentDetector.getEnvironmentInfo()
  debugInfo.value = {
    tauriEnv: envInfo.isTauri,
    tauriObject: typeof window !== 'undefined' && !!window.__TAURI__,
    tauriInternals: typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__,
    environmentType: envInfo.type,
    availableApis: envInfo.availableApis
  }
}

const padDate = (value: number) => String(value).padStart(2, '0')

const createDateKey = (date: Date) => `${date.getFullYear()}-${padDate(date.getMonth() + 1)}-${padDate(date.getDate())}`

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const parseQueryResponseData = (responseBody: string): QueryResponseData | null => {
  if (!responseBody) {
    return null
  }

  try {
    const parsed = JSON.parse(responseBody) as {
      code?: number
      data?: QueryResponseData | QueryResponseData[] | null
    }

    if (parsed.code !== 1 || !parsed.data) {
      return null
    }

    if (Array.isArray(parsed.data)) {
      return parsed.data[0] ?? null
    }

    return parsed.data
  } catch {
    return null
  }
}

const getRequestSourceType = (responseBody: string): RequestSourceType => {
  const responseData = parseQueryResponseData(responseBody)
  if (!responseData) {
    return 'unknown'
  }

  return responseData.is_ai ? 'ai' : 'database'
}

const extractRequestTitle = (requestBody: string) => {
  if (!requestBody) {
    return '未解析题目'
  }

  try {
    const parsed = JSON.parse(requestBody) as { title?: string }
    return parsed.title?.trim() || '未解析题目'
  } catch {
    return '未解析题目'
  }
}

const isMeaningfulRequestLog = (log: RequestOverviewLog) => {
  return log.requestBody.trim().length > 0 && log.title !== '未解析题目'
}

const normalizeRequestLogs = (logs: RawRequestLog[]) => {
  const mergedLogs = new Map<string, RequestOverviewLog>()

  logs.forEach((log) => {
    if (log.path !== '/query' || (log.method !== 'GET' && log.method !== 'POST')) {
      return
    }

    const timestamp = new Date(log.timestamp).getTime()
    const existing = mergedLogs.get(log.id)

    const mergedLog: RequestOverviewLog = existing ?? {
      id: log.id,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      method: log.method,
      path: log.path,
      status: undefined,
      responseTime: undefined,
      requestBody: '',
      responseBody: '',
      headers: {},
      sourceType: 'unknown',
      title: '未解析题目',
      stage: log.stage || 'started'
    }

    if (Number.isFinite(timestamp)) {
      mergedLog.timestamp = existing ? Math.min(existing.timestamp, timestamp) : timestamp
    }

    mergedLog.method = log.method || mergedLog.method
    mergedLog.path = log.path || mergedLog.path
    mergedLog.stage = log.stage === 'completed' || mergedLog.stage === 'completed'
      ? 'completed'
      : (log.stage || mergedLog.stage)

    if (log.request_body) {
      mergedLog.requestBody = log.request_body
      mergedLog.title = extractRequestTitle(log.request_body)
    }

    if (log.response_body) {
      mergedLog.responseBody = log.response_body
      mergedLog.sourceType = getRequestSourceType(log.response_body)
    }

    if (log.status !== undefined && log.status !== null) {
      mergedLog.status = log.status
    }

    if (log.response_time !== undefined && log.response_time !== null) {
      mergedLog.responseTime = log.response_time
    }

    if (log.headers) {
      mergedLog.headers = log.headers
    }

    mergedLogs.set(log.id, mergedLog)
  })

  return Array.from(mergedLogs.values())
    .filter(isMeaningfulRequestLog)
    .sort((a, b) => b.timestamp - a.timestamp)
}

const loadRequestLogs = async () => {
  activeHeatmapCell.value = null

  if (!environmentDetector.isTauriEnvironment()) {
    requestLogs.value = []
    requestStatsError.value = '仅 Tauri 桌面端可查看请求记录'
    return
  }

  isLoadingRequestStats.value = true
  requestStatsError.value = ''

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const logs = await invoke<RawRequestLog[]>('get_request_logs')
    requestLogs.value = normalizeRequestLogs(logs)
  } catch (error) {
    console.error('获取请求记录失败:', error)
    requestStatsError.value = '获取请求记录失败，请稍后重试'
  } finally {
    isLoadingRequestStats.value = false
  }
}

const totalRequestCount = computed(() => requestLogs.value.length)
const aiHitCount = computed(() => requestLogs.value.filter(log => log.sourceType === 'ai').length)
const databaseHitCount = computed(() => requestLogs.value.filter(log => log.sourceType === 'database').length)
const hitRequestCount = computed(() => aiHitCount.value + databaseHitCount.value)
const unmatchedRequestCount = computed(() => Math.max(totalRequestCount.value - hitRequestCount.value, 0))
const recentRequestLogs = computed(() => requestLogs.value.slice(0, 10))

const weeklyRequestCount = computed(() => {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  return requestLogs.value.filter(log => log.timestamp >= sevenDaysAgo).length
})

const latestRequestTimeText = computed(() => {
  const latestLog = requestLogs.value[0]
  return latestLog ? formatDateTime(latestLog.timestamp) : '暂无记录'
})

const requestHitRateText = computed(() => {
  if (totalRequestCount.value === 0) {
    return '0%'
  }

  return `${((hitRequestCount.value / totalRequestCount.value) * 100).toFixed(1)}%`
})

const heatmapDateRange = computed(() => {
  const end = new Date()
  end.setHours(0, 0, 0, 0)

  const start = new Date(end)
  start.setDate(start.getDate() - 364)

  const counts = new Map<string, number>()
  requestLogs.value.forEach((log) => {
    const key = createDateKey(new Date(log.timestamp))
    counts.set(key, (counts.get(key) || 0) + 1)
  })

  const data: Array<[string, number]> = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const key = createDateKey(cursor)
    data.push([key, counts.get(key) || 0])
    cursor.setDate(cursor.getDate() + 1)
  }

  return {
    start: createDateKey(start),
    end: createDateKey(end),
    data
  }
})

const maxDailyRequestCount = computed(() => {
  return heatmapDateRange.value.data.reduce((max, [, count]) => Math.max(max, count), 1)
})

const chartPalette = computed(() => {
  if (isDarkTheme.value) {
    return {
      tooltipBackground: '#111827',
      tooltipBorder: '#334155',
      tooltipText: '#e2e8f0',
      primaryText: '#f8fafc',
      secondaryText: '#94a3b8',
      legendText: '#cbd5e1',
      calendarEmpty: '#4a4a4a',
      calendarTrack: '#313233',
      heatmapRange: ['#4a4a4a', '#14532d', '#166534', '#16a34a', '#22c55e'],
      heatmapShadow: 'rgba(34, 197, 94, 0.35)',
      donutLabel: '#e2e8f0',
      donutDivider: '#2f3542'
    }
  }

  return {
    tooltipBackground: '#ffffff',
    tooltipBorder: '#e2e8f0',
    tooltipText: '#0f172a',
    primaryText: '#0f172a',
    secondaryText: '#64748b',
    legendText: '#475569',
    calendarEmpty: '#ebedf0',
    calendarTrack: '#fff',
    heatmapRange: ['#ebedf0', '#c6f6d5', '#86efac', '#4ade80', '#15803d'],
    heatmapShadow: 'rgba(22, 163, 74, 0.35)',
    donutLabel: '#334155',
    donutDivider: '#ffffff'
  }
})

const heatmapWeekCount = 53
const heatmapSlotCount = heatmapWeekCount * 7
const heatmapLabelColumnWidth = 24
const heatmapHeaderRowHeight = 18
const heatmapGap = 3
const heatmapMinCellSize = 10
const heatmapMaxCellSize = 16
const heatmapDayLabels = [
  { key: 'monday', label: '一', row: 2 },
  { key: 'tuesday', label: '二', row: 3 },
  { key: 'wednesday', label: '三', row: 4 },
  { key: 'thursday', label: '四', row: 5 },
  { key: 'friday', label: '五', row: 6 },
  { key: 'saturday', label: '六', row: 7 },
  { key: 'sunday', label: '日', row: 8 }
]

const getHeatmapDayIndex = (date: Date) => {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

const resolveHeatmapColor = (count: number, colors: string[], maxCount: number) => {
  if (count <= 0) {
    return colors[0]
  }

  const levelCount = colors.length - 1
  if (maxCount <= 1) {
    return colors[levelCount]
  }

  const level = Math.min(levelCount, Math.max(1, Math.ceil((count / maxCount) * levelCount)))
  return colors[level]
}

const resolveHeatmapCellShadow = (color: string, count: number) => {
  if (count <= 0) {
    return '0 8px 18px color-mix(in srgb, var(--heatmap-track-color) 58%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--heatmap-track-color) 84%, transparent)'
  }

  return `0 8px 18px color-mix(in srgb, ${color} 34%, transparent), inset 0 0 0 1px color-mix(in srgb, ${color} 62%, transparent)`
}

const describeHeatmapActivity = (count: number, maxCount: number) => {
  if (count <= 0) {
    return '当天暂无请求'
  }

  if (maxCount <= 1) {
    return '当日请求活跃'
  }

  const ratio = count / maxCount
  if (ratio >= 0.85) {
    return '高频请求日'
  }
  if (ratio >= 0.55) {
    return '中高频请求日'
  }
  if (ratio >= 0.25) {
    return '中频请求日'
  }

  return '低频请求日'
}

const heatmapStartOffset = computed(() => getHeatmapDayIndex(parseDateKey(heatmapDateRange.value.start)))
const heatmapLegendColors = computed(() => chartPalette.value.heatmapRange)
const heatmapCellSize = computed(() => {
  const availableWidth = heatmapContainerWidth.value - heatmapLabelColumnWidth - heatmapGap * heatmapWeekCount

  if (availableWidth <= 0) {
    return heatmapMinCellSize
  }

  const calculatedSize = Math.floor(availableWidth / heatmapWeekCount)
  return Math.max(heatmapMinCellSize, Math.min(heatmapMaxCellSize, calculatedSize))
})
const heatmapBoardWidth = computed(() => {
  return heatmapLabelColumnWidth + heatmapWeekCount * heatmapCellSize.value + heatmapGap * heatmapWeekCount
})
const heatmapShouldScroll = computed(() => {
  return heatmapContainerWidth.value > 0 && heatmapBoardWidth.value > heatmapContainerWidth.value
})
const heatmapBoardStyle = computed(() => ({
  width: `${heatmapBoardWidth.value}px`,
  gridTemplateColumns: `${heatmapLabelColumnWidth}px repeat(${heatmapWeekCount}, ${heatmapCellSize.value}px)`,
  gridTemplateRows: `${heatmapHeaderRowHeight}px repeat(7, ${heatmapCellSize.value}px)`,
  columnGap: `${heatmapGap}px`,
  rowGap: `${heatmapGap}px`,
  '--heatmap-empty-color': chartPalette.value.calendarEmpty,
  '--heatmap-track-color': chartPalette.value.calendarTrack
}))

const heatmapCells = computed<HeatmapRenderCell[]>(() => {
  const cells: HeatmapRenderCell[] = []
  const offset = heatmapStartOffset.value
  const colors = chartPalette.value.heatmapRange
  const maxCount = maxDailyRequestCount.value

  for (let slotIndex = 0; slotIndex < heatmapSlotCount; slotIndex += 1) {
    const column = Math.floor(slotIndex / 7) + 2
    const row = (slotIndex % 7) + 2
    const dataIndex = slotIndex - offset

    if (dataIndex < 0 || dataIndex >= heatmapDateRange.value.data.length) {
      cells.push({
        key: `placeholder-${slotIndex}`,
        dateKey: '',
        count: 0,
        isPlaceholder: true,
        title: '',
        label: '',
        detail: '',
        color: '',
        style: {
          gridColumn: `${column}`,
          gridRow: `${row}`
        }
      })
      continue
    }

    const [dateKey, count] = heatmapDateRange.value.data[dataIndex]
    const color = resolveHeatmapColor(count, colors, maxCount)
    const label = formatDateLabel(dateKey)
    const activity = describeHeatmapActivity(count, maxCount)

    cells.push({
      key: dateKey,
      dateKey,
      count,
      isPlaceholder: false,
      title: `${label}，${count > 0 ? `请求 ${count} 次` : '暂无请求'}`,
      label,
      detail: count > 0 ? `请求 ${count} 次 · ${activity}` : activity,
      color,
      style: {
        gridColumn: `${column}`,
        gridRow: `${row}`,
        backgroundColor: color,
        '--heatmap-cell-accent': color,
        '--heatmap-cell-hover-shadow': resolveHeatmapCellShadow(color, count)
      }
    })
  }

  return cells
})

const updateHeatmapTooltipPosition = (target: HTMLElement) => {
  if (typeof window === 'undefined') {
    return
  }

  const rect = target.getBoundingClientRect()
  const tooltipWidth = heatmapTooltipRef.value?.offsetWidth ?? 0
  const tooltipHeight = heatmapTooltipRef.value?.offsetHeight ?? 0
  const horizontalPadding = 12
  const left = Math.min(
    window.innerWidth - tooltipWidth / 2 - horizontalPadding,
    Math.max(tooltipWidth / 2 + horizontalPadding, rect.left + rect.width / 2)
  )
  const top = Math.max(tooltipHeight + horizontalPadding, rect.top)

  heatmapTooltipStyle.value = {
    left: `${left}px`,
    top: `${top}px`
  }
}

const handleHeatmapCellEnter = async (cell: HeatmapRenderCell, event: MouseEvent | FocusEvent) => {
  if (cell.isPlaceholder) {
    return
  }

  activeHeatmapCell.value = cell

  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  if (!target) {
    return
  }

  updateHeatmapTooltipPosition(target)
  await nextTick()

  if (activeHeatmapCell.value?.key === cell.key) {
    updateHeatmapTooltipPosition(target)
  }
}

const clearActiveHeatmapCell = () => {
  activeHeatmapCell.value = null
}

const handleHeatmapCellLeave = (cell: HeatmapRenderCell) => {
  if (activeHeatmapCell.value?.key === cell.key) {
    clearActiveHeatmapCell()
  }
}

const heatmapMonthMarkers = computed<HeatmapMonthMarker[]>(() => {
  const markers: HeatmapMonthMarker[] = []
  const offset = heatmapStartOffset.value

  heatmapDateRange.value.data.forEach(([dateKey], dataIndex) => {
    const date = parseDateKey(dateKey)

    if (date.getDate() !== 1) {
      return
    }

    const weekIndex = Math.floor((offset + dataIndex) / 7)
    markers.push({
      key: `${date.getFullYear()}-${date.getMonth()}-${dataIndex}`,
      label: `${date.getMonth() + 1}月`,
      style: {
        gridColumn: `${weekIndex + 2}`,
        gridRow: '1'
      }
    })
  })

  return markers
})

const requestSourceDonutOption = computed<ECBasicOption>(() => {
  const palette = chartPalette.value
  const total = hitRequestCount.value
  const donutData = [
    {
      value: aiHitCount.value,
      name: 'AI命中',
      itemStyle: {
        color: '#22c55e',
        borderColor: palette.donutDivider,
        borderWidth: 2
      }
    },
    {
      value: databaseHitCount.value,
      name: '数据库命中',
      itemStyle: {
        color: '#3b82f6',
        borderColor: palette.donutDivider,
        borderWidth: 2
      }
    }
  ]
  const donutValueMap = new Map(donutData.map(item => [item.name, item.value]))

  return {
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      textStyle: {
        color: palette.tooltipText
      },
      formatter: '{b}<br />{c} 次（{d}%）'
    },
    title: {
      text: `${total}`,
      subtext: '命中总次数',
      left: '31%',
      top: '37%',
      textAlign: 'center',
      textStyle: {
        color: palette.primaryText,
        fontSize: 28,
        fontWeight: 700
      },
      subtextStyle: {
        color: palette.secondaryText,
        fontSize: 12,
        lineHeight: 18
      }
    },
    legend: {
      orient: 'vertical',
      right: 8,
      top: 'center',
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 18,
      selectedMode: false,
      formatter: (name: string) => {
        const value = donutValueMap.get(name) ?? 0
        const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
        return `${name}\n${value} 次 · ${percent}%`
      },
      textStyle: {
        color: palette.legendText,
        width: 116,
        lineHeight: 18,
        overflow: 'break'
      }
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '74%'],
        center: ['31%', '48%'],
        avoidLabelOverlap: true,
        label: {
          show: false
        },
        labelLine: {
          show: false
        },
        emphasis: {
          scale: true,
          scaleSize: 4
        },
        data: donutData
      }
    ]
  }
})

onMounted(() => {
  checkEnvironment()
  syncThemeState()
  scheduleHeatmapContainerWidthSync()

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          syncThemeState()
        }
      }
    })

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
  }

  if (typeof ResizeObserver !== 'undefined' && heatmapContainerRef.value) {
    heatmapResizeObserver = new ResizeObserver(() => {
      scheduleHeatmapContainerWidthSync()
    })
    heatmapResizeObserver.observe(heatmapContainerRef.value)
  }

  void loadRequestLogs()
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  heatmapResizeObserver?.disconnect()
  heatmapResizeObserver = null

  if (typeof window !== 'undefined' && heatmapResizeFrame) {
    window.cancelAnimationFrame(heatmapResizeFrame)
    heatmapResizeFrame = 0
  }
})

const formatDateTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDateLabel = (dateKey: string) => {
  return parseDateKey(dateKey).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

const getStatusClass = (status?: number) => {
  if (status === undefined) return 'pending'
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'unknown'
}

const getRequestSourceLabel = (sourceType: RequestSourceType) => {
  if (sourceType === 'ai') return 'AI 命中'
  if (sourceType === 'database') return '数据库命中'
  return '未命中'
}

const checkForUpdatesManually = async () => {
  if (isCheckingUpdate.value) {
    return
  }

  isCheckingUpdate.value = true
  updateStatus.value = ''
  updateStatusType.value = ''

  try {
    const result = await VersionCheckService.checkForUpdate()

    if (result.needsUpdate && result.versionInfo) {
      updateInfo.value = result.versionInfo
      showUpdateDialog.value = true
      updateStatus.value = `发现新版本 ${result.versionInfo.version}`
      updateStatusType.value = 'success'
      return
    }

    updateStatus.value = '当前已是最新版本'
    updateStatusType.value = 'success'
  } catch (error) {
    console.error('手动检查更新失败:', error)
    updateStatus.value = '检查更新失败，请稍后重试'
    updateStatusType.value = 'error'
  } finally {
    isCheckingUpdate.value = false
  }
}

const handleUpdateDialogClose = () => {
  showUpdateDialog.value = false
}

const handleLater = () => {
  showUpdateDialog.value = false
}

const handleWeekLater = () => {
  showUpdateDialog.value = false
  const oneWeekLater = new Date()
  oneWeekLater.setDate(oneWeekLater.getDate() + 7)
  localStorage.setItem('updateRemindTime', oneWeekLater.toISOString())
}

const openDebugPanel = async () => {
  try {
    if (environmentDetector.isTauriEnvironment()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_devtools')
      console.log('开发者工具已打开')
    } else {
      console.log('=== 调试信息 ===')
      console.log('当前环境:', debugInfo.value.environmentType)
      console.log('Tauri 环境:', debugInfo.value.tauriEnv)
      console.log('可用 API:', debugInfo.value.availableApis)
      console.log('设置信息:', settings.value)
      console.log('模型配置:', modelSettings)

      if (typeof window !== 'undefined') {
        const event = new KeyboardEvent('keydown', {
          key: 'F12',
          code: 'F12',
          keyCode: 123,
          which: 123,
          bubbles: true
        })
        document.dispatchEvent(event)
      }
    }
  } catch (error) {
    console.error('打开调试面板失败:', error)
  }
}
</script>

<style scoped>
.about-app {
  padding: 0;
  --request-surface-bg: color-mix(in srgb, var(--network-group-bg) 88%, #f8fafc);
  --request-soft-bg: color-mix(in srgb, var(--network-group-bg) 78%, #f8fafc);
  --request-item-bg: var(--bg-primary);
  --request-surface-border: var(--border-color);
  --request-surface-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

[data-theme="dark"] .about-app {
  --request-surface-bg: color-mix(in srgb, var(--network-group-bg) 92%, #111827);
  --request-soft-bg: color-mix(in srgb, var(--network-group-bg) 88%, #0f172a);
  --request-item-bg: color-mix(in srgb, var(--bg-secondary) 76%, #111827);
  --request-surface-border: color-mix(in srgb, var(--border-color) 80%, #475569);
  --request-surface-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
}

.network-group {
  background: var(--network-group-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 0 16px;
  margin: 16px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .05);
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 12px 0 4px 0;
  letter-spacing: 0.03em;
}

.app-info-item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 0;
}

.app-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}

.app-icon-image {
  width: 64px;
  height: 64px;
}

.app-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.app-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-left: auto;
  flex-shrink: 0;
}

.update-status {
  font-size: 12px;
  line-height: 1.4;
  text-align: right;
}

.update-status.success {
  color: var(--color-success, #16a34a);
}

.update-status.error {
  color: var(--color-danger, #dc2626);
}

.app-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.app-version {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.app-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.request-group {
  min-width: 0;
  padding-bottom: 16px;
}

.request-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 18px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--request-surface-border);
  border-radius: 14px;
  background: var(--request-surface-bg);
  box-shadow: var(--request-surface-shadow);
}

.summary-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.summary-value {
  font-size: 28px;
  line-height: 1;
  color: var(--text-primary);
}

.summary-value.ai {
  color: #16a34a;
}

.summary-value.database {
  color: #2563eb;
}

.summary-value.latest {
  font-size: 20px;
}

.summary-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.request-chart-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-bottom: 16px;
  min-width: 0;
}

.request-chart-card,
.request-records-card {
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--request-surface-border);
  border-radius: 16px;
  background: var(--request-surface-bg);
  padding: 16px;
  box-shadow: var(--request-surface-shadow);
}

.request-group .heatmap-card {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.request-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.request-card-header.compact {
  margin-bottom: 14px;
}

.request-card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.request-card-subtitle {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.request-heatmap-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
  min-width: 0;
}

.request-heatmap-summary {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

.toolbar-subtitle {
  margin: 0;
}

.request-heatmap-stage {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.request-heatmap-footer {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  margin-top: 12px;
}

.request-heatmap-total {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
  white-space: nowrap;
}

.heatmap-hover-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 20;
  max-width: min(320px, calc(100vw - 24px));
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.96);
  color: #f8fafc;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.28);
  transform: translate(-50%, calc(-100% - 10px));
}

.heatmap-hover-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background: rgba(17, 24, 39, 0.96);
  transform: translateX(-50%) rotate(45deg);
  border-radius: 2px;
}

.heatmap-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.heatmap-legend-scale {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.heatmap-legend-block {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--request-surface-border);
  box-sizing: border-box;
}

.request-heatmap-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 6px;
  scrollbar-gutter: stable both-edges;
}

.request-heatmap-scroll:not(.is-scrollable) {
  overflow-x: hidden;
}

.request-heatmap-scroll::-webkit-scrollbar {
  height: 8px;
}

.request-heatmap-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 30%, transparent);
}

.request-heatmap-board {
  display: grid;
  width: max-content;
  padding-top: 4px;
  background: transparent;
  border-radius: 12px;
}

.request-heatmap-scroll:not(.is-scrollable) .request-heatmap-board {
  margin: 0 auto;
}

.heatmap-month-label {
  align-self: end;
  font-size: 11px;
  line-height: 1;
  color: var(--text-secondary);
  white-space: nowrap;
  pointer-events: none;
}

.heatmap-day-label {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  font-size: 11px;
  line-height: 1;
  color: var(--text-secondary);
  pointer-events: none;
}

.heatmap-cell {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  background: var(--heatmap-empty-color);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--heatmap-cell-accent, var(--heatmap-empty-color)) 18%, transparent);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
  will-change: transform, box-shadow;
  cursor: pointer;
}

.heatmap-cell:not(.heatmap-cell--placeholder):hover,
.heatmap-cell:not(.heatmap-cell--placeholder):focus-visible,
.heatmap-cell--active {
  transform: translateY(-1px);
  box-shadow: var(--heatmap-cell-hover-shadow);
  filter: saturate(1.08);
}

.heatmap-cell:focus-visible {
  outline: none;
}

.heatmap-cell--empty {
  background: var(--heatmap-empty-color);
}

.heatmap-cell--placeholder {
  visibility: hidden;
}

.request-donut-chart {
  height: 300px;
  width: 100%;
}

.request-chart-footnote {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
}

.request-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  border-radius: 12px;
  background: var(--request-soft-bg);
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.request-empty-state.error {
  min-height: 230px;
  color: #dc2626;
}

.request-record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.request-record-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--request-surface-border);
  background: var(--request-item-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.request-record-main {
  min-width: 0;
  flex: 1;
}

.request-record-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.request-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.request-record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.request-record-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.request-method-badge,
.request-source-badge,
.request-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
}

.request-method-badge {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.request-method-badge.post {
  background: rgba(249, 115, 22, 0.12);
  color: #ea580c;
}

.request-method-badge.get {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.request-source-badge.ai {
  background: rgba(34, 197, 94, 0.14);
  color: #15803d;
}

.request-source-badge.database {
  background: rgba(59, 130, 246, 0.14);
  color: #1d4ed8;
}

.request-source-badge.unknown {
  background: rgba(148, 163, 184, 0.16);
  color: #64748b;
}

.request-status-badge.success {
  background: rgba(34, 197, 94, 0.14);
  color: #15803d;
}

.request-status-badge.redirect {
  background: rgba(250, 204, 21, 0.18);
  color: #a16207;
}

.request-status-badge.client-error,
.request-status-badge.server-error {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

.request-status-badge.pending,
.request-status-badge.unknown {
  background: rgba(148, 163, 184, 0.16);
  color: #64748b;
}

.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 0;
  border-bottom: 1px solid var(--border-color);
}

.network-group .setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 24px;
}

.setting-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px 0;
  color: var(--text-primary);
}

.setting-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.setting-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.plain-link {
  color: var(--color-primary);
  font-size: 13px;
  text-decoration: none;
  transition: opacity 0.2s ease !important;
}

.plain-link:hover {
  opacity: 0.75;
  text-decoration: underline;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--form-input-bg, #F7F7F7);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease !important;
}

.link-btn:hover {
  background: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.link-btn:focus-visible {
  outline: none;
  background: var(--form-input-bg, #F7F7F7);
  border-color: var(--form-input-focus-border, #3182ce);
}

.link-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

@media (max-width: 1200px) {
  .request-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .request-chart-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .app-info-item,
  .setting-item,
  .request-record-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .app-actions,
  .setting-control,
  .request-record-side {
    width: 100%;
    align-items: flex-start;
  }

  .request-summary-grid {
    grid-template-columns: 1fr;
  }

  .request-card-header,
  .request-heatmap-toolbar,
  .request-heatmap-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .request-heatmap-summary {
    flex-wrap: wrap;
    gap: 8px;
  }

  .heatmap-legend {
    width: 100%;
    justify-content: flex-start;
  }

  .heatmap-hover-tooltip {
    max-width: calc(100vw - 24px);
    white-space: normal;
  }

  .request-chart-footnote {
    flex-direction: column;
  }

  .request-donut-chart {
    height: 320px;
  }

  .heatmap-month-label,
  .heatmap-day-label {
    font-size: 10px;
  }
}
</style>
