<template>
  <div class="image-generator">
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
      
      <!-- 显示原始HTML按钮 -->
      <div class="html-controls">
        <button @click="showHtml = !showHtml" class="show-html-btn">
          {{ showHtml ? '隐藏HTML' : '显示HTML' }}
        </button>
      </div>
      
      <!-- 原始HTML显示区域 -->
      <div v-if="showHtml" class="html-display">
        <h4>原始HTML内容：</h4>
        <pre class="html-content">{{ integratedContent }}</pre>
      </div>
    </div>
    
    <!-- 隐藏的渲染容器 -->
    <div ref="renderContainer" class="render-container" :class="{ 'hidden': finalImageUrl }">
      <div class="content-to-render" v-html="integratedContent"></div>
    </div>
    
    <!-- 如果没有URL内容，显示普通markdown -->
    <div v-if="!hasUrls && !finalImageUrl" class="normal-content">
      <PureMarkdownRenderer :content="content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, nextTick, watch, ref } from 'vue'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import PureMarkdownRenderer from './PureMarkdownRenderer.vue'
import UrlToImage from './UrlToImage.vue'
import { invoke } from '@tauri-apps/api/core'
import * as htmlToImage from 'html-to-image'

interface Props {
  content: string
  shouldRender?: boolean // 新增：控制是否应该渲染
}

const props = withDefaults(defineProps<Props>(), {
  shouldRender: true
})
const emit = defineEmits<{
  imageReady: [imageUrl: string]
  renderComplete: []
}>()

// 渲染相关状态
const isRendering = ref(false)
const renderError = ref('')
const finalImageUrl = ref('')
const renderContainer = ref<HTMLElement>()
const showHtml = ref(false)

// 检测内容是否包含URL
const hasUrls = computed(() => {
  if (!props.content) return false
  const urlRegex = /https?:\/\/[^\s\u4e00-\u9fff\uff00-\uffef，。；：！？""''（）【】《》]+/g
  return urlRegex.test(props.content)
})

// 集成内容处理
const integratedContent = computed(() => {
  if (!props.content || !hasUrls.value) return ''
  
  try {
    let processedContent = props.content
    
    // 处理数学公式
    processedContent = processedContent.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
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
    
    processedContent = processedContent.replace(/\$([^$\n]+?)\$/g, (match, formula) => {
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
    
    // 处理URL - 改进版，使用字符串分析而非正则表达式
    const urlRegex = /https?:\/\/[^\s\u4e00-\u9fff\uff00-\uffef，。；：！？""''（）【】《》]+/g
    let urlIndex = 0
    
    processedContent = processedContent.replace(urlRegex, (matchedUrl) => {
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
            console.log(`🔧 检测到 ${urls.length} 个URL，使用第一个: ${cleanUrl}`)
            console.log(`🔧 所有URL: ${urls.join(', ')}`)
          }
        }
      }
      
      urlIndex++
      return `<span class="inline-url-section">
        <img src="" alt="正在加载..." class="url-image-placeholder inline-image" data-url="${cleanUrl}" />
      </span>`
    })
    
    // 渲染Markdown
    const markdownHtml = marked(processedContent, {
      breaks: true,
      gfm: true
    }) as string
    
    // 删除<br>换行标签
    return markdownHtml.replace(/<br\s*\/?>/gi, '')
  } catch (error) {
    console.error('Content processing error:', error)
    return props.content
  }
})

