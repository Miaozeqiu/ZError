<template>
  <div class="pure-markdown-content" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Props {
  content: string
}

const props = defineProps<Props>()

// 渲染Markdown内容
const renderedContent = computed(() => {
  if (!props.content) return ''
  
  try {
    // 处理数学公式
    let mathProcessed = props.content
    
    // 处理块级数学公式 $$...$$
    mathProcessed = mathProcessed.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
      try {
        const rendered = katex.renderToString(formula.trim(), {
          displayMode: true,
          throwOnError: false
        })
        return `<div class="katex-display">${rendered}</div>`
      } catch (error) {
        console.warn('KaTeX block render error:', error)
        return `<div class="katex-error">$$${formula}$$</div>`
      }
    })
    
    // 处理行内数学公式 $...$
    mathProcessed = mathProcessed.replace(/\$([^$\n]+?)\$/g, (match, formula) => {
      try {
        const rendered = katex.renderToString(formula.trim(), {
          displayMode: false,
          throwOnError: false
        })
        return `<span class="katex-inline">${rendered}</span>`
      } catch (error) {
        console.warn('KaTeX inline render error:', error)
        return `<span class="katex-error">$${formula}$</span>`
      }
    })
    
    // 渲染Markdown
    return marked(mathProcessed, {
      breaks: true,
      gfm: true,
      sanitize: false
    })
  } catch (error) {
    console.error('Markdown render error:', error)
    return props.content
  }
})
</script>

<style scoped>
/* 纯Markdown内容样式 */
.pure-markdown-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  color: var(--text-primary);
  line-height: 1.6;
}

.pure-markdown-content :deep(h1),
.pure-markdown-content :deep(h2),
.pure-markdown-content :deep(h3),
.pure-markdown-content :deep(h4),
.pure-markdown-content :deep(h5),
.pure-markdown-content :deep(h6) {
  color: var(--text-primary);
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.pure-markdown-content :deep(h1) {
  font-size: 2em;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 10px;
}

.pure-markdown-content :deep(h2) {
  font-size: 1.5em;
}

.pure-markdown-content :deep(h3) {
  font-size: 1.3em;
}

.pure-markdown-content :deep(p) {
  margin: 8px 0;
  color: var(--text-primary);
}

.pure-markdown-content :deep(code) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.pure-markdown-content :deep(pre) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  border: 1px solid var(--border-color);
}

.pure-markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  border-radius: 0;
}

.pure-markdown-content :deep(blockquote) {
  border-left: 4px solid var(--border-color);
  margin: 16px 0;
  padding: 0 16px;
  color: var(--text-secondary);
  font-style: italic;
}

.pure-markdown-content :deep(ul),
.pure-markdown-content :deep(ol) {
  margin: 12px 0;
  padding-left: 20px;
}

.pure-markdown-content :deep(li) {
  margin: 4px 0;
  color: var(--text-primary);
}

.pure-markdown-content :deep(strong) {
  font-weight: 600;
  color: var(--text-primary);
}

.pure-markdown-content :deep(em) {
  font-style: italic;
  color: var(--text-primary);
}

.pure-markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 20px 0;
}

.pure-markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.pure-markdown-content :deep(th),
.pure-markdown-content :deep(td) {
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  text-align: left;
}

.pure-markdown-content :deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
}

.pure-markdown-content :deep(a) {
  color: var(--primary-color);
  text-decoration: none;
}

.pure-markdown-content :deep(a:hover) {
  text-decoration: underline;
}

/* KaTeX 数学公式样式 */
.pure-markdown-content :deep(.katex) {
  font-size: 1em;
}

.pure-markdown-content :deep(.katex-display) {
  margin: 16px 0;
  text-align: center;
}

.pure-markdown-content :deep(.katex-inline) {
  display: inline;
}

.pure-markdown-content :deep(.katex-error) {
  color: var(--danger-color, #e74c3c);
  background: var(--bg-tertiary);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
}

/* 确保KaTeX在暗色主题下正确显示 */
.pure-markdown-content :deep(.katex .mord) {
  color: var(--text-primary);
}

.pure-markdown-content :deep(.katex .mbin),
.pure-markdown-content :deep(.katex .mrel),
.pure-markdown-content :deep(.katex .mop) {
  color: var(--text-primary);
}
</style>