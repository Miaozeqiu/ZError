<template>
  <div class="search-settings">
    <div class="network-group">
      <div class="group-title">联网搜索</div>
      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">启用联网搜索</h3>
          <p class="setting-description">
            开启后，题库未命中、需要 AI 作答时，会先按题干和选项搜索，再把结果注入模型 prompt。
            搜索由这里的全局设置统一控制，不需要为每个模型单独配置。
            注意：题干和选项会发送到你填写的第三方 MCP 服务。
          </p>
        </div>
        <div class="setting-control">
          <Toggle v-model="search.enabled" variant="default" size="medium" />
        </div>
      </div>
    </div>

    <div class="network-group">
      <div class="group-title">搜索服务</div>

      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">MCP 连接方式</h3>
          <p class="setting-description">
            远程 HTTP 适合 Exa 等在线服务；本地 stdio 适合通过命令启动的 MCP Server。
          </p>
        </div>
        <div class="setting-control">
          <div class="mode-switch">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: search.mode === 'remote' }"
              @click="search.mode = 'remote'"
            >远程 HTTP</button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: search.mode === 'local' }"
              @click="search.mode = 'local'"
            >本地 stdio</button>
          </div>
        </div>
      </div>

      <template v-if="search.mode === 'remote'">
        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">MCP 地址</h3>
            <p class="setting-description">
              默认使用 Exa 免费版：https://mcp.exa.ai/mcp。免登录、免 API Key，但有速率限制。
            </p>
          </div>
          <input v-model.trim="search.remoteUrl" class="form-input wide-input" type="text" placeholder="https://mcp.exa.ai/mcp">
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-title">认证方式</h3>
            <p class="setting-description">Exa 免费版选择“不使用”即可；填写 API Key 后可切换为 x-api-key 或 Bearer。</p>
          </div>
          <div class="setting-control">
            <select v-model="search.authMode" class="select-input">
              <option value="none">不使用（Exa 免费版）</option>
              <option value="x-api-key">x-api-key</option>
              <option value="bearer">Bearer Token</option>
            </select>
          </div>
        </div>

        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">API Key</h3>
            <p class="setting-description">可选。留空即使用 Exa 免费限流额度。</p>
          </div>
          <div class="secret-input-row">
            <input
              v-model.trim="search.apiKey"
              class="form-input wide-input"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="可选，留空使用免费版"
              autocomplete="off"
              @input="handleApiKeyInput"
            >
            <button type="button" class="ghost-btn" @click="showApiKey = !showApiKey">
              {{ showApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">自定义请求头</h3>
            <p class="setting-description">可选，JSON 对象。会与上面的认证头合并，同名字段以这里为准。</p>
          </div>
          <textarea
            v-model="search.customHeaders"
            class="form-textarea code-textarea"
            placeholder='例如：{"Authorization":"Bearer xxx"}'
          ></textarea>
        </div>

        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">额外参数</h3>
            <p class="setting-description">可选，JSON 对象，会合并到 MCP 工具参数中。Exa 默认无需填写。</p>
          </div>
          <textarea
            v-model="search.extraArguments"
            class="form-textarea code-textarea"
            placeholder='例如：{"category":"company"}'
          ></textarea>
        </div>
      </template>

      <template v-else>
        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">启动命令</h3>
            <p class="setting-description">
              Windows 下会通过 cmd /C 执行。例如 npx、node，或本地 server 的完整路径。
            </p>
          </div>
          <input v-model.trim="search.localCommand" class="form-input wide-input" type="text" placeholder="例如：npx">
        </div>

        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">命令参数</h3>
            <p class="setting-description">按空格分隔，支持用双引号包裹含空格的参数。</p>
          </div>
          <input v-model="search.localArgs" class="form-input wide-input" type="text" placeholder="例如：-y exa-mcp-server">
        </div>

        <div class="setting-item setting-item--stack">
          <div class="setting-info">
            <h3 class="setting-title">环境变量</h3>
            <p class="setting-description">每行一个 KEY=VALUE，例如本地服务的 API Key。</p>
          </div>
          <textarea
            v-model="search.localEnv"
            class="form-textarea env-textarea"
            placeholder="EXA_API_KEY=..."
          ></textarea>
        </div>
      </template>

      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">MCP 工具名</h3>
          <p class="setting-description">Exa 免费版默认 web_search_exa；自定义 MCP 请填写其工具名。</p>
        </div>
        <div class="setting-control">
          <input v-model.trim="search.toolName" class="form-input small-input" type="text" placeholder="web_search_exa">
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">返回结果数</h3>
          <p class="setting-description">每次搜索取前 N 条结果注入模型，建议 3-8 条。</p>
        </div>
        <div class="setting-control">
          <div class="number-control">
            <input
              :value="search.maxResults"
              class="form-input number-input"
              type="number"
              min="1"
              max="10"
              step="1"
              @change="updateNumber('maxResults', ($event.target as HTMLInputElement).value, 1, 10, 5)"
            >
            <span class="field-unit">条</span>
          </div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <h3 class="setting-title">搜索超时</h3>
          <p class="setting-description">单次 MCP 搜索的最长等待时间；超时后会跳过搜索继续答题。</p>
        </div>
        <div class="setting-control">
          <div class="number-control">
            <input
              :value="search.timeoutSeconds"
              class="form-input number-input"
              type="number"
              min="5"
              max="300"
              step="5"
              @change="updateNumber('timeoutSeconds', ($event.target as HTMLInputElement).value, 5, 300, 30)"
            >
            <span class="field-unit">秒</span>
          </div>
        </div>
      </div>
    </div>

    <div class="network-group">
      <div class="group-title">连接测试</div>
      <div class="test-row">
        <input
          v-model.trim="testQuery"
          class="form-input test-input"
          type="text"
          placeholder="输入一个题目或检索词，例如：凸轮机构中从动件运动规律取决于什么"
          @keydown.enter="runTest"
        >
        <button type="button" class="test-btn" :disabled="testing" @click="runTest">
          {{ testing ? '搜索中…' : '测试搜索' }}
        </button>
      </div>

      <div v-if="testError" class="test-message test-error">{{ testError }}</div>
      <div v-else-if="testOutcome" class="test-message test-success">
        搜索成功，{{ testOutcome.durationMs }}ms，返回 {{ testOutcome.results.length }} 条结果。
      </div>

      <div v-if="testOutcome?.results?.length" class="test-results">
        <div v-for="(item, index) in testOutcome.results" :key="item.url || index" class="test-result-item">
          <div class="test-result-title">{{ index + 1 }}. {{ item.title }}</div>
          <a v-if="item.url" class="test-result-url" :href="item.url" @click.prevent="openUrl(item.url)">{{ item.url }}</a>
          <div v-if="item.snippet" class="test-result-snippet">{{ item.snippet }}</div>
        </div>
      </div>

      <details v-if="testOutcome?.rawText" class="raw-details">
        <summary>查看原始返回</summary>
        <pre>{{ testOutcome.rawText.slice(0, 4000) }}</pre>
      </details>
    </div>

    <div class="footer-actions">
      <button type="button" class="reset-btn" @click="restoreExaDefaults">恢复 Exa 默认配置</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, onUnmounted, type Ref } from 'vue'
import Toggle from '../../components/ui/Toggle.vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings as SearchSettingsType } from '../../services/app/settings'
import {
  performWebSearch,
  type WebSearchOutcome
} from '../../services/searchService'

const { settings, setSetting } = useSettingsManager()

if (!settings.value.search) {
  setSetting('search', { ...DEFAULT_SEARCH_SETTINGS })
}

const search = toRef(settings.value, 'search') as Ref<SearchSettingsType>

const showApiKey = ref(false)
const testQuery = ref('')
const testing = ref(false)
const testError = ref('')
const testOutcome = ref<WebSearchOutcome | null>(null)
let testController: AbortController | null = null
onUnmounted(() => testController?.abort())

const handleApiKeyInput = () => {
  if (search.value.apiKey && search.value.authMode === 'none') {
    search.value.authMode = 'x-api-key'
  }
}

const updateNumber = (
  key: 'maxResults' | 'timeoutSeconds',
  raw: string,
  min: number,
  max: number,
  fallback: number
) => {
  const value = Number(raw)
  const next = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
  search.value[key] = next
}

const runTest = async () => {
  if (testing.value) return
  const query = testQuery.value.trim()
  if (!query) {
    testError.value = '请先输入测试题目或检索词'
    testOutcome.value = null
    return
  }

  testing.value = true
  const controller = new AbortController()
  testController = controller
  testError.value = ''
  testOutcome.value = null

  try {
    testOutcome.value = await performWebSearch(query, { ...search.value, enabled: true }, {
      force: true,
      signal: controller.signal
    })
  } catch (error) {
    testError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (testController === controller) testController = null
    testing.value = false
  }
}

const openUrl = async (url: string) => {
  if (!url) return
  try {
    const { openUrl: openExternal } = await import('@tauri-apps/plugin-opener')
    await openExternal(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const restoreExaDefaults = () => {
  Object.assign(search.value, {
    ...DEFAULT_SEARCH_SETTINGS,
    enabled: search.value.enabled
  })
  testError.value = ''
  testOutcome.value = null
}
</script>

<style scoped>
.search-settings {
  padding-bottom: 8px;
}

.network-group {
  background: var(--network-group-bg, var(--bg-primary));
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0 14px;
  margin: 12px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .05);
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 10px 0 2px 0;
  letter-spacing: 0.03em;
}

.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item--stack {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

.setting-description {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.form-input,
.form-textarea,
.select-input {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus,
.form-textarea:focus,
.select-input:focus {
  border-color: var(--color-primary, #667eea);
}

.form-input {
  padding: 7px 10px;
}

.wide-input {
  width: 100%;
  box-sizing: border-box;
}

.small-input {
  width: 190px;
}

.select-input {
  padding: 7px 10px;
  min-width: 190px;
}

.form-textarea {
  width: 100%;
  min-height: 68px;
  padding: 10px;
  box-sizing: border-box;
  resize: vertical;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  line-height: 1.5;
}

.code-textarea {
  min-height: 72px;
}

.env-textarea {
  min-height: 90px;
}

.secret-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.secret-input-row .form-input {
  flex: 1;
}

.ghost-btn,
.test-btn,
.reset-btn,
.mode-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.ghost-btn {
  padding: 7px 12px;
  font-size: 12px;
  flex-shrink: 0;
}

.ghost-btn:hover,
.reset-btn:hover,
.mode-btn:hover {
  background: var(--hover-bg);
}

.mode-switch {
  display: inline-flex;
  padding: 3px;
  gap: 3px;
  border-radius: 9px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
}

.mode-btn {
  border: none;
  background: transparent;
  padding: 6px 12px;
  font-size: 12px;
}

.mode-btn.active {
  background: var(--color-accent-light, rgba(102, 126, 234, 0.14));
  color: var(--color-accent, #667eea);
}

.number-control {
  display: flex;
  align-items: center;
  gap: 5px;
}

.number-input {
  width: 72px;
  text-align: center;
  -moz-appearance: textfield;
}

.number-input::-webkit-inner-spin-button,
.number-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.field-unit {
  font-size: 12px;
  color: var(--text-secondary);
}

.test-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 0 18px;
}

.test-input {
  flex: 1;
  min-width: 0;
}

.test-btn {
  padding: 8px 16px;
  font-size: 12px;
  flex-shrink: 0;
  background: var(--color-accent-light, rgba(102, 126, 234, 0.14));
  border-color: transparent;
  color: var(--color-accent, #667eea);
}

.test-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.test-message {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
}

.test-error {
  color: #e53e3e;
  white-space: pre-wrap;
  word-break: break-word;
}

.test-success {
  color: #38a169;
}

.test-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 14px;
}

.test-result-item {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
}

.test-result-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  line-height: 1.5;
  word-break: break-word;
}

.test-result-url {
  display: block;
  font-size: 11px;
  color: var(--color-accent, #667eea);
  text-decoration: none;
  word-break: break-all;
  margin-bottom: 5px;
}

.test-result-url:hover {
  text-decoration: underline;
}

.test-result-snippet {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.raw-details {
  margin-bottom: 14px;
  font-size: 11px;
  color: var(--text-secondary);
}

.raw-details summary {
  cursor: pointer;
}

.raw-details pre {
  margin: 8px 0 0;
  padding: 10px;
  max-height: 260px;
  overflow: auto;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  white-space: pre-wrap;
  word-break: break-word;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0 16px;
}

.reset-btn {
  padding: 8px 14px;
  font-size: 12px;
}
</style>