// 渲染完整内容为图片
const renderCompleteContent = async () => {
  if (!hasUrls.value || !renderContainer.value) return
  
  isRendering.value = true
  renderError.value = ''
  finalImageUrl.value = ''
  
  try {
    console.log('📸 开始渲染完整内容')
    
    await nextTick()
    
    // 获取所有URL图片占位符（包括内联图片）
    const placeholders = renderContainer.value.querySelectorAll('.url-image-placeholder')
    console.log(`找到 ${placeholders.length} 个URL图片占位符`)
    
    // 为每个URL生成图片
    const imagePromises = Array.from(placeholders).map(async (placeholder, index) => {
      const url = (placeholder as HTMLElement).dataset.url
      if (!url) return
      
      try {
        console.log(`📸 开始获取URL图片 ${index + 1}: ${url}`)
        
        // 使用fetch_image_as_base64命令获取图片
        const imageData = await invoke('fetch_image_as_base64', {
          url: url
        }) as string
        
        if (imageData) {
          const img = placeholder as HTMLImageElement
          img.src = imageData // imageData已经是完整的data URL
          img.alt = `网页图片: ${url}`
          img.style.maxWidth = '100%'
          img.style.height = 'auto'
          img.style.border = '1px solid #ddd'
          img.style.borderRadius = '4px'
          
          console.log(`✅ URL图片 ${index + 1} 获取成功`)
        }
      } catch (error) {
        console.error(`❌ URL图片 ${index + 1} 获取失败:`, error)
        const img = placeholder as HTMLImageElement
        img.style.background = '#ffebee'
        img.style.color = '#c62828'
        img.style.padding = '20px'
        img.style.textAlign = 'center'
        img.alt = `图片加载失败: ${error}`
        img.style.display = 'block'
        img.style.minHeight = '100px'
        
        // 添加错误文本
        const errorDiv = document.createElement('div')
        errorDiv.textContent = `图片加载失败: ${url}`
        errorDiv.style.color = '#c62828'
        errorDiv.style.fontSize = '14px'
        errorDiv.style.padding = '10px'
        errorDiv.style.textAlign = 'center'
        
        // 替换图片元素
        if (img.parentNode) {
          img.parentNode.replaceChild(errorDiv, img)
        }
      }
    })
    
    await Promise.all(imagePromises)
    
    // 等待一段时间确保所有内容都已渲染完成
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    console.log('📸 开始截图完整内容')
    
    const contentElement = renderContainer.value.querySelector('.content-to-render') as HTMLElement
    
    if (!contentElement) {
      throw new Error('找不到内容元素')
    }
    
    // 确保所有图片都已加载完成或显示错误状态
    const allImages = contentElement.querySelectorAll('img')
    const imageLoadPromises = Array.from(allImages).map(img => {
      return new Promise<void>((resolve) => {
        if (img.complete) {
          resolve()
        } else {
          const onLoad = () => {
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve()
          }
          const onError = () => {
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            // 图片加载失败时，设置一个默认的占位符
            img.style.display = 'none'
            resolve()
          }
          img.addEventListener('load', onLoad)
          img.addEventListener('error', onError)
          
          // 设置超时，避免无限等待
          setTimeout(() => {
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve()
          }, 5000)
        }
      })
    })
    
    await Promise.all(imageLoadPromises)
    
    // 额外等待确保所有内容完全渲染
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 截图前临时将容器移到可见区域（html-to-image 需要元素在视口内才能正确计算尺寸）
    const originalTop = renderContainer.value.style.top
    const originalLeft = renderContainer.value.style.left
    const originalOpacity = renderContainer.value.style.opacity
    // opacity:0 让元素透明但仍参与布局，html-to-image 能正确计算尺寸
    renderContainer.value.style.top = '0'
    renderContainer.value.style.left = '0'
    renderContainer.value.style.opacity = '0'
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 强制重新计算布局
    contentElement.style.display = 'none'
    contentElement.offsetHeight // 触发重排
    contentElement.style.display = 'block'
    
    // 再次等待布局稳定
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 计算更准确的容器尺寸
    const rect = contentElement.getBoundingClientRect()
    const computedStyle = window.getComputedStyle(contentElement)
    const paddingTop = parseInt(computedStyle.paddingTop) || 0
    const paddingBottom = parseInt(computedStyle.paddingBottom) || 0
    const paddingLeft = parseInt(computedStyle.paddingLeft) || 0
    const paddingRight = parseInt(computedStyle.paddingRight) || 0
    
    // 使用更大的尺寸确保不被裁切
    const captureWidth = Math.max(
      contentElement.scrollWidth,
      contentElement.offsetWidth,
      rect.width
    ) + paddingLeft + paddingRight + 40 // 额外添加40px边距
    
    const captureHeight = Math.max(
      contentElement.scrollHeight,
      contentElement.offsetHeight,
      rect.height
    ) + paddingTop + paddingBottom + 40 // 额外添加40px边距
    
    console.log('📐 计算截图尺寸:', {
      scrollWidth: contentElement.scrollWidth,
      scrollHeight: contentElement.scrollHeight,
      offsetWidth: contentElement.offsetWidth,
      offsetHeight: contentElement.offsetHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
      captureWidth,
      captureHeight
    })
    
    const dataUrl = await htmlToImage.toPng(contentElement, {
      quality: 0.95,
      backgroundColor: '#ffffff',
      cacheBust: true,
      pixelRatio: 2,
      width: captureWidth,
      height: captureHeight,
      style: {
        overflow: 'visible',
        padding: '20px',
        opacity: '1'  // 覆盖父容器的 opacity:0，确保截图内容可见
      },
      filter: (node) => {
        // 过滤掉加载失败的图片元素
        if (node instanceof HTMLImageElement && !node.src) {
          return false
        }
        return true
      }
    })
    
    finalImageUrl.value = dataUrl
    isRendering.value = false
    
    // 恢复容器位置
    renderContainer.value.style.top = originalTop
    renderContainer.value.style.left = originalLeft
    renderContainer.value.style.opacity = originalOpacity
    
    console.log('✅ 完整内容渲染成功')
    
    // 发出事件
    emit('imageReady', dataUrl)
    emit('renderComplete')
    
  } catch (error) {
    console.error('❌ 完整内容渲染失败:', error)
    renderError.value = `渲染失败: ${error instanceof Error ? error.message : '未知错误'}`
    isRendering.value = false
    // 确保容器位置被恢复
    if (renderContainer.value) {
      renderContainer.value.style.top = '-9999px'
      renderContainer.value.style.left = '-9999px'
      renderContainer.value.style.opacity = ''
    }
  }
}

