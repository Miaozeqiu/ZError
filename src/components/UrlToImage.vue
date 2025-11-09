<template>
  <div class="url-to-image-container">
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在通过Rust后端获取图片...</p>
    </div>
    
    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <button @click="retryRender" class="retry-button">重试</button>
    </div>
    
    <div v-else-if="imageDataUrl" class="image-result">
      <img :src="imageDataUrl" :alt="`图片: ${url}`" class="rendered-image" />
      <div class="image-actions">
        <button @click="downloadImage" class="download-button">下载图片</button>
        <button @click="copyImageToClipboard" class="copy-button">复制图片</button>
        <a :href="url" target="_blank" rel="noopener noreferrer" class="view-original-button">查看原图</a>
      </div>
    </div>
    
    <!-- 隐藏的iframe用于渲染非图片URL -->
    <iframe 
      v-if="!isImageUrl && !imageDataUrl && !error"
      ref="urlFrame"
      :src="url"
      class="hidden-frame"
      @load="handleFrameLoad"
      @error="handleFrameError"
    ></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import * as htmlToImage from 'html-to-image'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  url: string
  width?: number
  height?: number
  quality?: number
}

const props = withDefaults(defineProps<Props>(), {
  width: 800,
  height: 600,
  quality: 0.95
})

const loading = ref(true)
const error = ref('')
const imageDataUrl = ref('')
const urlFrame = ref<HTMLIFrameElement>()

// 检测是否是图片URL
const isImageUrl = computed(() => {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']
  const urlLower = props.url.toLowerCase()
  
  // 检查文件扩展名
  const hasImageExtension = imageExtensions.some(ext => urlLower.includes(ext))
  
  // 检查URL路径中是否包含图片相关关键词
  const hasImageKeyword = urlLower.includes('image') || 
                          urlLower.includes('img') || 
                          urlLower.includes('photo') || 
                          urlLower.includes('picture')
  
  return hasImageExtension || hasImageKeyword
})

// 使用Rust后端获取图片
const fetchImageWithRust = async () => {
  try {
    loading.value = true
    error.value = ''
    
    console.log('🦀 使用Rust后端获取图片:', props.url)
    
    // 调用Tauri命令获取图片
    const base64DataUrl = await invoke<string>('fetch_image_as_base64', {
      url: props.url
    })
    
    imageDataUrl.value = base64DataUrl
    loading.value = false
    
    console.log('✅ Rust后端获取图片成功')
  } catch (err) {
    console.error('❌ Rust后端获取图片失败:', err)
    error.value = `获取图片失败: ${err}`
    loading.value = false
  }
}

// 处理直接图片加载成功（备用方案）
const handleImageLoad = () => {
  loading.value = false
  error.value = ''
}

// 处理直接图片加载失败（备用方案）
const handleImageError = () => {
  // 如果直接加载失败，尝试使用Rust后端
  console.log('🔄 直接加载失败，尝试使用Rust后端获取图片')
  fetchImageWithRust()
}

// 处理iframe加载完成
const handleFrameLoad = async () => {
  try {
    await nextTick()
    // 等待一段时间确保页面完全渲染
    setTimeout(async () => {
      await captureFrame()
    }, 3000) // 增加等待时间
  } catch (err) {
    console.error('Frame load error:', err)
    error.value = '页面加载失败'
    loading.value = false
  }
}

// 处理iframe加载错误
const handleFrameError = () => {
  error.value = '无法加载URL页面'
  loading.value = false
}

// 捕获iframe内容为图片
const captureFrame = async () => {
  if (!urlFrame.value) {
    error.value = 'Frame未找到'
    loading.value = false
    return
  }

  try {
    // 由于跨域限制，直接捕获iframe元素
    const dataUrl = await htmlToImage.toPng(urlFrame.value, {
      quality: props.quality,
      width: props.width,
      height: props.height,
      cacheBust: true,
      backgroundColor: '#ffffff'
    })
    
    imageDataUrl.value = dataUrl
    loading.value = false
  } catch (err) {
    console.error('Capture error:', err)
    error.value = `页面截图失败: ${err instanceof Error ? err.message : '跨域访问限制'}`
    loading.value = false
  }
}

// 重试渲染
const retryRender = () => {
  loading.value = true
  error.value = ''
  imageDataUrl.value = ''
  
  if (isImageUrl.value) {
    // 对于图片URL，优先使用Rust后端获取
    fetchImageWithRust()
  } else {
    // 对于非图片URL，重新加载iframe
    if (urlFrame.value) {
      urlFrame.value.src = props.url
    }
  }
}

// 下载图片
const downloadImage = () => {
  if (imageDataUrl.value) {
    const link = document.createElement('a')
    const filename = isImageUrl.value ? `image-${Date.now()}.png` : `url-screenshot-${Date.now()}.png`
    link.download = filename
    link.href = imageDataUrl.value
    link.click()
  }
}

// 复制图片到剪贴板
const copyImageToClipboard = async () => {
  if (!imageDataUrl.value) return
  
  try {
    // 将base64转换为blob
    const response = await fetch(imageDataUrl.value)
    const blob = await response.blob()
    
    // 复制到剪贴板
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

onMounted(() => {
  // 组件挂载后开始加载
  if (props.url) {
    if (isImageUrl.value) {
      // 对于图片URL，优先使用Rust后端获取
      fetchImageWithRust()
    } else {
      // 对于非图片URL，使用iframe
      loading.value = true
    }
  }
})
</script>

<style scoped>
.url-to-image-container {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-state {
  padding: 20px;
  text-align: center;
  background: var(--bg-secondary);
  border: 1px solid var(--danger-color);
  border-radius: 6px;
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

.image-result {
  text-align: center;
}

.rendered-image,
.direct-image {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.direct-image {
  max-height: 600px;
  object-fit: contain;
}

.image-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.download-button,
.copy-button {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
  text-decoration: none;
}

.view-original-button {
  background: var(--primary-color);
  color: white;
  border: 1px solid var(--primary-color);
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
  text-decoration: none;
  display: inline-block;
}

.download-button:hover,
.copy-button:hover {
  background: var(--bg-secondary);
  border-color: var(--primary-color);
}

.view-original-button:hover {
  background: var(--primary-color-hover);
}

.hidden-frame {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 800px;
  height: 600px;
  border: none;
  visibility: hidden;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .url-to-image-container {
    max-width: 100%;
    padding: 0 16px;
  }
  
  .image-actions {
    flex-direction: column;
    align-items: center;
  }
  
  .download-button,
  .copy-button {
    width: 200px;
  }
}
</style>