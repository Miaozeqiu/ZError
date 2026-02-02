<template>
  <div class="markdown-content">
    <!-- 如果内容包含URL，显示特殊处理 -->
    <div v-if="hasUrls" class="url-content">
      <!-- 渲染状态显示 -->
      <div v-if="isRendering" class="rendering-state">
        <div class="loading-spinner"></div>
        <p>正在渲染完整内容为图片...</p>
      </div>
      
      <!-- 渲染错误显示 -->
      <div v-else-if="renderError" class="render-error">
        <p class="error-message">{{ renderError }}</p>
        <button @click="retryRender" class="retry-button">重试渲染</button>
      </div>
      
      <!-- 最终渲染的图片 -->
      <div v-if="finalImageUrl" class="final-image-wrapper">
        <img :src="finalImageUrl" alt="完整内容图片" class="final-image" />
      </div>
      
      <!-- 隐藏的渲染容器 -->
      <div ref="renderContainer" class="render-container" :class="{ 'hidden': finalImageUrl }">
        <div class="content-to-render" v-html="integratedContent"></div>
      </div>
    </div>
    
    <!-- 正常的Markdown内容 -->
    <div v-else v-html="renderedContent"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, nextTick, watch, ref } from 'vue'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import UrlToImage from './UrlToImage.vue'
import { invoke } from '@tauri-apps/api/core'
import * as htmlToImage from 'html-to-image'

interface Props {
  content: string
  enableTyping?: boolean
  typingSpeed?: number
}

const props = withDefaults(defineProps<Props>(), {
  enableTyping: false,
  typingSpeed: 30
})

// 渲染状态
const isRendering = ref(false)
const renderError = ref('')
const finalImageUrl = ref('')
const renderContainer = ref<HTMLElement>()

// URL检测正则表达式 - 改进版，正确处理中文标点符号
const urlRegex = /https?:\/\/[^\s\u4e00-\u9fff\uff00-\uffef，。；：！？""''（）【】《》]+/g

// 检测内容中是否包含URL
const hasUrls = computed(() => {
  return urlRegex.test(props.content)
})

