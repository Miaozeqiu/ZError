<template>
  <div class="search-settings">
    <div class="network-group">
      <div class="group-title">联网搜索</div>
      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">启用联网搜索</h3>
          <p class="setting-description">题库未命中时，先用 Exa 搜索题目资料，再交给 AI 作答。</p>
        </div>
        <Toggle v-model="search.enabled" variant="default" size="medium" />
      </div>
      <div class="setting-item setting-item--stack">
        <div class="setting-info">
          <label class="setting-title" for="search-api-key">Exa API Key</label>
          <p class="setting-description">可选，留空使用免费限流搜索。</p>
        </div>
        <div class="secret-input-row">
          <input
            id="search-api-key"
            v-model.trim="search.apiKey"
            class="form-input"
            :type="showApiKey ? 'text' : 'password'"
            placeholder="可选，填写你的 Exa API Key"
            autocomplete="off"
            spellcheck="false"
          >
          <button class="ghost-btn" type="button" :aria-pressed="showApiKey" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>
      <div class="test-row">
        <button class="test-btn" type="button" :disabled="testing" @click="runTest">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="testError" class="test-message test-error" role="alert">{{ testError }}</span>
        <span v-else-if="testMessage" class="test-message test-success" role="status">{{ testMessage }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, onUnmounted } from 'vue'
import Toggle from '../../components/ui/Toggle.vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { DEFAULT_SEARCH_SETTINGS } from '../../services/app/settings'
import { performWebSearch } from '../../services/searchService'

const { settings, setSetting } = useSettingsManager()
if (!settings.value.search) setSetting('search', { ...DEFAULT_SEARCH_SETTINGS })
const search = toRef(settings.value, 'search')
const showApiKey = ref(false)
const testing = ref(false)
const testError = ref('')
const testMessage = ref('')
let testController: AbortController | null = null
onUnmounted(() => testController?.abort())

const runTest = async () => {
  if (testing.value) return
  const controller = new AbortController()
  testController = controller
  testing.value = true
  testError.value = ''
  testMessage.value = ''
  try {
    const outcome = await performWebSearch('Exa search engine', { ...search.value, enabled: true }, {
      force: true, signal: controller.signal,
    })
    testMessage.value = `连接成功，耗时 ${outcome.durationMs}ms`
  } catch (error) {
    if (!controller.signal.aborted) testError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (testController === controller) testController = null
    testing.value = false
  }
}
</script>

<style scoped>
.search-settings { padding-bottom: 8px; }
.network-group {
  background: var(--network-group-bg, var(--bg-primary));
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0 14px;
  margin: 12px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .05);
}
.group-title { padding: 16px 0 4px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.setting-item { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 0; }
.setting-item--stack { flex-direction: column; align-items: stretch; gap: 10px; border-top: 1px solid var(--border-color); }
.setting-info { min-width: 0; }
.setting-title { display: block; margin: 0; font-size: 14px; font-weight: 500; color: var(--text-primary); }
.setting-description { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.secret-input-row { display: flex; align-items: center; gap: 8px; }
.form-input {
  box-sizing: border-box; flex: 1; min-width: 0; height: 38px; padding: 0 12px;
  border: 1px solid var(--border-color); border-radius: 8px;
  background: var(--bg-secondary); color: var(--text-primary); font: inherit; font-size: 13px;
}
.form-input:focus { outline: 2px solid var(--color-primary, #007acc); outline-offset: 1px; }
.ghost-btn, .test-btn { flex-shrink: 0; border-radius: 8px; padding: 9px 14px; font: inherit; font-size: 12px; cursor: pointer; }
.ghost-btn { border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); }
.test-btn { border: 1px solid transparent; background: var(--color-primary, #007acc); color: white; }
.test-btn:disabled { opacity: .6; cursor: wait; }
.test-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 0 0 18px; }
.test-message { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.test-error { color: var(--color-danger, #d14b4b); }
.test-success { color: var(--color-success, #2b8a57); }
</style>
