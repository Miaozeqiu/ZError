<template>
  <div v-if="show" class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog-panel quick-add-panel">
      <div class="dialog-header">
        <button class="btn-back" @click="$emit('close')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <span class="dialog-title">添加模型</span>
        <button
          class="btn-confirm"
          :disabled="!quickAdd.displayName.trim() || !quickAdd.modelId.trim()"
          @click="submitQuickAdd"
        >完成</button>
      </div>
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-label">模型名称 <span class="qa-required">*</span></label>
          <input class="form-input" v-model="quickAdd.displayName" placeholder="例如：DeepSeek-V3" />
        </div>
        <div class="form-group">
          <label class="form-label">模型 ID <span class="qa-required">*</span></label>
          <div class="qa-model-id-row">
            <input class="form-input" v-model="quickAdd.modelId" placeholder="例如：deepseek-ai/DeepSeek-V3" />
            <button class="qa-fetch-btn" :disabled="isFetchingModels" @click="fetchModels" :title="isFetchingModels ? '获取中...' : '获取可用模型列表'">
              <svg v-if="isFetchingModels" class="qa-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              <span>获取列表</span>
            </button>
          </div>
          <!-- 下拉列表 -->
          <div v-if="showModelDropdown && fetchedModelList.length > 0" class="qa-dropdown">
            <div class="qa-dropdown-search">
              <input class="qa-dropdown-input" v-model="modelSearchQuery" placeholder="搜索模型..." @click.stop />
            </div>
            <div class="qa-dropdown-list">
              <div v-for="m in filteredFetchedModels" :key="m.id" class="qa-dropdown-item" @click="selectFetchedModel(m.id)">
                <span class="qa-dropdown-item-id">{{ m.id }}</span>
              </div>
              <div v-if="filteredFetchedModels.length === 0" class="qa-dropdown-empty">无匹配模型</div>
            </div>
          </div>
          <span v-if="fetchError" class="qa-hint qa-hint-error">{{ fetchError }}</span>
          <span v-else class="qa-hint">调用 API 时使用的 model 字段值，点击右侧按钮获取可用模型列表</span>
        </div>
        <div class="form-group qa-form-row">
          <label class="form-label">模型类型</label>
          <div class="qa-category-switch">
            <ModelCategorySwitch v-model="quickAdd.category" :show-summary="false" />
          </div>
        </div>
        <div class="form-group qa-form-row">
          <label class="form-label">启用思考</label>
          <label class="qa-thinking-switch">
            <input type="checkbox" v-model="quickAdd.enableThinking" />
            <span class="qa-toggle-slider"></span>
          </label>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import ModelCategorySwitch from './ModelCategorySwitch.vue'

const props = defineProps<{
  show: boolean
  platformBaseUrl?: string
  platformApiKey?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', model: any): void
}>()

const quickAdd = ref({ displayName: '', modelId: '', category: 'text' as 'text' | 'vision' | 'summary', enableThinking: false })
const fetchedModelList = ref<{ id: string; name?: string }[]>([])
const isFetchingModels = ref(false)
const showModelDropdown = ref(false)
const fetchError = ref('')
const modelSearchQuery = ref('')

const filteredFetchedModels = computed(() => {
  const q = modelSearchQuery.value.trim().toLowerCase()
  if (!q) return fetchedModelList.value
  return fetchedModelList.value.filter(m => m.id.toLowerCase().includes(q))
})

watch(() => props.show, (newVal) => {
  if (newVal) {
    quickAdd.value = { displayName: '', modelId: '', category: 'text', enableThinking: false }
    fetchedModelList.value = []
    showModelDropdown.value = false
    fetchError.value = ''
  }
})