// 提取所有URL - 改进版，处理重复URL
const extractedUrls = computed(() => {
  if (!props.content) return []
  const matches = props.content.match(urlRegex)
  if (!matches) return []
  
  // 处理每个匹配的URL，分离重复的URL
  const processedUrls: string[] = []
  
  matches.forEach(matchedUrl => {
     // 清理URL末尾的标点符号
     let cleanUrl = matchedUrl.replace(/[.,;!?]*$/, '')
     
     // 使用字符串分析方法分离重复URL
     if (cleanUrl.includes('http://') || cleanUrl.includes('https://')) {
       const urls = []
       let currentUrl = ''
       let i = 0
       
       while (i < cleanUrl.length) {
         if (cleanUrl.substring(i, i + 7) === 'http://' || cleanUrl.substring(i, i + 8) === 'https://') {
           // 如果已经有当前URL，保存它
           if (currentUrl) {
             urls.push(currentUrl)
           }
           // 开始新的URL
           currentUrl = cleanUrl.substring(i, i + (cleanUrl.substring(i, i + 8) === 'https://' ? 8 : 7))
           i += (cleanUrl.substring(i, i + 8) === 'https://' ? 8 : 7)
         } else {
           const char = cleanUrl[i]
           // 检查字符是否为有效的URL字符
           if (/[a-zA-Z0-9%\-._~:/?#[\]@!$&'()*+,;=]/.test(char)) {
             currentUrl += char
             i++
           } else {
             // 遇到无效字符，结束当前URL
             if (currentUrl) {
               urls.push(currentUrl)
               currentUrl = ''
             }
             i++
           }
         }
       }
       
       // 添加最后一个URL
       if (currentUrl) {
         urls.push(currentUrl)
       }
       
       // 使用第一个有效的URL
       if (urls.length > 0) {
         cleanUrl = urls[0]
         if (urls.length > 1) {
           console.log(`🔧 MarkdownRenderer检测到 ${urls.length} 个URL，使用第一个: ${cleanUrl}`)
           console.log(`🔧 所有URL: ${urls.join(', ')}`)
         }
       }
     }
     
     processedUrls.push(cleanUrl)
   })
  
  return [...new Set(processedUrls)] // 去重
})

// 移除URL后的纯文本内容
const textOnlyContent = computed(() => {
  if (!props.content) return ''
  
  // 保留文字部分，将URL替换为占位符
  const textWithPlaceholders = props.content.replace(urlRegex, (match, offset) => {
    const urlIndex = extractedUrls.value.indexOf(match)
    return `\n\n**[图片 ${urlIndex + 1}]**\n\n`
  })
  
  try {
    // 先处理数学公式
    const mathProcessed = renderMath(textWithPlaceholders)
    
    // 然后渲染Markdown
    return marked(mathProcessed, {
      breaks: true,
      gfm: true
    }) as string
  } catch (error) {
    console.error('Markdown render error:', error)
    return textWithPlaceholders
  }
})

// 集成内容：将文字和图片组件结合
const integratedContent = computed(() => {
  if (!props.content || !hasUrls.value) return renderedContent.value
  
  let content = props.content
  const urls = extractedUrls.value
  
  // 为每个URL创建一个唯一的占位符
  urls.forEach((url, index) => {
    const placeholder = `URL_PLACEHOLDER_${index}`
    content = content.replace(url, placeholder)
  })
  
  try {
    // 处理数学公式
    const mathProcessed = renderMath(content)
    
    // 渲染Markdown
    let htmlContent = marked(mathProcessed, {
      breaks: true,
      gfm: true
    }) as string
    
    // 将占位符替换为图片占位符的HTML
    urls.forEach((url, index) => {
      const placeholder = `URL_PLACEHOLDER_${index}`
      const imageHtml = `<img class="url-image-placeholder" data-url="${url}" data-index="${index}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; background: #f0f0f0; min-height: 100px; display: block; margin: 8px 0;" alt="图片 ${index + 1}" />`
      htmlContent = htmlContent.replace(placeholder, imageHtml)
    })
    
    return htmlContent
  } catch (error) {
    console.error('Integrated content render error:', error)
    return content
  }
})

// 处理数学公式的函数
const renderMath = (text: string) => {
  // 处理块级数学公式 $$...$$
  text = text.replace(/\$\$([^$]+)\$\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula.trim(), { displayMode: true })
    } catch (e) {
      console.warn('KaTeX render error:', e)
      return match
    }
  })
  
  // 处理行内数学公式 $...$
  text = text.replace(/\$([^$]+)\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula.trim(), { displayMode: false })
    } catch (e) {
      console.warn('KaTeX render error:', e)
      return match
    }
  })
  
  return text
}

// 渲染完整内容为图片
const renderCompleteContent = async () => {
  if (!renderContainer.value) return
  
  try {
    isRendering.value = true
    renderError.value = ''
    finalImageUrl.value = ''
    
    console.log('🎨 开始渲染完整内容为图片')
    
    // 等待DOM更新
    await nextTick()
    
    // 获取所有图片占位符
    const imagePlaceholders = renderContainer.value.querySelectorAll('.url-image-placeholder')
    
    // 并行加载所有图片
    const imagePromises = Array.from(imagePlaceholders).map(async (placeholder) => {
      const url = placeholder.getAttribute('data-url')
      const index = placeholder.getAttribute('data-index')
      
      if (!url) return
      
      try {
        console.log(`🖼️ 加载图片 ${parseInt(index || '0') + 1}:`, url)
        
        // 使用Rust后端获取图片
        const base64DataUrl = await invoke<string>('fetch_image_as_base64', { url })
        
        // 替换占位符为实际图片
        const img = placeholder as HTMLImageElement
        img.src = base64DataUrl
        img.style.background = 'transparent'
        
        console.log(`✅ 图片 ${parseInt(index || '0') + 1} 加载成功`)
      } catch (error) {
        console.error(`❌ 图片 ${parseInt(index || '0') + 1} 加载失败:`, error)
        
        // 显示错误占位符
        const img = placeholder as HTMLImageElement
        img.style.background = '#ffebee'
        img.style.color = '#c62828'
        img.alt = `图片加载失败: ${error}`
      }
    })
    
    // 等待所有图片加载完成
    await Promise.all(imagePromises)
    
    // 等待一段时间确保图片完全渲染
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    console.log('📸 开始截图完整内容')
    
    // 使用html-to-image渲染整个容器
    const contentElement = renderContainer.value.querySelector('.content-to-render') as HTMLElement
    
    if (!contentElement) {
      throw new Error('找不到内容元素')
    }
    
    const dataUrl = await htmlToImage.toPng(contentElement, {
      quality: 0.95,
      backgroundColor: '#ffffff',
      cacheBust: true,
      pixelRatio: 2, // 提高清晰度
      width: contentElement.scrollWidth,
      height: contentElement.scrollHeight
    })
    
    finalImageUrl.value = dataUrl
    isRendering.value = false
    
    console.log('✅ 完整内容渲染成功')
    
  } catch (error) {
    console.error('❌ 完整内容渲染失败:', error)
    renderError.value = `渲染失败: ${error instanceof Error ? error.message : '未知错误'}`
    isRendering.value = false
  }
}

