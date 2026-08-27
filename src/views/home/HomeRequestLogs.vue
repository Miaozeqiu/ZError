<template>
    <!-- 请求记录区域 -->
    <div class="request-logs-layout">
      <!-- 请求记录列表 -->
      <div class="request-logs-main">
        <div class="request-logs-card">
          <div class="request-logs-header">
            <div class="request-logs-info">
              <div class="request-logs-details">
                <h3 class="request-logs-title">请求记录 <span class="request-logs-count">{{ logs.length
                    }}</span>
                </h3>
              </div>
            </div>
            <div class="request-logs-controls">
              <button class="config-btn clear-logs" @click="$emit('clear')" title="清空记录"
                :disabled="logs.length === 0">
                <svg t="1761201528959" class="icon" viewBox="0 0 1024 1024" version="1.1"
                  xmlns="http://www.w3.org/2000/svg" p-id="8805" width="20" height="20">
                  <path
                    d="M38.4 170.666667h947.2a38.4 38.4 0 1 1 0 76.8H38.4A38.4 38.4 0 1 1 38.4 170.666667z m341.333333-170.666667h264.533334a38.4 38.4 0 1 1 0 76.8H379.733333a38.4 38.4 0 1 1 0-76.8z m0 341.333333a38.4 38.4 0 0 1 38.4 38.4v435.2a38.4 38.4 0 1 1-76.8 0V379.733333a38.4 38.4 0 0 1 38.4-38.4z m256 0a38.4 38.4 0 0 1 38.4 38.4v435.2a38.4 38.4 0 1 1-76.8 0V379.733333a38.4 38.4 0 0 1 38.4-38.4zM204.8 247.808V896A51.2 51.2 0 0 0 256 947.2h512a51.2 51.2 0 0 0 51.2-51.2V247.808H896V896a128 128 0 0 1-128 128H256a128 128 0 0 1-128-128V247.808h76.8z"
                    fill="currentColor" p-id="8806" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 请求记录表格 -->
          <div class="request-table-container">
            <div v-if="logs.length === 0" class="no-requests">
              <p>暂无请求记录</p>
              <p class="hint">启动服务器后，收到的请求将显示在这里</p>
            </div>
            <div v-else class="request-table-scroll-wrap" >
              <div class="request-table-content" ref="contentRef">
                <table class="request-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th>IP地址</th>
                      <th>问题</th>
                      <th>响应时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="log in logs" :key="log.id"
                      :class="['request-row', getStatusClass(log.status), { 'selected': selectedId === log.id }]"
                      @click="$emit('select', log)">
                      <td class="timestamp">{{ formatTime(log.timestamp) }}</td>
                      <td class="status">
                        <span v-if="log.status" :class="['status-text', getStatusClass(log.status)]">
                          {{ log.status }}
                        </span>
                        <span v-else class="status-text pending">
                          处理中...
                        </span>
                      </td>
                      <td class="ip">{{ log.ip }}</td>
                      <td class="title" :title="getTitleFromRequestBody(log.requestBody)">
                        {{ truncateTitle(getTitleFromRequestBody(log.requestBody)) }}
                      </td>
                      <td class="response-time">
                        <span v-if="log.responseTime">{{ log.responseTime }}ms</span>
                        <span v-else class="pending">-</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- 自定义滚动条 -->
              <div class="custom-scrollbar" :class="{ 'is-visible': visible }" ref="barRef" @mousedown="onMousedown">
                <div class="custom-scrollbar-thumb" ref="thumbRef"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, watch } from 'vue'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import {
  formatTime,
  getStatusClass,
  getTitleFromRequestBody,
  truncateTitle,
} from './requestLogDisplay'
import type { RequestLog } from './types'

const props = defineProps<{
  logs: RequestLog[]
  selectedId?: string
}>()

defineEmits<{
  select: [log: RequestLog]
  clear: []
}>()

const { contentRef, barRef, thumbRef, visible, onMousedown, bind, update } = useCustomScrollbar()

onMounted(() => bind())
watch(() => props.logs, async () => {
  await nextTick()
  bind()
  update()
}, { deep: true })
</script>

<style scoped>
/* 请求记录布局样式 */
.request-logs-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 4px;
  overflow: hidden;
}

.request-logs-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  transition: width 0.3s ease;
}

