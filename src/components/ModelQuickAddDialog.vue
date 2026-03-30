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
          <input class="form-input" v-model="quickAdd.modelId" placeholder="例如：deepseek-ai/DeepSeek-V3" />
          <span class="qa-hint">调用 API 时使用的 model 字段值</span>
        </div>
        <div class="form-group qa-form-row">
          <label class="form-label">模型类型</label>
          <div class="qa-category-switch">
            <ModelCategorySwitch v-model="quickAdd.category" :show-summary="false" />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import ModelCategorySwitch from './ModelCategorySwitch.vue'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', model: any): void
}>()

const quickAdd = ref({ displayName: '', modelId: '', category: 'text' as 'text' | 'vision' | 'summary' })

watch(() => props.show, (newVal) => {
  if (newVal) {
    quickAdd.value = { displayName: '', modelId: '', category: 'text' }
  }
})

const generateJsCode = (modelId: string, category: 'text' | 'vision' | 'summary' = 'text'): string => {
  if (category === 'vision') {
    return `async function processModel(input, config, abortSignal) {
  const requestData = {
    messages: input.messages,
    model: '${modelId}',
    stream: true,
    max_tokens: 4096,
  };
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
                  const finished = data.choices[0].finish_reason === 'stop';
                  if (content || reasoning_content || finished) yield { content, reasoning_content, finished };
                }
              } catch (e) { console.warn('解析失败:', e); }
            }
          }
        }
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
                  const finished = data.choices[0].finish_reason === 'stop';
                  if (content || reasoning_content || finished) yield { content, reasoning_content, finished };
                }
              } catch (e) { console.warn('解析失败:', e); }
            }
          }
        }
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
    jsCode
  }
  emit('save', newModel)
}
</script>

<style>
@import '../styles/dialog.css';
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


</style>