// 重试渲染
const retryRender = () => {
  renderCompleteContent()
}

// 下载最终图片
const downloadFinalImage = () => {
  if (!finalImageUrl.value) return
  
  const link = document.createElement('a')
  link.download = `complete-content-${Date.now()}.png`
  link.href = finalImageUrl.value
  link.click()
}

// 复制最终图片到剪贴板
const copyFinalImage = async () => {
  if (!finalImageUrl.value) return
  
  try {
    const response = await fetch(finalImageUrl.value)
    const blob = await response.blob()
    
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob
      })
    ])
    
    console.log('图片已复制到剪贴板')
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 监听内容变化，重新渲染
watch(() => props.content, () => {
  if (hasUrls.value) {
    setTimeout(renderCompleteContent, 100)
  }
})

// 组件挂载后开始渲染
onMounted(() => {
  if (hasUrls.value) {
    setTimeout(renderCompleteContent, 100)
  }
})

// 渲染Markdown的计算属性
const renderedContent = computed(() => {
  if (!props.content) return ''
  
  try {
    // 先处理数学公式
    const mathProcessed = renderMath(props.content)
    
    // 然后渲染Markdown
    return marked(mathProcessed, {
      breaks: true,
      gfm: true
    }) as string
  } catch (error) {
    console.error('Markdown render error:', error)
    return props.content // 如果渲染失败，返回原始内容
  }
})
</script>

<style scoped>
/* Markdown 内容样式 */
.markdown-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  color: var(--text-primary);
  line-height: 1.6;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  color: var(--text-primary);
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 2em;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 10px;
}

.markdown-content :deep(h2) {
  font-size: 1.5em;
}

.markdown-content :deep(h3) {
  font-size: 1.3em;
}

.markdown-content :deep(p) {
  margin: 8px 0;
  color: var(--text-primary);
}

.markdown-content :deep(code) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.9em;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--primary-color);
  padding-left: 16px;
  margin: 16px 0;
  color: var(--text-secondary);
  font-style: italic;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 20px;
  margin: 8px 0;
}

.markdown-content :deep(li) {
  margin: 4px 0;
  color: var(--text-primary);
}

