<template>
          <div class="detail-section">
            <div v-if="searchTraces.length" class="search-trace-list">
              <div v-for="trace in searchTraces" :key="trace.id" class="search-trace-card">
                <div class="search-trace-header">
                  <div class="search-trace-title" :title="trace.modelName">{{ trace.modelName || '联网搜索' }}</div>
                  <div class="search-trace-meta">
                    <span v-if="trace.durationMs != null" class="search-trace-duration" title="搜索耗时">{{ trace.durationMs }} ms</span>
                    <span class="search-trace-status" :class="trace.status">
                      {{ trace.status === 'searching' ? '搜索中…' : trace.status === 'success' ? '成功' : '失败' }}
                    </span>
                  </div>
                </div>

                <div class="search-trace-query">{{ trace.query }}</div>

                <div v-if="trace.error" class="search-trace-error">{{ trace.error }}</div>

                <div v-if="trace.results.length" class="search-trace-results">
                  <div v-for="(item, itemIndex) in trace.results" :key="item.url || itemIndex" class="search-result-row">
                    <a
                      v-if="item.link"
                      class="search-result-title"
                      :href="item.link"
                      target="_blank"
                      rel="noopener noreferrer"
                      @click.prevent="openSearchResultUrl(item.link)"
                    >
                      {{ item.title || item.host }}
                      <svg class="search-result-arrow" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 11l6-6M6 5h5v5" />
                      </svg>
                    </a>
                    <span v-else class="search-result-title">{{ item.title }}</span>
                    <span v-if="item.host" class="search-result-source" :title="item.link">{{ item.host }}</span>
                    <p v-if="item.snippet" class="search-result-snippet">{{ item.snippet }}</p>
                  </div>
                </div>

                <div v-else-if="trace.status === 'searching'" class="search-trace-loading">
                  <div class="loading-spinner"></div>
                  <span>正在联网搜索…</span>
                </div>
                <div v-else-if="trace.status === 'success'" class="no-data">
                  <span class="no-data-text">没有解析到结构化结果</span>
                </div>
              </div>
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">本次请求没有联网搜索记录</span>
            </div>
          </div>

</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RequestLog } from './types'

const props = defineProps<{ log: RequestLog }>()

const searchTraces = computed(() => (props.log?.searchTraces ?? []).map(trace => ({
  ...trace,
  results: trace.results.map(item => {
    try {
      const url = new URL(item.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { ...item, link: url.href, host: url.host }
      }
    } catch {
      // A result can still have a title and excerpt without a usable source URL.
    }
    return { ...item, link: undefined, host: undefined }
  }),
})))

const openSearchResultUrl = async (url: string) => {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
</script>

<style scoped src="./SearchTraces.css"></style>