.request-logs {
  margin-top: 40px;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.logs-title {
  font-size: 20px;
  font-weight: 600;
  color: #2d3748;
  margin: 0;
}

.request-logs-card {
  background: var(--bg-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.request-logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
}

.request-logs-info {
  display: flex;
  align-items: center;
  gap: 20px;
}

.request-logs-details {
  flex: 1;
}

.request-logs-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.request-logs-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  border-radius: 10px;
}

.request-logs-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.request-table-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.request-table-scroll-wrap {
  position: relative;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.request-table-scroll-wrap.is-dragging .request-table {
  pointer-events: none; /* 拖拽时禁用表格事件，防止和hover冲突 */
}

.request-table-content {
  overflow-y: auto;
  flex: 1;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-right: 10px; /* 给右侧滚动条留出空间，防止和表格横线内容重叠 */
}

.request-table-content::-webkit-scrollbar { display: none; }
.request-table-content::-webkit-scrollbar-button { display: none; }

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}

.request-table {
  width: 100%;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  table-layout: fixed;
  color: var(--text-primary);
}

.request-table thead {
  border-bottom: 2px solid var(--border-primary);
}

.request-table th {
  padding: 12px 8px;
  text-align: left;
  font-weight: 500;
  color: var(--ql-th-text);
  border-bottom: 1px solid var(--border-primary);
  white-space: nowrap;
  position: relative;
}

.request-table th:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--ql-divider);
}

.request-table th:nth-child(1) {
  width: 120px;
}

/* 时间 */
.request-table th:nth-child(2) {
  width: 80px;
}

/* 状态 */
.request-table th:nth-child(3) {
  width: 120px;
}

/* IP地址 */
.request-table th:nth-child(4) {
  width: auto;
}

/* 问题 */
.request-table th:nth-child(5) {
  width: 100px;
}

/* 响应时间 */

.request-table tbody tr {
  cursor: pointer;
  transition: background-color 0.2s ease;
  position: relative;
}

.request-table tbody tr:hover {
  background-color: var(--ql-row-hover-bg);
}

.request-table td {
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-primary);
  vertical-align: middle;
  word-wrap: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  position: relative;
}

.request-table tbody tr td:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--ql-table-divider);
  opacity: 0.6;
}

.request-table tbody tr:hover td:not(:last-child)::after {
  background: var(--ql-table-divider-hover);
  opacity: 0.8;
}

.request-table tbody tr:last-child td {
  border-bottom: none;
}

.no-requests {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #a0aec0;
  padding: 40px 20px;
}

.clear-logs-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #718096;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-logs-btn:hover {
  background: #fed7d7;
  border-color: #fc8181;
  color: #e53e3e;
}

.logs-container.request-logs-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.time {
  color: #718096;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.method {
  font-weight: 600;
  font-family: 'Courier New', monospace;
}

.method-get {
  color: #38a169;
}

.method-post {
  color: #3182ce;
}

.method-put {
  color: #d69e2e;
}

.method-delete {
  color: #e53e3e;
}

.method-patch {
  color: #805ad5;
}

.path {
  font-family: 'Courier New', monospace;
  color: #4a5568;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  font-family: 'Courier New', monospace;
}

.status-text.success {
  color: #38a169;
}

.status-text.redirect {
  color: #d69e2e;
}

.status-text.client-error {
  color: #e53e3e;
}

.status-text.server-error {
  color: #e53e3e;
}

.status-text.unknown {
  color: #718096;
}

.status-text.pending {
  color: #3182ce;
  animation: pulse 2s infinite;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.pending {
  color: #718096;
  font-style: italic;
}

.ip {
  font-family: 'Courier New', monospace;
  font-size: 13px;
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

/* 选中行样式 */
.request-row.selected {
  background: var(--ql-row-active-bg) !important;
}

.request-row.selected td:not(:last-child)::after {
  background: var(--ql-table-divider-active);
  opacity: 1;
}

.request-row.selected:hover {
  background: var(--ql-row-active-bg) !important;
}
/* 响应式设计 */
@media (max-width: 1024px) {
  .logs-table {
    font-size: 13px;
  }

  .logs-table th,
  .logs-table td {
    padding: 10px 8px;
  }

  .title {
    max-width: 150px;
  }

  .path {
    max-width: 120px;
  }
}

@media (max-width: 768px) {
  .logs-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .logs-table {
    font-size: 12px;
  }

  .logs-table th,
  .logs-table td {
    padding: 8px 6px;
  }

  .title,
  .path {
    max-width: 100px;
  }

  .time {
    font-size: 11px;
  }
}

.config-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 100%;
  border-radius: 8px;
  background: var(--bg-secondary);
  color: #718096;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.config-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