// 重试渲染
const retryRender = () => {
  renderCompleteContent()
}

// 监听内容变化和渲染控制
watch(() => [props.content, props.shouldRender], async ([newContent, shouldRender]: [any, any]) => {
  if (shouldRender && hasUrls.value) {
    console.log('🔄 内容变化，开始渲染:', { 
      hasUrls: hasUrls.value, 
      shouldRender,
      contentLength: newContent.length 
    })
    await nextTick()
    setTimeout(() => {
      renderCompleteContent()
    }, 500)
  } else {
    console.log('⏸️ 跳过渲染:', { 
      hasUrls: hasUrls.value, 
      shouldRender,
      reason: !shouldRender ? '缓存控制' : '无URL内容'
    })
    
    // 如果不需要渲染但没有URL，仍然发出完成事件
    if (!hasUrls.value) {
      emit('renderComplete')
    }
  }
}, { immediate: true })

// 组件挂载时开始渲染
onMounted(async () => {
  if (props.shouldRender && hasUrls.value) {
    console.log('🚀 组件挂载，开始渲染')
    await nextTick()
    setTimeout(() => {
      renderCompleteContent()
    }, 1000)
  } else {
    console.log('⏸️ 组件挂载，跳过渲染:', { 
      shouldRender: props.shouldRender, 
      hasUrls: hasUrls.value 
    })
    
    // 如果不需要渲染，直接发出完成事件
    emit('renderComplete')
  }
})
</script>

<style scoped>
.image-generator {
  width: 100%;
}

/* 渲染状态样式 */
.rendering-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--bg-tertiary);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.rendering-state p {
  margin: 0;
  font-size: 14px;
}

/* 渲染错误样式 */
.render-error {
  padding: 20px;
  text-align: center;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin: 16px 0;
}

.error-message {
  color: var(--danger-color);
  margin: 0 0 16px 0;
  font-size: 14px;
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

/* 图片容器样式 */
.final-image-wrapper {
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

.final-image {
  max-width: 600px !important;
  width: auto !important;
  height: auto !important;
  border: 1px solid #ddd !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
  background: white !important;
  display: block !important;
  margin: 0 auto !important;
}

/* HTML控制按钮样式 */
.html-controls {
  margin-top: 16px;
  text-align: center;
}

.show-html-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.show-html-btn:hover {
  background: var(--bg-secondary);
  border-color: var(--primary-color);
}

/* HTML显示区域样式 */
.html-display {
  margin-top: 16px;
  text-align: left;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 16px;
}

.html-display h4 {
  margin: 0 0 12px 0;
  color: var(--text-primary);
  font-size: 16px;
}

.html-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 400px;
  overflow-y: auto;
  margin: 0;
}

/* 渲染容器样式 */
.render-container {
  position: fixed;
  top: -9999px;
  left: -9999px;
  width: 800px;
  background: white;
  padding: 30px; /* 增加内边距防止裁切 */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  line-height: 1.6;
  color: #333;
  box-sizing: border-box; /* 确保padding包含在尺寸计算中 */
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
  margin: 12px 0 6px 0; /* 减少标题的上下边距 */
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
  margin: 4px 0; /* 减少段落间距 */
  color: #333 !important;
  line-height: 1.6; /* 适当的行高，便于内联图片对齐 */
  word-wrap: break-word; /* 允许长单词换行 */
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
  margin: 8px 0; /* 减少列表的上下边距 */
  padding-left: 20px;
  color: #333 !important;
}

.render-container .content-to-render li {
  margin: 2px 0; /* 减少列表项的间距 */
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
  margin: 8px 0; /* 减少表格的上下边距 */
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

/* URL相关样式 */
.render-container .content-to-render .url-section {
  margin: 8px 0; /* 减少上下边距 */
  padding: 8px; /* 减少内边距 */
  border: 1px solid #ddd !important;
  border-radius: 6px;
  background: #f9f9f9 !important;
}

/* 内联URL图片样式 */
.render-container .content-to-render .inline-url-section {
  display: inline;
  margin: 0 4px; /* 左右小间距 */
}

.render-container .content-to-render .inline-image {
  display: inline-block;
  vertical-align: middle; /* 与文字基线对齐 */
  max-width: 200px; /* 限制内联图片的最大宽度 */
  max-height: 150px; /* 限制内联图片的最大高度 */
  width: auto;
  height: auto;
  border: 1px solid #ddd !important;
  border-radius: 4px;
  background: #f0f0f0 !important;
  margin: 0 2px; /* 图片左右小间距 */
}

.render-container .content-to-render .url-image-placeholder {
  display: block;
  margin: 4px auto; /* 减少图片的上下边距 */
  max-width: 100%;
  height: auto;
  border: 1px solid #ddd !important;
  border-radius: 4px;
  background: #f0f0f0 !important;
}

/* 普通内容样式 */
.normal-content {
  width: 100%;
}
</style>