<template>
  <div v-if="reasoningContent || streamingReasoning || response" class="content-stack">
    <!-- 思考过程 -->
    <div v-if="reasoningContent || streamingReasoning" class="reasoning-section">
      <p class="section-title reasoning-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="reasoning-icon" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"></path><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"></path><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"></path><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"></path><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"></path><path d="M3.477 10.896a4 4 0 0 1 .585-.396"></path><path d="M19.938 10.5a4 4 0 0 1 .585.396"></path><path d="M6 18a4 4 0 0 1-1.967-.516"></path><path d="M19.967 17.484A4 4 0 0 1 18 18"></path></svg>
        <strong>{{ isLoading ? '实时思考过程' : '思考过程' }}</strong>
      </p>
      <div class="reasoning-content" :class="{ streaming: isLoading }">
        <MarkdownRender 
          :content="reasoningContent || streamingReasoning || ''" 
          :max-live-nodes="isLoading ? 0 : 320" 
          :batch-rendering="true"
          :render-batch-size="16"
          :render-batch-delay="8"
          :final="!isLoading" 
        />
      </div>
    </div>
    
    <!-- 响应结果 -->
    <div v-if="response" class="response-section">
      <p v-if="isLoading" class="section-title"><strong>实时响应结果</strong></p>
      <div class="response-content" :class="{ streaming: isLoading }">
        <MarkdownRender 
          :content="response" 
          :max-live-nodes="isLoading ? 0 : 320" 
          :batch-rendering="true"
          :render-batch-size="16"
          :render-batch-delay="8"
          :final="!isLoading" 
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownRender, { enableKatex, enableMermaid } from 'markstream-vue'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'

enableKatex()
enableMermaid()

defineProps<{
  reasoningContent?: string
  streamingReasoning?: string
  response?: string
  isLoading?: boolean
}>()
</script>

<style scoped>
.content-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 12px;
}

.response-section,
.reasoning-section {
  width: 100%;
  margin-top: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  overflow: visible;
  background: transparent;
  box-shadow: none;
}

.response-section {
  padding-top: 2px;
}

.response-content,
.reasoning-content {
  margin-top: 0;
  line-height: 1.85;
}

.response-content {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 500;
}

.response-content.streaming {
  animation: none;
}

.reasoning-section {
  padding: 8px 0 8px 16px;
  background: transparent;
  border-left: 1px solid var(--border-color);
  border-radius: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, var(--text-secondary));
}

.reasoning-title {
  color: var(--text-secondary);
}

.reasoning-content {
  color: var(--text-secondary);
  font-size: 15px;
}

.reasoning-content.streaming {
  min-height: 40px;
}

.reasoning-content :deep(p),
.response-content :deep(p) {
  margin: 0 0 14px;
}

.reasoning-content :deep(p:last-child),
.response-content :deep(p:last-child),
.reasoning-content :deep(ul:last-child),
.response-content :deep(ul:last-child),
.reasoning-content :deep(ol:last-child),
.response-content :deep(ol:last-child),
.reasoning-content :deep(blockquote:last-child),
.response-content :deep(blockquote:last-child) {
  margin-bottom: 0;
}

.reasoning-content :deep(ul),
.response-content :deep(ul),
.reasoning-content :deep(ol),
.response-content :deep(ol) {
  margin: 0 0 14px;
  padding-left: 24px;
}

.reasoning-content :deep(li),
.response-content :deep(li) {
  margin: 6px 0;
}

.reasoning-content :deep(strong),
.response-content :deep(strong) {
  color: inherit;
  font-weight: 700;
}

.reasoning-content :deep(blockquote),
.response-content :deep(blockquote) {
  margin: 0 0 14px;
  padding-left: 14px;
  border-left: 3px solid var(--border-color);
}
</style>
