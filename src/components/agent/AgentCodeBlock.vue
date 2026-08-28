<template>
  <AgentHtmlBlock
    v-if="isHtml"
    :node="node"
    :loading="loading"
    :is-dark="isDark"
  />
  <pre v-else-if="!isQuiz"><code :class="langClass">{{ code }}</code></pre>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AgentHtmlBlock from './AgentHtmlBlock.vue'

const props = defineProps<{
  node: Record<string, unknown>
  loading?: boolean
  isDark?: boolean
  indexKey?: string
}>()

const lang = computed(() => String(props.node.language || '').toLowerCase())
const isHtml = computed(() => ['html', 'htm', 'svg'].includes(lang.value))
const isQuiz = computed(() => lang.value === 'quiz')
const langClass = computed(() => (lang.value ? `language-${lang.value}` : ''))
const code = computed(() => String(props.node.code ?? props.node.content ?? props.node.raw ?? ''))
</script>
