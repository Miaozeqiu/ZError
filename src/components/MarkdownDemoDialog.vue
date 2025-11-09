<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content markdown-demo-dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">Vue Renderer Markdown 演示</h3>
        <button class="dialog-close" @click="closeDialog">×</button>
      </div>
      <div class="dialog-body">
        <div class="demo-controls">
          <button @click="startStreaming" :disabled="isStreaming" class="btn btn-primary">
            {{ isStreaming ? '流式渲染中...' : '开始流式演示' }}
          </button>
          <button @click="resetDemo" class="btn btn-secondary">重置</button>
        </div>
        
        <div class="markdown-container">
          <PureMarkdownRenderer :content="currentMarkdown" />
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-primary" @click="closeDialog">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import PureMarkdownRenderer from './PureMarkdownRenderer.vue'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const isStreaming = ref(false)
const currentMarkdown = ref('')

// 演示用的Markdown内容
const demoMarkdown = `# Vue Renderer Markdown 演示

这是一个专为 **AI 流式渲染** 设计的 Vue 3 Markdown 组件。

## 🚀 主要特性

- ⚡ **超高性能**：针对实时流式渲染优化
- 🌊 **流式优先**：专为不完整、快速更新的内容设计
- 🧠 **Monaco 集成**：支持代码块的增量更新
- 🪄 **渐进式 Mermaid**：图表逐步渲染
- 📝 **完整 Markdown 支持**：表格、数学公式、emoji 等

## 数学公式支持

行内公式：$E = mc^2$

块级公式：
$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

## 代码块示例

\`\`\`javascript
// Vue 3 组件示例
import { ref, computed } from 'vue'
import { MarkdownRender } from 'vue-renderer-markdown'

export default {
  setup() {
    const markdown = ref('# Hello World')
    return { markdown }
  }
}
\`\`\`

## 表格支持

| 特性 | 传统渲染器 | Vue Renderer Markdown |
|------|------------|----------------------|
| 流式渲染 | ❌ | ✅ |
| 增量更新 | ❌ | ✅ |
| 数学公式 | 部分支持 | ✅ |
| 代码高亮 | ✅ | ✅ |

## 列表功能

1. **有序列表**
   - 支持嵌套
   - 自动编号
   
2. **无序列表**
   - 多种样式
   - 灵活布局

## 引用块

> 这是一个引用块示例
> 
> 支持多行内容和 **格式化文本**

## Emoji 支持

🎉 庆祝！🚀 快速！💡 创新！

---

**感谢使用 Vue Renderer Markdown！** 🙏`

// 流式演示函数
const startStreaming = async () => {
  isStreaming.value = true
  currentMarkdown.value = ''
  
  const text = demoMarkdown
  const delay = 30 // 毫秒
  
  for (let i = 0; i <= text.length; i++) {
    currentMarkdown.value = text.slice(0, i)
    await new Promise(resolve => setTimeout(resolve, delay))
    
    if (!isStreaming.value) break // 允许中断
  }
  
  isStreaming.value = false
}

// 重置演示
const resetDemo = () => {
  isStreaming.value = false
  currentMarkdown.value = ''
}

// 弹窗控制
const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.classList.contains('dialog-overlay')) {
    closeDialog()
  }
}

const closeDialog = () => {
  isStreaming.value = false
  emit('close')
}

// 监听弹窗显示状态
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    currentMarkdown.value = demoMarkdown // 默认显示完整内容
  } else {
    resetDemo()
  }
})
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.markdown-demo-dialog {
  width: 800px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
}

.dialog-content {
  background: var(--bg-primary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
}

.dialog-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.dialog-close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dialog-body {
  padding: 20px;
}

.dialog-footer {
  padding: 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
}

.demo-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border-color);
}

.markdown-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 20px;
  max-height: 500px;
  overflow-y: auto;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-color-hover);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-secondary);
}
</style>