const fetchModels = async () => {
  const baseUrl = props.platformBaseUrl
  if (!baseUrl) {
    fetchError.value = '请先在平台配置中填写 API 基础 URL'
    return
  }
  isFetchingModels.value = true
  fetchError.value = ''
  fetchedModelList.value = []
  showModelDropdown.value = false

  try {
    const endpoints = [
      `${baseUrl}/models`,
      `${baseUrl}/v1/models`,
    ]
    let models: { id: string; name?: string }[] = []
    let lastErr = ''
    for (const url of endpoints) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (props.platformApiKey) headers['Authorization'] = `Bearer ${props.platformApiKey}`
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
        const res = await tauriFetch(url, { method: 'GET', headers })
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
        const data = await res.json()
        // OpenAI: { data: [{ id, ... }] }
        if (data?.data && Array.isArray(data.data)) {
          models = data.data.map((m: any) => ({ id: m.id, name: m.id }))
          break
        }
        // 简单数组
        if (Array.isArray(data)) {
          models = data.map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }))
          break
        }
        if (data?.models && Array.isArray(data.models)) {
          models = data.models.map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }))
          break
        }
        lastErr = '无法解析响应格式'
      } catch (e: any) { lastErr = e?.message || String(e) }
    }
    if (models.length === 0) {
      fetchError.value = `获取失败: ${lastErr}`
    } else {
      const seen = new Set<string>()
      fetchedModelList.value = models.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
        .sort((a, b) => a.id.localeCompare(b.id))
      showModelDropdown.value = true
    }
  } catch (e: any) {
    fetchError.value = `获取失败: ${e?.message || String(e)}`
  } finally {
    isFetchingModels.value = false
  }
}

const selectFetchedModel = (modelId: string) => {
  quickAdd.value.modelId = modelId
  if (!quickAdd.value.displayName) {
    quickAdd.value.displayName = modelId
  }
  showModelDropdown.value = false
}

const generateJsCode = (modelId: string, category: 'text' | 'vision' | 'summary' = 'text'): string => {
  if (category === 'vision') {
    return `async function processModel(input, config, abortSignal) {
  const requestData = {
    messages: input.messages,
    model: '${modelId}',
    stream: true,
    max_tokens: 4096,
  };
  
  if (input.tools && input.tools.length > 0) {
    requestData.tools = input.tools;
    if (input.tool_choice) {
      requestData.tool_choice = input.tool_choice;
    }
  }
  
  try {
    const response = await fetch(\`\${config.baseUrl}/v1/chat/completions\`, {
      method: 'POST',
      headers: { 'Authorization': \`Bearer \${config.apiKey}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: abortSignal
    });
    if (!response.ok) { const e = await response.text(); throw new Error(\`API 错误 \${response.status}: \${e}\`); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    return (async function* () {
      let buffer = '';
      let currentToolCall = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t || t === 'data: [DONE]') continue;
            if (t.startsWith('data: ')) {
              try {
                const data = JSON.parse(t.slice(6));
                if (data.choices?.[0]?.delta) {
                  const delta = data.choices[0].delta;
                  const content = delta.content ?? '';
                  const reasoning_content = delta.reasoning_content ?? delta.reasoning ?? '';
                  const finished = data.choices[0].finish_reason === 'stop' || data.choices[0].finish_reason === 'tool_calls';
                  
                  if (delta.tool_calls && delta.tool_calls.length > 0) {
                    const tc = delta.tool_calls[0];
                    if (tc.id) {
                      if (currentToolCall) yield { tool_calls: [currentToolCall] };
                      currentToolCall = { id: tc.id, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' } };
                    } else if (currentToolCall && tc.function?.arguments) {
                      currentToolCall.function.arguments += tc.function.arguments;
                    }
                  }
                  
                  if (finished && currentToolCall) {
                    yield { tool_calls: [currentToolCall], finished: true };
                    currentToolCall = null;
                  } else if (content || reasoning_content || finished) {
                    yield { content, reasoning_content, finished };
                  }
                }
              } catch (e) { console.warn('解析失败:', e); }
            }
          }
        }
        if (currentToolCall) yield { tool_calls: [currentToolCall], finished: true };
      } finally { reader.releaseLock(); }
    })();
  } catch (error) { console.error('API 调用失败:', error); throw error; }
}`
  }
  else  {
    return `async function processModel(input, config, abortSignal) {
  const requestData = {
    messages: input.messages,
    model: '${modelId}',
    stream: true,
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9
  };
  
  if (input.tools && input.tools.length > 0) {
    requestData.tools = input.tools;
    if (input.tool_choice) {
      requestData.tool_choice = input.tool_choice;
    }
  }

  try {
    const response = await fetch(\`\${config.baseUrl}/v1/chat/completions\`, {
      method: 'POST',
      headers: { 'Authorization': \`Bearer \${config.apiKey}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: abortSignal
    });
    if (!response.ok) { const e = await response.text(); throw new Error(\`API 错误 \${response.status}: \${e}\`); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    return (async function* () {
      let buffer = '';
      let currentToolCall = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t || t === 'data: [DONE]') continue;
            if (t.startsWith('data: ')) {
              try {
                const data = JSON.parse(t.slice(6));
                if (data.choices?.[0]?.delta) {
                  const delta = data.choices[0].delta;
                  const content = delta.content ?? '';
                  const reasoning_content = delta.reasoning_content ?? '';
                  const finished = data.choices[0].finish_reason === 'stop' || data.choices[0].finish_reason === 'tool_calls';
                  
                  if (delta.tool_calls && delta.tool_calls.length > 0) {
                    const tc = delta.tool_calls[0];
                    if (tc.id) {
                      if (currentToolCall) yield { tool_calls: [currentToolCall] };
                      currentToolCall = { id: tc.id, type: 'function', function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' } };
                    } else if (currentToolCall && tc.function?.arguments) {
                      currentToolCall.function.arguments += tc.function.arguments;
                    }
                  }
                  
                  if (finished && currentToolCall) {
                    yield { tool_calls: [currentToolCall], finished: true };
                    currentToolCall = null;
                  } else if (content || reasoning_content || finished) {
                    yield { content, reasoning_content, finished };
                  }
                }
              } catch (e) { console.warn('解析失败:', e); }
            }
          }
        }
        if (currentToolCall) yield { tool_calls: [currentToolCall], finished: true };
      } finally { reader.releaseLock(); }
    })();
  } catch (error) { console.error('API 调用失败:', error); throw error; }
}`
  } 
}

