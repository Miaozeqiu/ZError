<template>
  <p v-if="hint" class="model-response-hint">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4m0 4h.01" />
    </svg>
    <span><strong>{{ hint.title }}</strong>{{ hint.description }}</span>
  </p>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ message: string }>()

const isModelApiKeyError = (text: string) =>
  /\bHTTP\s+401\b/i.test(text) ||
  /\b(?:invalid|incorrect|expired|missing)[ _-]+api[ _-]*key\b/i.test(text) ||
  /\bapi[ _-]*key\b\s*(?:is\s+)?(?:invalid|incorrect|expired|missing)\b/i.test(text) ||
  /(?:API\s*Key|密钥)\s*(?:无效|不正确|错误|已过期|缺失)/i.test(text)

const hint = computed(() => {
  if (/\bHTTP\s+404\b/i.test(props.message)) {
    return {
      title: '找不到模型接口或指定模型。',
      description: '请在「模型设置」中核对对应平台的完整请求 URL、接口协议和模型 ID。',
    }
  }
  if (isModelApiKeyError(props.message)) {
    return {
      title: 'API Key 无效。',
      description: '请在「模型设置」中为对应平台填写正确的 API Key。',
    }
  }
})
</script>

<style scoped>
.model-response-hint {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  margin: 10px 0 0;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.model-response-hint > svg,
.model-response-hint strong {
  color: var(--multi-model-tab-failed-text);
}

.model-response-hint > svg {
  margin-top: 2px;
}

.model-response-hint strong {
  font-weight: 650;
}
</style>
