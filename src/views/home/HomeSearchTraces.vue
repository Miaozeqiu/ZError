<template>
          <div class="detail-section">
            <div v-if="log && log.searchTraces && log.searchTraces.length" class="search-trace-list">
              <div v-for="(trace, index) in log.searchTraces" :key="trace.id" class="search-trace-card">
                <div class="search-trace-header">
                  <div class="search-trace-title">
                    第 {{ index + 1 }} 次搜索
                    <span class="search-trace-model">{{ trace.modelName }}</span>
                  </div>
                  <span class="search-trace-status" :class="trace.status">
                    {{ trace.status === 'searching' ? '搜索中…' : trace.status === 'success' ? '成功' : '失败' }}
                  </span>
                </div>

                <div class="search-trace-meta">
                  <span v-if="trace.durationMs !== undefined">{{ trace.durationMs }}ms</span>
                </div>

                <div class="search-trace-query">{{ trace.query }}</div>

                <div v-if="trace.error" class="search-trace-error">{{ trace.error }}</div>

                <div v-if="trace.results.length" class="search-trace-results">
                  <div v-for="(item, itemIndex) in trace.results" :key="item.url || itemIndex" class="search-result-row">
                    <div class="search-result-head">
                      <span class="search-result-index">{{ itemIndex + 1 }}</span>
                      <a
                        v-if="item.url"
                        class="search-result-title"
                        :href="item.url"
                        @click.prevent="openSearchResultUrl(item.url)"
                      >{{ item.title }}</a>
                      <span v-else class="search-result-title">{{ item.title }}</span>
                    </div>
                    <div v-if="item.url" class="search-result-url">{{ item.url }}</div>
                    <div v-if="item.snippet" class="search-result-snippet">{{ item.snippet }}</div>
                  </div>
                </div>

                <div v-else-if="trace.status === 'searching'" class="search-trace-loading">
                  <div class="loading-spinner"></div>
                  <span>正在联网搜索…</span>
                </div>
                <div v-else-if="trace.status === 'success'" class="no-data">
                  <span class="no-data-text">没有解析到结构化结果</span>
                </div>

                <details v-if="trace.rawText" class="search-raw-details">
                  <summary>查看原始返回</summary>
                  <pre>{{ trace.rawText.slice(0, 6000) }}</pre>
                </details>
              </div>
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">本次请求没有联网搜索记录</span>
            </div>
          </div>

</template>

<script setup lang="ts">
import type { RequestLog } from './types'
defineProps<{ log: RequestLog }>()
const openSearchResultUrl = async (url: string) => {
  if (!url) return
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
</script>

<style scoped>
.search-trace-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-trace-card {
  padding: 14px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  background: var(--bg-secondary, #f8fafc);
}

.search-trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.search-trace-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.search-trace-model {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}

.search-trace-status {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
  color: var(--text-secondary);
}

.search-trace-status.success {
  color: #38a169;
  background: rgba(56, 161, 105, 0.12);
}

.search-trace-status.error {
  color: #e53e3e;
  background: rgba(229, 62, 62, 0.12);
}

.search-trace-status.searching {
  color: #3182ce;
  background: rgba(49, 130, 206, 0.12);
}

.search-trace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.search-trace-meta span {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.05));
}

.search-trace-query {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-primary);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.search-trace-error {
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #e53e3e;
  white-space: pre-wrap;
  word-break: break-word;
}

.search-trace-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-result-row {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-primary);
}

.search-result-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.search-result-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--bg-tertiary, rgba(0, 0, 0, 0.06));
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.search-result-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-primary);
  text-decoration: none;
  word-break: break-word;
}

a.search-result-title:hover {
  color: var(--color-primary, #007acc);
  text-decoration: underline;
}

.search-result-url {
  margin: 0 0 5px 26px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-primary, #007acc);
  word-break: break-all;
}

.search-result-snippet {
  margin-left: 26px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.search-trace-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.search-raw-details {
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-secondary);
}

.search-raw-details summary {
  cursor: pointer;
}

.search-raw-details pre {
  margin: 8px 0 0;
  padding: 10px;
  max-height: 260px;
  overflow: auto;
  border-radius: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color, #e2e8f0);
  white-space: pre-wrap;
  word-break: break-word;
}

.no-data { padding: 24px; text-align: center; color: var(--text-secondary); }
.loading-spinner {
  width: 14px; height: 14px; border: 2px solid var(--border-color);
  border-top-color: var(--color-primary, #007acc); border-radius: 50%;
  animation: search-spin 1s linear infinite;
}
@keyframes search-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading-spinner { animation: none; } }
</style>