const submitQuickAdd = () => {
  if (!quickAdd.value.displayName.trim() || !quickAdd.value.modelId.trim()) return
  const modelId = quickAdd.value.modelId.trim()
  const jsCode = generateJsCode(modelId, quickAdd.value.category)
  const newModel = {
    name: modelId,
    displayName: quickAdd.value.displayName.trim(),
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    enabled: true,
    category: quickAdd.value.category as 'text' | 'vision' | 'summary',
    enableThinking: quickAdd.value.enableThinking,
    jsCode
  }
  emit('save', newModel)
}
</script>

<style>
@import '../../../styles/dialog.css';
</style>

<style scoped>
/* 覆盖 dialog-panel 尺寸为此弹窗专属大小 */
.quick-add-panel {
  width: 420px;
  max-width: 95vw;
  max-height: unset;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* dialog-body 在此弹窗中用 flex 列布局 */
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: unset;
}

.qa-form-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.qa-category-switch {
  flex: 1;
  display: flex;
  justify-content: flex-start;
}

.qa-required {
  color: #e53e3e;
}

.qa-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

/* 思考模式切换开关 */
.qa-thinking-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  cursor: pointer;
}

.qa-thinking-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.qa-toggle-slider {
  position: absolute;
  inset: 0;
  background-color: var(--text-secondary, #a0aec0);
  border-radius: 20px;
  transition: 0.25s;
}

.qa-toggle-slider::before {
  content: "";
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: #fff;
  border-radius: 50%;
  transition: 0.25s;
}

.qa-thinking-switch input:checked + .qa-toggle-slider {
  background-color: var(--color-primary, #667eea);
}

.qa-thinking-switch input:checked + .qa-toggle-slider::before {
  transform: translateX(16px);
}

/* 模型 ID 行 */
.qa-model-id-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.qa-model-id-row .form-input {
  flex: 1;
}

.qa-fetch-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  transition: all 0.15s;
  flex-shrink: 0;
}

.qa-fetch-btn:hover:not(:disabled) {
  border-color: var(--color-primary, #667eea);
  color: var(--color-primary, #667eea);
}

.qa-fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qa-spin {
  animation: qa-spin 1s linear infinite;
}

@keyframes qa-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 下拉列表 */
.qa-dropdown {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  margin-top: 6px;
  background: var(--bg-primary, #fff);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  max-height: 260px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.qa-dropdown-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.qa-dropdown-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
  background: var(--bg-primary, #fff);
  color: var(--text-primary);
}

.qa-dropdown-input:focus {
  border-color: var(--color-primary);
}

.qa-dropdown-list {
  flex: 1;
  overflow-y: auto;
  max-height: 200px;
}

.qa-dropdown-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  font-family: 'Consolas', monospace;
  transition: background 0.1s;
}

.qa-dropdown-item:hover {
  background: var(--hover-bg, #f7fafc);
  color: var(--color-primary);
}

.qa-dropdown-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.qa-hint-error {
  color: var(--text-error, #e53e3e) !important;
}

</style>