.markdown-content :deep(strong) {
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-content :deep(em) {
  font-style: italic;
  color: var(--text-primary);
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 20px 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
}

.markdown-content :deep(a) {
  color: var(--primary-color);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

/* KaTeX 数学公式样式 */
.markdown-content :deep(.katex) {
  font-size: 1em;
}

.markdown-content :deep(.katex-display) {
  margin: 16px 0;
  text-align: center;
}

/* 确保KaTeX在暗色主题下正确显示 */
.markdown-content :deep(.katex .mord) {
  color: var(--text-primary);
}

/* URL内容样式 */
.url-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 渲染状态样式 */
.rendering-state {
  text-align: center;
  padding: 40px 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 渲染错误样式 */
.render-error {
  text-align: center;
  padding: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--danger-color);
  border-radius: 8px;
}

.error-message {
  color: var(--danger-color);
  margin-bottom: 16px;
}

.retry-button {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s ease;
}

.retry-button:hover {
  background: var(--primary-color-hover);
}

/* 最终图片样式 - 减少边距 */
.final-image {
  max-width: 600px !important; /* 设置合理的最大宽度 */
  width: auto !important; /* 使用图片原始宽度 */
  height: auto !important; /* 保持宽高比 */
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background: white;
  display: block;
  margin: 8px auto; /* 减少上下边距 */
}

/* 图片内容容器 - 不受主题影响 */
.image-content {
  /* 重置所有可能受主题影响的样式 */
  color: initial !important;
  background: initial !important;
  font-family: initial !important;
}

.image-content * {
  /* 确保图片内的所有元素都不受主题影响 */
  color: initial !important;
  background: initial !important;
  border-color: initial !important;
}

/* 为图片内容创建独立的样式作用域 */
.final-image-wrapper {
  /* 隔离图片内容，防止主题样式渗透 */
  all: initial;
  display: block;
  text-align: center;
  margin: 8px auto;
}

.final-image-wrapper .final-image {
  max-width: 600px !important;
  width: auto !important;
  height: auto !important;
  border: 1px solid #ddd !important; /* 使用固定颜色，不受主题影响 */
  border-radius: 6px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
  background: white !important;
  display: block !important;
  margin: 0 auto !important;
}

.image-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.action-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.2s ease;
  display: inline-block;
}

.action-btn:hover {
  background: var(--bg-primary);
  border-color: var(--primary-color);
}

/* 渲染容器样式 */
.render-container {
  position: fixed;
  top: -9999px;
  left: -9999px;
  width: 800px;
  background: white;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  line-height: 1.6;
  color: #333;
}

.render-container.hidden {
  display: none;
}

.content-to-render {
  width: 100%;
}

/* 渲染容器内的内容样式 - 使用固定颜色，不受主题影响 */
.render-container .content-to-render {
  color: #333 !important;
  background: white !important;
}

.render-container .content-to-render h1,
.render-container .content-to-render h2,
.render-container .content-to-render h3,
.render-container .content-to-render h4,
.render-container .content-to-render h5,
.render-container .content-to-render h6 {
  color: #333 !important;
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.render-container .content-to-render h1 {
  font-size: 2em;
  border-bottom: 1px solid #ddd !important;
  padding-bottom: 10px;
}

.render-container .content-to-render h2 {
  font-size: 1.5em;
}

.render-container .content-to-render h3 {
  font-size: 1.3em;
}

.render-container .content-to-render p {
  margin: 8px 0;
  color: #333 !important;
}

.render-container .content-to-render code {
  background: #f5f5f5 !important;
  color: #333 !important;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.render-container .content-to-render pre {
  background: #f8f8f8 !important;
  color: #333 !important;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  border: 1px solid #ddd !important;
}

.render-container .content-to-render blockquote {
  border-left: 4px solid #ddd !important;
  margin: 16px 0;
  padding: 0 16px;
  color: #666 !important;
  font-style: italic;
}

.render-container .content-to-render ul,
.render-container .content-to-render ol {
  margin: 12px 0;
  padding-left: 20px;
  color: #333 !important;
}

.render-container .content-to-render li {
  margin: 4px 0;
  color: #333 !important;
}

.render-container .content-to-render strong {
  font-weight: 600;
  color: #333 !important;
}

.render-container .content-to-render em {
  font-style: italic;
  color: #333 !important;
}

.render-container .content-to-render hr {
  border: none;
  border-top: 1px solid #ddd !important;
  margin: 20px 0;
}

.render-container .content-to-render table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.render-container .content-to-render th,
.render-container .content-to-render td {
  border: 1px solid #ddd !important;
  padding: 8px 12px;
  text-align: left;
  color: #333 !important;
}

.render-container .content-to-render th {
  background: #f5f5f5 !important;
  font-weight: 600;
}

.render-container .content-to-render a {
  color: #007acc !important;
  text-decoration: none;
}

.render-container .content-to-render a:hover {
  text-decoration: underline;
}

/* 确保KaTeX数学公式在渲染容器中正确显示 */
.render-container .content-to-render .katex .mord {
  color: #333 !important;
}

.render-container .content-to-render .katex .mbin,
.render-container .content-to-render .katex .mrel,
.render-container .content-to-render .katex .mop {
  color: #333 !important;
}

/* URL图片占位符样式 */
.url-image-placeholder {
  display: block;
  margin: 8px auto;
  max-width: 100%;
  height: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #f0f0f0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .url-section {
    padding: 12px;
    margin: 12px 0;
  }
  
  .url-info {
    font-size: 13px;
    padding: 6px 10px;
  }
}
</style>