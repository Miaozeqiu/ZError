<template>
  <div class="page">
    <!-- 自定义窗口标题栏 -->
    <div class="window-header" data-tauri-drag-region>
      <div class="header-left">
        <button 
          class="menu-toggle-btn" 
          @click="toggleSidebar"
          :title="sidebarCollapsed ? '展开题目列表' : '收起题目列表'"
        >
          <svg 
            class="menu-icon" 
            :class="{ 'flipped': sidebarCollapsed }"
            viewBox="0 0 1024 1024" 
            version="1.1" 
            xmlns="http://www.w3.org/2000/svg" 
            width="16" 
            height="16"
          >
            <path d="M106.24 535.893333l165.546667 115.626667c20.053333 14.08 45.653333 0 45.653333-22.613333V395.093333c0-5.973333-2.133333-11.946667-5.546667-17.066666-9.386667-12.373333-27.306667-14.933333-40.106666-5.546667l-165.546667 115.626667c-14.08 11.093333-14.08 33.706667 0 47.786666zM129.28 213.333333h785.066667c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133333h-785.066667c-18.773333 0-34.133333 15.36-34.133333 34.133333s15.36 34.133333 34.133333 34.133333zM129.28 878.933333h785.066667c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133333h-785.066667c-18.773333 0-34.133333 15.36-34.133333 34.133333s15.36 34.133333 34.133333 34.133333zM419.413333 435.2h494.933334c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133334h-494.933334c-18.773333 0-34.133333 15.36-34.133333 34.133334s15.36 34.133333 34.133333 34.133333zM419.413333 657.066667h495.36c18.773333 0 34.133333-15.36 34.133334-34.133334s-15.36-34.133333-34.133334-34.133333H419.413333c-18.773333 0-34.133333 15.36-34.133333 34.133333v0.426667c0 18.346667 15.36 33.706667 34.133333 33.706667z" fill="currentColor"/>
          </svg>
        </button>

      </div>
      
      <div class="header-center">
        <!-- 空的中央区域，用于拖拽 -->
      </div>
      
      <div class="header-right">
        <button 
          class="window-control minimize" 
          @click="minimizeWindow"
          title="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 1024 1024">
            <path d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z" fill="currentColor"/>
          </svg>
        </button>
        
        <button 
          class="window-control maximize" 
          @click="toggleMaximize"
          :title="isMaximized ? '还原' : '最大化'"
        >
          <svg width="12" height="12" viewBox="0 0 1024 1024" v-if="!isMaximized">
            <path d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z" fill="currentColor"/>
          </svg>
          <svg width="12" height="12" viewBox="0 0 12 12" v-else>
            <rect x="2" y="3" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
            <rect x="4" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
        </button>
        
        <button 
          class="window-control close" 
          @click="closeWindow"
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 1024 1024">
            <path d="M897.6 183.5L183 898.1c-7.5 7.5-19.6 7.5-27.1 0l-29.5-29.5c-7.5-7.5-7.5-19.6 0-27.1L841 126.9c7.5-7.5 19.6-7.5 27.1 0l29.5 29.5c7.5 7.4 7.5 19.6 0 27.1z" fill="currentColor"/>
            <path d="M183 126.9l714.7 714.7c7.5 7.5 7.5 19.6 0 27.1l-29.5 29.5c-7.5 7.5-19.6 7.5-27.1 0L126.4 183.5c-7.5-7.5-7.5-19.6 0-27.1l29.5-29.5c7.4-7.5 19.6-7.5 27.1 0z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-area">
      <!-- 侧边栏 -->
      <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">

        
        <div class="questions" v-if="!sidebarCollapsed">
          <div 
            v-for="(question, index) in questions" 
            :key="question.id"
            class="question"
            :class="{ active: currentQuestionIndex === index }"
            @click="selectQuestion(index)"
            :title="question.title || ''"
          >
            <div class="question-content-wrapper">
              <span class="question-preview">{{ getQuestionPreview(question) }}</span>
              <div v-if="question.isNew" class="new-indicator" @click.stop="markAsRead(index)"></div>
            </div>
            <button @click.stop="removeQuestion(index)">×</button>
          </div>
        </div>
      </div>
      
      <!-- 主内容 -->
      <div v-if="currentQuestion" class="content">

          <!-- 题目内容 -->
          <div class="question-section">
            <h3>题目内容</h3>
            <div class="question-box">
              <!-- 显示缓存的图片 -->
              <div v-if="cachedImageUrl" class="cached-image-wrapper">
                <img :src="cachedImageUrl" alt="缓存的题目图片" class="final-image cached-image" />
              </div>
              
              <!-- ImageGenerator组件 -->
              <ImageGenerator 
                v-show="!cachedImageUrl"
                :key="currentQuestion.id"
                :content="combinedContent" 
                :shouldRender="shouldRenderCurrentQuestion"
                ref="imageGenerator"
                @imageReady="onImageReady"
                @renderComplete="onRenderComplete"
              />
            </div>
          </div>
          
          <!-- AI分析 -->
          <div class="ai-section">
            <h3>AI分析</h3>
            <div class="controls">
              <button @click="showModelSelector = true" :disabled="analyzing">
                {{ selectedVisionModel ? selectedVisionModel.displayName : '选择模型' }}
              </button>
              <button @click="analyzeWithAI" :disabled="!selectedVisionModel || analyzing || !hasRenderedImage">
                {{ analyzing ? '分析中...' : '开始分析' }}
              </button>
              <button @click="openAddToQuestionBank" :disabled="!currentQuestion" class="add-to-bank-btn">
                添加到题库
              </button>
            </div>
            
            <div class="ai-box" v-if="analyzing || analysisResult || analysisError">
              <div v-if="analyzing">
                <p>分析中...</p>
                <div v-if="streamingResponse">
                  <PureMarkdownRenderer :content="streamingResponse" />
                </div>
              </div>
              <div v-else-if="analysisResult">
                <PureMarkdownRenderer :content="analysisResult.response" />
              </div>
              <div v-else-if="analysisError">
                <p>错误: {{ analysisError }}</p>
                <button @click="retryAnalysis">重试</button>
              </div>
            </div>
            
            <div v-else class="placeholder">
              <p v-if="!hasRenderedImage">等待图片渲染完成...</p>
              <p v-else>选择模型开始分析</p>
            </div>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div v-else class="empty">
          <p>暂无题目</p>
        </div>

    </div>
    
    <!-- 模型选择 -->
    <div v-if="showModelSelector" class="modal" @click="showModelSelector = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <span>选择模型</span>
          <button @click="showModelSelector = false">×</button>
        </div>
        <div class="modal-body">
          <div v-for="platform in platformsWithVisionModels" :key="platform.id">
            <h4>{{ platform.displayName }}</h4>
            <div 
              v-for="model in platform.models" 
              :key="model.id"
              class="model-item"
              :class="{ active: selectedVisionModel?.id === model.id }"
              @click="selectVisionModel(model)"
            >
              {{ model.displayName }}
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 添加到题库弹窗 -->
    <div v-if="showAddToQuestionBank" class="modal" @click="showAddToQuestionBank = false">
      <div class="modal-content add-question-modal" @click.stop>
        <div class="modal-header">
          <span>添加到题库</span>
          <button @click="showAddToQuestionBank = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>题目内容：</label>
            <textarea 
              v-model="questionToAdd.content" 
              readonly 
              class="question-content-textarea"
              rows="6"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>答案：</label>
            <textarea 
              v-model="questionToAdd.answer" 
              placeholder="请输入答案内容"
              class="answer-textarea"
              rows="4"
            ></textarea>
            <div class="hint-text">
              💡 如果答案是图片最好填写图片的url以便ocs匹配
            </div>
          </div>
          
          <div class="modal-actions">
            <button @click="showAddToQuestionBank = false" class="cancel-btn">取消</button>
            <button @click="addQuestionToBank" :disabled="!questionToAdd.answer.trim() || addingToBank" class="confirm-btn">
              {{ addingToBank ? '添加中...' : '确认添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import ImageGenerator from '../components/ImageGenerator.vue'
import PureMarkdownRenderer from '../components/PureMarkdownRenderer.vue'
import { invoke } from '@tauri-apps/api/core'
import { useModelConfig } from '../services/modelConfig'
import { useTheme } from '../composables/useTheme'
import { databaseService } from '../services/database'
import type { AIModel } from '../services/modelConfig'

// 模型配置管理
const { settings: modelConfig, selectedVisionModel: globalSelectedVisionModel } = useModelConfig()

// 主题管理
const { initTheme, cleanup: cleanupTheme } = useTheme()

// 窗口控制相关状态
const isMaximized = ref(false)
const isTauri = ref(false)

// 题目管理相关状态
const questions = ref<any[]>([])
const currentQuestionIndex = ref(0)
const sidebarCollapsed = ref(false)

// 渲染缓存管理
const renderCache = ref<Map<string, {
  imageUrl: string | null,
  isRendered: boolean,
  timestamp: number
}>>(new Map())

// 从URL参数获取数据
const imageGenerator = ref<InstanceType<typeof ImageGenerator>>()

// AI分析相关状态
const selectedVisionModel = ref<AIModel | null>(null)
const analyzing = ref(false)
const analysisResult = ref<any>(null)
const analysisError = ref('')
const streamingResponse = ref('')
const hasRenderedImage = ref(false)
const analysisAbortController = ref<AbortController | null>(null)

// 模型选择对话框状态
const showModelSelector = ref(false)

// 添加到题库相关状态
const showAddToQuestionBank = ref(false)
const addingToBank = ref(false)
const questionToAdd = ref({
  content: '',
  answer: ''
})

// 获取可用的视觉模型
const availableVisionModels = computed(() => {
  const visionModels: AIModel[] = []
  
  for (const platform of modelConfig.platforms) {
    if (platform.enabled && platform.models) {
      const platformVisionModels = platform.models.filter(model => 
        model.category === 'vision' && model.enabled
      )
      visionModels.push(...platformVisionModels)
    }
  }
  
  return visionModels
})

// 按平台分组的视觉模型
const platformsWithVisionModels = computed(() => {
  const platformMap = new Map<string, any>()
  
  // 初始化平台映射
  modelConfig.platforms.forEach(platform => {
    if (platform.enabled) {
      platformMap.set(platform.id, {
        ...platform,
        models: []
      })
    }
  })
  
  // 将视觉模型分配到对应平台
  availableVisionModels.value.forEach(model => {
    const platform = platformMap.get(model.platformId)
    if (platform) {
      platform.models.push(model)
    }
  })
  
  // 只返回有视觉模型的平台
  return Array.from(platformMap.values()).filter(platform => platform.models.length > 0)
})

// 当前选中的题目
const currentQuestion = computed(() => {
  return questions.value[currentQuestionIndex.value] || null
})

// URL去重函数
const cleanDuplicateUrls = (text: string): string => {
  if (!text || !text.trim()) return text
  
  console.log('🧹 开始清理重复URL:', {
    原始文本长度: text.length,
    原始文本前100字符: text.substring(0, 100)
  })
  
  // 使用更简单直接的方法：分割文本，去重URL，重新组合
  let cleanedText = text
  
  // 匹配所有URL（包括在反引号中的）
  const urlPattern = /https?:\/\/[^\s`]+/g
  const urls = text.match(urlPattern)
  
  if (urls && urls.length > 1) {
    console.log('🧹 检测到URLs:', {
      总数量: urls.length,
      URLs列表: urls.slice(0, 5) // 只显示前5个
    })
    
    // 统计每个URL的出现次数
    const urlCounts = new Map<string, number>()
    urls.forEach(url => {
      urlCounts.set(url, (urlCounts.get(url) || 0) + 1)
    })
    
    // 找出重复的URL
    const duplicateUrls = Array.from(urlCounts.entries())
      .filter(([url, count]) => count > 1)
      .map(([url, count]) => ({ url, count }))
    
    if (duplicateUrls.length > 0) {
      console.log('🧹 发现重复URLs:', duplicateUrls)
      
      // 对每个重复的URL进行处理
      duplicateUrls.forEach(({ url, count }) => {
        // 创建一个正则表达式来匹配这个URL的所有出现
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(escapedUrl, 'g')
        
        // 替换：保留第一个，删除其余的
        let matchCount = 0
        cleanedText = cleanedText.replace(regex, (match) => {
          matchCount++
          return matchCount === 1 ? match : '' // 保留第一个，删除其余
        })
        
        console.log(`🧹 处理URL: ${url.substring(0, 50)}...`, {
          原始出现次数: count,
          处理后保留: 1
        })
      })
      
      console.log('🧹 清理完成:', {
        原始长度: text.length,
        清理后长度: cleanedText.length,
        减少字符: text.length - cleanedText.length
      })
    }
  }
  
  return cleanedText
}

// 组合内容
const combinedContent = computed(() => {
  if (!currentQuestion.value) return ''
  
  let content = currentQuestion.value.title || ''
  
  console.log('🔧 combinedContent计算 - 开始处理:', {
    原始title: currentQuestion.value.title,
    原始options: currentQuestion.value.options,
    title长度: content.length
  })
  
  // 简化逻辑：直接添加选项，然后进行URL去重
  if (currentQuestion.value.options && currentQuestion.value.options.trim()) {
    console.log('🔧 添加选项到内容')
    content += '\n\n**选项：**\n' + currentQuestion.value.options
    
    console.log('🔧 添加选项后:', {
      内容长度: content.length,
      内容预览: content.substring(0, 200) + '...'
    })
    
    // 对整个内容进行URL去重
    content = cleanDuplicateUrls(content)
    
    console.log('🔧 URL去重后:', {
      最终长度: content.length,
      最终预览: content.substring(0, 200) + '...'
    })
  }
  
  return content
})

// 控制是否应该渲染当前题目
const shouldRenderCurrentQuestion = computed(() => {
  if (!currentQuestion.value) return false
  
  const cached = renderCache.value.get(currentQuestion.value.id)
  const shouldRender = !cached || !cached.isRendered
  
  console.log('🎯 渲染控制决策:', {
    questionId: currentQuestion.value.id,
    hasCache: !!cached,
    isRendered: cached?.isRendered || false,
    shouldRender
  })
  
  return shouldRender
})

// 获取当前题目的缓存图片URL
const cachedImageUrl = computed(() => {
  if (!currentQuestion.value) return null
  
  const cached = renderCache.value.get(currentQuestion.value.id)
  if (cached && cached.isRendered && cached.imageUrl) {
    // 验证缓存的有效性（检查缓存时间，超过10分钟的缓存可能不可靠）
    const cacheAge = Date.now() - cached.timestamp
    const maxCacheAge = 10 * 60 * 1000 // 10分钟
    
    if (cacheAge > maxCacheAge) {
      console.log('⚠️ 缓存已过期，清除缓存:', {
        questionId: currentQuestion.value.id,
        cacheAge: Math.round(cacheAge / 1000) + 's'
      })
      renderCache.value.delete(currentQuestion.value.id)
      return null
    }
    
    console.log('🖼️ 使用缓存图片:', {
      questionId: currentQuestion.value.id,
      cacheAge: Math.round(cacheAge / 1000) + 's'
    })
    return cached.imageUrl
  }
  
  return null
})

// 题目管理方法
const selectQuestion = (index: number) => {
  if (index >= 0 && index < questions.value.length) {
    const previousIndex = currentQuestionIndex.value
    
    // 如果选择的是同一个题目，直接返回
    if (previousIndex === index) {
      console.log('🔄 选择相同题目，无需切换')
      return
    }
    
    console.log('🔄 切换题目:', {
      from: previousIndex + 1,
      to: index + 1,
      fromId: questions.value[previousIndex]?.id,
      toId: questions.value[index]?.id
    })
    
    // 保存当前题目的渲染状态到缓存
    if (questions.value[previousIndex]) {
      const previousQuestion = questions.value[previousIndex]
      const imageUrl = getRenderedImageDataSync()
      
      renderCache.value.set(previousQuestion.id, {
        imageUrl: imageUrl,
        isRendered: hasRenderedImage.value,
        timestamp: Date.now()
      })
      
      console.log('💾 保存题目渲染缓存:', {
        questionId: previousQuestion.id,
        index: previousIndex + 1,
        hasImage: !!imageUrl,
        isRendered: hasRenderedImage.value
      })
    }
    
    // 立即切换题目索引
    currentQuestionIndex.value = index
    
    // 自动标记新选中的题目为已读
    if (questions.value[index] && questions.value[index].isNew) {
      questions.value[index].isNew = false
      saveQuestionsToStorage()
      console.log('✅ 自动标记题目为已读:', questions.value[index].title)
    }
    
    // 检查新题目是否有缓存
    const newQuestion = questions.value[index]
    const cached = renderCache.value.get(newQuestion.id)
    
    if (cached && cached.isRendered) {
      // 使用缓存
      hasRenderedImage.value = true
      console.log('🎯 使用缓存的渲染结果:', {
        questionId: newQuestion.id,
        index: index + 1,
        cacheAge: Date.now() - cached.timestamp
      })
      
      // 触发一次渲染完成检查，确保UI状态正确
      nextTick(() => {
        checkRenderedImage()
      })
    } else {
      // 需要重新渲染
      console.log('🔄 需要重新渲染题目:', {
        questionId: newQuestion.id,
        index: index + 1,
        hasCache: !!cached
      })
      
      // 立即重置渲染状态，避免显示上一个题目的图片
      hasRenderedImage.value = false
      
      // 重置分析状态
      resetAnalysisState()
      
      // 重新检查图片渲染状态
      setTimeout(() => {
        checkRenderedImage()
      }, 1000)
    }
  }
}

const removeQuestion = (index: number) => {
  if (questions.value.length <= 1) {
    // 如果只有一个题目，清空所有
    clearAllQuestions()
    return
  }
  
  questions.value.splice(index, 1)
  
  // 调整当前选中的题目索引
  if (currentQuestionIndex.value >= questions.value.length) {
    currentQuestionIndex.value = questions.value.length - 1
  } else if (currentQuestionIndex.value > index) {
    currentQuestionIndex.value--
  }
  
  // 更新本地存储
  saveQuestionsToStorage()
}

const markAsRead = (index: number) => {
  if (questions.value[index]) {
    questions.value[index].isNew = false
    // 更新本地存储
    saveQuestionsToStorage()
    console.log('✅ 题目已标记为已读:', questions.value[index].title)
  }
}

const clearAllQuestions = () => {
  questions.value = []
  currentQuestionIndex.value = 0
  resetAnalysisState()
  
  // 清空本地存储
  try {
    localStorage.removeItem('urlContentQuestions')
  } catch (error) {
    console.error('清空本地存储失败:', error)
  }
}

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

// 获取题目预览文本
const getQuestionPreview = (question: any) => {
  const title = question.title || ''
  return title.length > 30 ? title.substring(0, 30) + '...' : title
}

// 图片生成事件处理
const onImageReady = (imageUrl: string) => {
  console.log('✅ 图片生成完成:', imageUrl)
  
  // 确保只处理当前题目的图片
  const currentQuestionData = questions.value[currentQuestionIndex.value]
  if (!currentQuestionData) {
    console.log('⚠️ 当前没有选中的题目，忽略图片生成事件')
    return
  }
  
  hasRenderedImage.value = true
  
  // 更新当前题目的缓存
  renderCache.value.set(currentQuestionData.id, {
    imageUrl: imageUrl,
    isRendered: true,
    timestamp: Date.now()
  })
  
  console.log('💾 更新题目渲染缓存:', {
    questionId: currentQuestionData.id,
    index: currentQuestionIndex.value + 1,
    imageUrlLength: imageUrl.length
  })
}

const onRenderComplete = () => {
  console.log('✅ 渲染完成')
  
  // 确保只处理当前题目的渲染完成事件
  const currentQuestionData = questions.value[currentQuestionIndex.value]
  if (!currentQuestionData) {
    console.log('⚠️ 当前没有选中的题目，忽略渲染完成事件')
    return
  }
  
  hasRenderedImage.value = true
  
  // 更新当前题目的缓存
  const imageUrl = getRenderedImageDataSync()
  renderCache.value.set(currentQuestionData.id, {
    imageUrl: imageUrl,
    isRendered: true,
    timestamp: Date.now()
  })
  
  console.log('💾 更新题目渲染缓存:', {
    questionId: currentQuestionData.id,
    index: currentQuestionIndex.value + 1,
    hasImage: !!imageUrl
  })
}

// 重置分析状态
const resetAnalysisState = () => {
  analyzing.value = false
  analysisResult.value = null
  analysisError.value = ''
  streamingResponse.value = ''
  hasRenderedImage.value = false
  
  if (analysisAbortController.value) {
    analysisAbortController.value.abort()
    analysisAbortController.value = null
  }
}

// 保存题目数据到本地存储
const saveQuestionsToStorage = () => {
  try {
    localStorage.setItem('urlContentQuestions', JSON.stringify(questions.value))
  } catch (error) {
    console.error('保存题目数据失败:', error)
  }
}

// 模型选择相关方法
const selectVisionModel = (model: AIModel) => {
  selectedVisionModel.value = model
  showModelSelector.value = false
}

// 题库相关方法
const openAddToQuestionBank = () => {
  if (!currentQuestion.value) return
  
  // 打印详细的题目信息
  console.log('🔍 点击添加到题库 - 原始题目数据:', {
    完整题目对象: currentQuestion.value,
    title字段: currentQuestion.value.title,
    options字段: currentQuestion.value.options,
    title长度: currentQuestion.value.title?.length || 0,
    options长度: currentQuestion.value.options?.length || 0,
    title类型: typeof currentQuestion.value.title,
    options类型: typeof currentQuestion.value.options
  })
  
  // 获取组合后的内容
  let combined = combinedContent.value
  
  console.log('🔍 组合后的内容（去重前）:', {
    组合内容长度: combined.length,
    内容预览: combined.substring(0, 200) + '...'
  })
  
  // 直接在这里进行URL去重 - 最简单粗暴的方法
  console.log('🧹 开始强制URL去重...')
  
  // 找到所有URL
  const urlRegex = /http:\/\/p\.ananas\.chaoxing\.com\/star3\/origin\/[a-f0-9]+\.gif/g
  const urls = combined.match(urlRegex) || []
  
  console.log('🧹 找到的URLs:', {
    总数: urls.length,
    前5个: urls.slice(0, 5)
  })
  
  if (urls.length > 0) {
    // 统计每个URL出现次数
    const urlCount = new Map()
    urls.forEach(url => {
      urlCount.set(url, (urlCount.get(url) || 0) + 1)
    })
    
    // 找出重复的URL
    const duplicates = Array.from(urlCount.entries()).filter(([url, count]) => count > 1)
    
    console.log('🧹 重复的URLs:', duplicates)
    
    // 对每个重复的URL进行替换
    duplicates.forEach(([url, count]) => {
      console.log(`🧹 处理重复URL: ${url}, 出现${count}次`)
      
      // 简单粗暴：用第一个URL替换所有相同的URL
      let firstFound = false
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escapedUrl, 'g')
      
      combined = combined.replace(regex, (match) => {
        if (!firstFound) {
          firstFound = true
          return match // 保留第一个
        }
        return '' // 删除后续的
      })
    })
    
    console.log('🧹 去重完成:', {
      原始长度: combinedContent.value.length,
      去重后长度: combined.length,
      减少了: combinedContent.value.length - combined.length
    })
  }
  
  // 设置题目内容
  questionToAdd.value.content = combined
  questionToAdd.value.answer = ''
  
  console.log('🔍 设置到表单的内容:', {
    表单内容长度: questionToAdd.value.content.length,
    内容预览: questionToAdd.value.content.substring(0, 200) + '...'
  })
  
  // 显示弹窗
  showAddToQuestionBank.value = true
}

const addQuestionToBank = async () => {
  if (!questionToAdd.value.answer.trim()) {
    alert('请填写答案内容')
    return
  }
  
  addingToBank.value = true
  
  try {
    await databaseService.addQuestion({
      content: questionToAdd.value.content,
      answer: questionToAdd.value.answer,
      folderId: 0 // 固定使用默认文件夹
    })
    
    console.log('✅ 题目添加到默认文件夹成功')
    alert('题目已成功添加到默认文件夹！')
    
    // 关闭弹窗
    showAddToQuestionBank.value = false
    
    // 重置表单
    questionToAdd.value = {
      content: '',
      answer: ''
    }
  } catch (error) {
    console.error('❌ 添加题目到题库失败:', error)
    alert(`添加失败: ${error.message}`)
  } finally {
    addingToBank.value = false
  }
}

// 窗口控制方法
const minimizeWindow = async () => {
  console.log('Minimize button clicked')
  console.log('isTauri.value:', isTauri.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping minimize')
    return
  }
  
  try {
    console.log('Attempting to minimize window...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.minimize()
    console.log('Window minimized successfully')
  } catch (error) {
    console.error('Failed to minimize window:', error)
  }
}

const toggleMaximize = async () => {
  console.log('Maximize/Restore button clicked')
  console.log('isTauri.value:', isTauri.value)
  console.log('isMaximized.value:', isMaximized.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping maximize/restore')
    return
  }
  
  try {
    console.log('Attempting to toggle maximize...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    if (isMaximized.value) {
      console.log('Unmaximizing window...')
      await appWindow.unmaximize()
    } else {
      console.log('Maximizing window...')
      await appWindow.maximize()
    }
    isMaximized.value = !isMaximized.value
    console.log('Window toggle completed, new state:', isMaximized.value)
  } catch (error) {
    console.error('Failed to toggle maximize:', error)
  }
}

const closeWindow = async () => {
  console.log('Close button clicked')
  console.log('isTauri.value:', isTauri.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping close')
    return
  }
  
  try {
    console.log('Attempting to close window...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.close()
    console.log('Window closed successfully')
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

// 检测Tauri环境
const checkTauriEnvironment = () => {
  console.log('Checking Tauri environment...')
  console.log('window.__TAURI__:', typeof window !== 'undefined' ? window.__TAURI__ : 'window undefined')
  console.log('window.__TAURI_INTERNALS__:', typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : 'window undefined')
  
  // 更新检测逻辑，使用 __TAURI_INTERNALS__ 作为检测标准
  const isTauriEnv = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
  console.log('Tauri environment detected:', isTauriEnv)
  return isTauriEnv
}

// 监听ImageGenerator的渲染状态
watch(() => imageGenerator.value, async (generator) => {
  if (generator) {
    // 等待一段时间确保渲染完成
    setTimeout(() => {
      checkRenderedImage()
    }, 2000)
  }
}, { immediate: true })

// 检查是否有渲染完成的图片
const checkRenderedImage = () => {
  try {
    // 检查当前题目区域是否有最终渲染的图片
    const questionBox = document.querySelector('.question-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      
      if (finalImage && finalImage.src) {
        hasRenderedImage.value = true
        console.log('✅ 检测到当前题目的渲染完成图片 (通过DOM检查)')
        return
      }
    }
    
    // 检查当前题目区域是否有URL内容但还在渲染中
    if (questionBox) {
      const renderingState = questionBox.querySelector('.rendering-state')
      if (renderingState) {
        console.log('🔄 当前题目图片正在渲染中，继续等待...')
        setTimeout(checkRenderedImage, 1000)
        return
      }
    }
    
    // 检查当前题目区域是否有渲染错误
    if (questionBox) {
      const renderError = questionBox.querySelector('.render-error')
      if (renderError) {
        console.log('❌ 当前题目图片渲染失败')
        hasRenderedImage.value = false
        return
      }
    }
    
    // 检查当前题目区域是否有普通的markdown内容（没有URL的情况）
    if (questionBox) {
      const markdownContent = questionBox.querySelector('.markdown-content')
      if (markdownContent && !questionBox.querySelector('.url-content')) {
        hasRenderedImage.value = true
        console.log('✅ 检测到当前题目的普通markdown内容，无需等待图片渲染')
        return
      }
    }
    
    // 如果没有找到任何状态，继续重试
    if (!hasRenderedImage.value) {
      console.log('⏳ 继续等待当前题目图片渲染完成...')
      setTimeout(checkRenderedImage, 1000)
    }
  } catch (error) {
    console.error('检查当前题目渲染状态时出错:', error)
    setTimeout(checkRenderedImage, 1000)
  }
}

// 获取渲染后的图片数据（同步版本，用于缓存）
const getRenderedImageDataSync = (): string | null => {
  try {
    // 方法1: 尝试从当前题目的question-box中获取图片
    const questionBox = document.querySelector('.question-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      if (finalImage && finalImage.src) {
        console.log('✅ 从当前题目区域获取到图片:', finalImage.src.substring(0, 50) + '...')
        return finalImage.src
      }
    }
    
    // 方法2: 尝试从ImageGenerator组件实例获取
    if (imageGenerator.value && (imageGenerator.value as any).finalImageUrl) {
      console.log('✅ 从组件实例获取到渲染图片')
      return (imageGenerator.value as any).finalImageUrl
    }
    
    console.log('⚠️ 未找到当前题目的图片数据')
    return null
  } catch (error) {
    console.error('同步获取渲染图片失败:', error)
    return null
  }
}

// 获取渲染后的图片数据
const getRenderedImageData = async (): Promise<string | null> => {
  try {
    // 方法1: 尝试从当前题目的question-box中获取图片
    const questionBox = document.querySelector('.question-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      if (finalImage && finalImage.src) {
        console.log('✅ 从当前题目区域获取到最终渲染图片')
        return finalImage.src
      }
    }
    
    // 方法2: 尝试从ImageGenerator组件实例获取
    if (imageGenerator.value && (imageGenerator.value as any).finalImageUrl) {
      console.log('✅ 从组件实例获取到渲染图片')
      return (imageGenerator.value as any).finalImageUrl
    }
    
    // 方法3: 检查当前题目区域是否有其他可用的图片元素
    if (questionBox) {
      const renderedImages = questionBox.querySelectorAll('.rendered-image, .inline-image, .direct-image')
      for (const img of renderedImages) {
        const imgElement = img as HTMLImageElement
        if (imgElement.src && imgElement.src.startsWith('data:')) {
          console.log('✅ 从当前题目区域的其他图片元素获取到图片数据')
          return imgElement.src
        }
      }
    }
    
    console.log('❌ 未找到当前题目的可用图片数据')
    return null
  } catch (error) {
    console.error('获取渲染图片失败:', error)
    return null
  }
}

// AI分析功能
const analyzeWithAI = async () => {
  if (!selectedVisionModel.value) {
    analysisError.value = '请选择一个视觉模型'
    return
  }

  // 获取渲染后的图片
  const imageData = await getRenderedImageData()
  if (!imageData) {
    analysisError.value = '无法获取渲染后的图片数据'
    return
  }

  // 创建AbortController用于取消请求
  analysisAbortController.value = new AbortController()
  
  // 重置状态
  analyzing.value = true
  analysisResult.value = null
  analysisError.value = ''
  streamingResponse.value = ''

  try {
    console.log('🤖 开始AI视觉分析')
    
    // 获取选中模型的平台信息
    const platform = modelConfig.platforms.find(p => 
      p.models.some(m => m.id === selectedVisionModel.value!.id)
    )
    
    if (!platform) {
      throw new Error('找不到模型对应的平台')
    }

    // 构建分析输入数据
    const analysisInput = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'high'
              }
            },
            {
              type: 'text',
              text: '请仔细分析这张图片中的内容，如果是题目请解答，如果是其他内容请详细描述。'
            }
          ]
        }
      ],
      model: selectedVisionModel.value.id,
      stream: true
    }

    // 构建配置对象
    const config = {
      apiKey: platform.apiKey,
      baseUrl: platform.baseUrl,
      model: selectedVisionModel.value.id,
      ...selectedVisionModel.value
    }

    // 动态导入Tauri HTTP插件
    let tauriFetch
    try {
      const tauriHttp = await import('@tauri-apps/plugin-http')
      tauriFetch = tauriHttp.fetch
    } catch (importError) {
      console.warn('Tauri HTTP插件不可用，使用浏览器fetch:', importError)
      tauriFetch = fetch
    }

    // 执行模型的JavaScript配置代码
    if (selectedVisionModel.value.jsCode) {
      try {
        let executableCode = selectedVisionModel.value.jsCode.trim()
        let processModel

        if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
          const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
            ${executableCode}
            return processModel;
          `)
          processModel = safeEval(analysisInput, config, tauriFetch, analysisAbortController.value?.signal)
        } else {
          const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
            return (async function processModel(input, config) {
              ${executableCode}
            });
          `)
          processModel = wrapperFunction(analysisInput, config, tauriFetch, analysisAbortController.value?.signal)
        }

        // 执行分析
        const result = await processModel(analysisInput, config)

        if (result) {
          // 如果返回的是生成器或异步迭代器，收集结果
          if (result[Symbol.asyncIterator]) {
            let fullResponse = ''
            streamingResponse.value = ''

            for await (const chunk of result) {
              if (chunk.content) {
                fullResponse += chunk.content
                streamingResponse.value = fullResponse
              }
            }

            analysisResult.value = {
              response: fullResponse,
              timestamp: new Date().toLocaleString(),
              modelName: selectedVisionModel.value.displayName
            }
          } else {
            analysisResult.value = {
              response: result,
              timestamp: new Date().toLocaleString(),
              modelName: selectedVisionModel.value.displayName
            }
          }
          
          console.log('✅ AI视觉分析完成')
        } else {
          analysisError.value = '模型配置代码未返回有效结果'
        }
      } catch (codeError) {
        console.error('执行模型配置代码失败:', codeError)
        analysisError.value = `代码执行错误: ${codeError.message}`
      }
    } else {
      analysisError.value = '模型未配置JavaScript代码'
    }
  } catch (error) {
    console.error('❌ AI视觉分析失败:', error)
    analysisError.value = `分析失败: ${error.message}`
  } finally {
    analyzing.value = false
    analysisAbortController.value = null
    // 分析完成后，如果有错误则清空流式响应
    if (analysisError.value) {
      streamingResponse.value = ''
    }
  }
}

// 重试分析
const retryAnalysis = () => {
  analyzeWithAI()
}

// 从URL查询参数获取数据
const getUrlParams = () => {
  const urlParams = new URLSearchParams(window.location.search)
  const questionsParam = urlParams.get('questions')
  
  if (questionsParam) {
    try {
      const decodedQuestions = JSON.parse(decodeURIComponent(questionsParam))
      questions.value = Array.isArray(decodedQuestions) ? decodedQuestions : [decodedQuestions]
      
      // 如果有题目，选中第一个
      if (questions.value.length > 0) {
        currentQuestionIndex.value = 0
      }
      
      console.log('✅ 成功加载题目数据:', {
        totalQuestions: questions.value.length,
        questions: questions.value
      })
    } catch (error) {
      console.error('解析题目数据失败:', error)
      
      // 尝试兼容旧格式
      const question = urlParams.get('question')
      const options = urlParams.get('options')
      
      if (question) {
        questions.value = [{
          id: `question_${Date.now()}`,
          title: decodeURIComponent(question),
          options: options ? decodeURIComponent(options) : '',
          timestamp: new Date().toLocaleString(),
          status: 'pending'
        }]
        currentQuestionIndex.value = 0
        
        console.log('✅ 使用兼容模式加载题目:', questions.value[0])
      }
    }
  } else {
    // 尝试从本地存储加载
    try {
      const stored = localStorage.getItem('urlContentQuestions')
      if (stored) {
        questions.value = JSON.parse(stored)
        if (questions.value.length > 0) {
          currentQuestionIndex.value = 0
        }
        console.log('✅ 从本地存储加载题目:', questions.value.length)
      }
    } catch (error) {
      console.error('从本地存储加载题目失败:', error)
    }
  }
}

// 监听URL参数变化
watch(() => window.location.search, () => {
  console.log('🔄 检测到URL参数变化，重新加载题目数据')
  getUrlParams()
}, { immediate: false })

// 组件挂载时获取参数
onMounted(async () => {
  // 初始化主题
  try {
    await initTheme()
    console.log('✅ 主题初始化完成')
  } catch (error) {
    console.error('❌ 主题初始化失败:', error)
  }
  
  // 初始化Tauri环境检测和窗口状态
  isTauri.value = checkTauriEnvironment()
  
  if (!isTauri.value) {
    console.log('Running in browser environment, Tauri APIs disabled')
  } else {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const appWindow = getCurrentWindow()
      isMaximized.value = await appWindow.isMaximized()
      
      // 监听窗口最大化/还原事件
      const unlistenResize = await appWindow.onResized(() => {
        appWindow.isMaximized().then(maximized => {
          isMaximized.value = maximized
        })
      })
      
      // 组件卸载时清理监听器
      onUnmounted(() => {
        unlistenResize()
      })
    } catch (error) {
      console.error('Failed to setup window listeners:', error)
    }
  }
  
  getUrlParams()
  
  // 初始化时使用全局选中的视觉模型
  if (globalSelectedVisionModel.value) {
    selectedVisionModel.value = globalSelectedVisionModel.value
    console.log('✅ 使用主窗口选择的视觉模型:', globalSelectedVisionModel.value.displayName)
  }
  
  console.log('URL内容处理页面加载:', {
    totalQuestions: questions.value.length,
    currentIndex: currentQuestionIndex.value,
    selectedVisionModel: selectedVisionModel.value?.displayName || '未选择'
  })
  
  // 监听窗口导航事件
  const handleNavigation = () => {
    console.log('🔄 窗口导航事件触发，重新加载数据')
    setTimeout(() => {
      getUrlParams()
    }, 100)
  }
  
  // 添加导航监听
  window.addEventListener('popstate', handleNavigation)
  
  // 监听来自主窗口的新题目事件
  try {
    const { listen } = await import('@tauri-apps/api/event')
    
    // 监听主题变化事件
    const unlistenTheme = await listen('theme-changed', (event) => {
      console.log('📨 收到主题变化事件:', event.payload)
      
      const payload = event.payload as any
      if (payload && payload.theme) {
        // 应用新主题
        const root = document.documentElement
        root.removeAttribute('data-theme')
        
        if (payload.theme !== 'light') {
          root.setAttribute('data-theme', payload.theme)
        }
        
        console.log('✅ 主题已同步:', payload.theme)
      }
    })
    
    const unlisten = await listen('new-question-added', (event) => {
      console.log('📨 收到新题目事件:', event.payload)
      
      const payload = event.payload as any
      if (payload && payload.questions) {
        // 更新题目列表
        questions.value = payload.questions
        
        // 选中最新添加的题目（现在在列表开头，索引为0）
        if (payload.latestQuestion) {
          const latestIndex = questions.value.findIndex(q => q.id === payload.latestQuestion.id)
          if (latestIndex !== -1) {
            currentQuestionIndex.value = latestIndex
            console.log('✅ 已切换到最新题目:', latestIndex + 1)
          }
        } else if (questions.value.length > 0) {
          // 如果没有指定最新题目，默认选中第一个（最新的）
          currentQuestionIndex.value = 0
          console.log('✅ 默认选中第一个题目（最新题目）')
        }
        
        // 保存到本地存储
        saveQuestionsToStorage()
        
        // 重置分析状态
        resetAnalysisState()
        
        // 重新检查图片渲染状态
        setTimeout(() => {
          checkRenderedImage()
        }, 1000)
        
        console.log('✅ 新题目数据已更新:', {
          totalQuestions: questions.value.length,
          currentIndex: currentQuestionIndex.value
        })
      }
    })
    
    // 清理监听器
    onUnmounted(() => {
      window.removeEventListener('popstate', handleNavigation)
      unlisten()
      unlistenTheme()
      // 清理主题监听器
      cleanupTheme()
    })
  } catch (error) {
    console.error('❌ 设置事件监听失败:', error)
    
    // 清理监听器（备用）
    onUnmounted(() => {
      window.removeEventListener('popstate', handleNavigation)
      // 清理主题监听器
      cleanupTheme()
    })
  }
})

// 监听全局视觉模型变化
watch(globalSelectedVisionModel, (newModel) => {
  if (newModel && (!selectedVisionModel.value || selectedVisionModel.value.id !== newModel.id)) {
    selectedVisionModel.value = newModel
    console.log('🔄 同步主窗口选择的视觉模型:', newModel.displayName)
  }
}, { immediate: true })
</script>

<style scoped>
/* 全局高度设置 */
:global(html, body) {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: Arial, sans-serif;
}

/* 窗口标题栏 */
.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: var(--bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--border-color, #ddd);
  user-select: none;
  position: relative;
  z-index: 1000;
  -webkit-app-region: drag; /* 明确设置拖拽区域 */
}

.header-left {
  margin-left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  -webkit-app-region: drag; /* 左侧区域可拖拽 */
}

.menu-toggle-btn {
  padding: 4px;
  height: 24px;
  border: none;
  background: var(--btn-primary-bg, #e4e4e4);
  color: var(--text-primary, #333);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag; /* 按钮不可拖拽 */
}

.menu-toggle-btn:hover {
  background-color: var(--btn-primary-hover, rgba(0, 0, 0, 0.1));
  color: var(--color-primary, #007acc);
}

.menu-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  transition: transform 0.3s ease; /* 添加过渡动画 */
  transform-origin: center; /* 设置变换原点为中心 */
}

.menu-icon.flipped {
  transform: scaleX(-1); /* 水平翻转 */
}

.app-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  -webkit-app-region: drag; /* logo区域可拖拽 */
}

.app-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #333);
  -webkit-app-region: drag; /* 标题区域可拖拽 */
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  -webkit-app-region: drag; /* 中央区域可拖拽 */
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  -webkit-app-region: no-drag; /* 右侧按钮区域不可拖拽 */
}

.window-control {
  border-radius: 0px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-primary, #333);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
  -webkit-app-region: no-drag;
}

.window-control:hover {
  background-color: var(--btn-primary-hover, rgba(158, 158, 158, 0.1));
}

.window-control.close:hover {
  background-color: var(--danger-color, #e74c3c);
  color: white;
}

.window-control.minimize:hover,
.window-control.maximize:hover {
  background-color: var(--btn-primary-hover, rgba(158, 158, 158, 0.2));
}

/* 主要内容区域 */
.main-area {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  overflow-y: auto;
  height: 100%;
  width: 200px;
  background: var(--bg-secondary, #f5f5f5);
  border-right: 1px solid var(--border-color, #ddd);
  transition: width 0.3s;
}

.sidebar.collapsed {
  width: 0px;
}

.sidebar-header {
  padding: 10px;
  border-bottom: 1px solid var(--border-color, #ddd);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header button {
  border: none;
  background: none;
  cursor: pointer;
  padding: 5px;
  color: var(--text-primary);
}

.questions {
  overflow-y: auto;
  padding: 5px;
}

.question {
  padding: 8px;
  margin: 2px 0;
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-primary);
  min-height: 32px; /* 确保最小高度 */
  overflow: hidden; /* 防止内容超出容器 */
}

.question:hover {
  background: var(--bg-tertiary, #e9e9e9);
}

.question.active {
  background: var(--color-primary, #007acc);
  color: white;
}

.question-content-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  position: relative;
  margin-right: 8px;
  min-width: 0; /* 允许flex项目收缩到内容宽度以下 */
  padding-top: 2px; /* 为红点留出空间 */
  padding-right: 2px; /* 为红点留出空间 */
}

.question-preview {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.3;
  min-width: 0; /* 允许flex项目收缩到内容宽度以下 */
  margin-right: 10px; /* 为红点留出更多空间 */
}

.new-indicator {
  width: 8px;
  height: 8px;
  background-color: #e74c3c;
  border-radius: 50%;
  position: absolute;
  top: 0px; /* 调整到容器内部 */
  right: 0px; /* 调整到容器内部 */
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
  z-index: 10; /* 确保红点在最上层 */
}

.new-indicator:hover {
  transform: scale(1.2);
  box-shadow: 0 0 6px rgba(231, 76, 60, 0.7);
}

.question button {
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0; /* 防止删除按钮被压缩 */
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.question button:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.2);
}

/* 主内容 */
.content {
  flex: 1;
  padding: 20px;
  overflow: hidden; /* 改为hidden，避免外层滚动条 */
  display: flex;
  flex-direction: column;
}

/* 题目内容区域样式 */
.question-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0; /* 防止被挤压 */
}

.question-section h3 {
  margin: 0 0 10px 0;
  font-size: 16px;
  flex-shrink: 0; /* 标题不收缩 */
  color: var(--text-primary);
}

.question-box {
  padding: 15px;
  border-radius: 6px;
  background: var(--bg-tertiary, transparent); /* 题目内容使用第三级背景色 */
  overflow-x: auto;
  overflow-y: auto;
  flex: 1;
}

/* AI分析区域样式 */
.ai-section {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  flex: 1; /* AI分析区域占用剩余空间 */
  min-height: 200px; /* 设置AI分析区域的最小高度 */
}

.ai-section h3 {
  margin: 0 0 10px 0;
  font-size: 16px;
  flex-shrink: 0; /* 标题不收缩 */
  color: var(--text-primary);
}

.ai-box {
  border: 1px solid var(--border-color, #ddd);
  padding: 15px;
  border-radius: 6px;
  background: var(--bg-primary, white); /* AI分析使用主背景色 */
  overflow-x: auto;
  overflow-y: auto;
  flex: 1;
  min-height: 200px;
}

/* 保留原有的通用box样式作为备用 */
.box {
  border: 1px solid var(--border-color, #ddd);
  padding: 15px; /* 减少内边距 */
  border-radius: 6px;
  background: var(--bg-primary, white);
  overflow-x: auto; /* 水平滚动处理超宽图片 */
  overflow-y: auto; /* 垂直滚动 */
  flex: 1; /* 占用父容器的剩余空间 */
}

/* 缓存图片样式 */
.cached-image-wrapper {
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

.cached-image {
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

/* 题目内容区域中的图片样式 */
.question-box :deep(.final-image-wrapper) {
  /* 隔离图片样式，防止主题影响 */
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

.question-box :deep(.final-image) {
  max-width: 600px !important; /* 设置合理的最大宽度 */
  width: auto !important; /* 使用图片原始宽度 */
  height: auto !important; /* 保持宽高比 */
  display: block !important;
  margin: 0 auto !important; /* 减少上下边距 */
  border: 1px solid #ddd !important; /* 使用固定颜色 */
  border-radius: 6px !important;
  box-shadow: none !important;
}

/* AI分析区域中的图片样式 */
.ai-box :deep(.final-image-wrapper) {
  /* 隔离图片样式，防止主题影响 */
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

.ai-box :deep(.final-image) {
  max-width: 600px !important;
  width: auto !important;
  height: auto !important;
  display: block !important;
  margin: 0 auto !important;
  border: 1px solid #ddd !important; /* 使用固定颜色 */
  border-radius: 6px !important;
  box-shadow: none !important;
}

/* 保留原有的通用图片样式作为备用 */
.box :deep(.final-image-wrapper) {
  /* 隔离图片样式，防止主题影响 */
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

.box :deep(.final-image) {
  max-width: 600px !important; /* 设置合理的最大宽度 */
  width: auto !important; /* 使用图片原始宽度 */
  height: auto !important; /* 保持宽高比 */
  display: block !important;
  margin: 0 auto !important; /* 减少上下边距 */
  border: 1px solid #ddd !important; /* 使用固定颜色 */
  border-radius: 6px !important;
  box-shadow: none !important;
}

/* 通用图片样式 - 适用于所有容器 */
:deep(.final-image-wrapper) {
  /* 隔离图片样式，防止主题影响 */
  all: initial;
  display: block !important;
  text-align: center;
  margin: 8px auto;
}

:deep(.final-image) {
  max-width: 100% !important;
  width: auto !important;
  height: auto !important;
  display: block !important;
  margin: 0 auto !important;
  border: 1px solid #ddd !important; /* 使用固定颜色 */
  border-radius: 6px !important;
  box-shadow: none !important;
}

.controls {
  margin-bottom: 10px;
}

.controls button {
  margin-right: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 3px;
}

.controls button:hover {
  background: var(--bg-tertiary, #f0f0f0);
}

.controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.placeholder {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-style: italic;
}

.empty {
  text-align: center;
  padding: 50px;
  color: var(--text-secondary, #666);
}

/* 模态框 */
.modal {
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

.modal-content {
  background: var(--bg-primary, white);
  border: 1px solid var(--border-color, transparent);
  border-radius: 4px;
  width: 400px;
  max-height: 500px;
  overflow: hidden;
}

.modal-header {
  padding: 15px;
  border-bottom: 1px solid var(--border-color, #ddd);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header span {
  color: var(--text-primary);
  font-weight: 500;
}

.modal-header button {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.modal-header button:hover {
  background: var(--bg-tertiary, #f0f0f0);
}

.modal-body {
  padding: 15px;
  max-height: 600px;
  overflow-y: auto;
}

.modal-body h4 {
  margin: 10px 0 5px 0;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.model-item {
  padding: 8px;
  cursor: pointer;
  border-radius: 3px;
  margin: 2px 0;
  color: var(--text-primary);
  transition: background-color 0.2s ease;
}

.model-item:hover {
  background: var(--bg-tertiary, #f0f0f0);
}

.model-item.active {
  background: var(--color-primary, #007acc);
  color: white;
}

/* 添加到题库按钮样式 */
.add-to-bank-btn {
  background: var(--success-color, #28a745) !important;
  color: white !important;
  border: 1px solid var(--success-color, #28a745) !important;
}

.add-to-bank-btn:hover:not(:disabled) {
  background: var(--success-hover, #218838) !important;
  border-color: var(--success-hover, #218838) !important;
}

.add-to-bank-btn:disabled {
  background: var(--bg-tertiary, #f0f0f0) !important;
  color: var(--text-secondary, #666) !important;
  border-color: var(--border-color, #ddd) !important;
}

/* 添加到题库弹窗样式 */
.add-question-modal {
  width: 600px;
  max-height: 80vh;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.question-content-textarea,
.answer-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  background: var(--bg-primary, white);
  color: var(--text-primary);
}

.question-content-textarea {
  background: var(--bg-tertiary, #f8f9fa);
  color: var(--text-secondary, #666);
}

.answer-textarea:focus {
  outline: none;
  border-color: var(--color-primary, #007acc);
  box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
}

.hint-text {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  font-style: italic;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color, #eee);
}

.cancel-btn {
  padding: 10px 20px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  color: var(--text-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background: var(--bg-tertiary, #f0f0f0);
}

.confirm-btn {
  padding: 10px 20px;
  border: 1px solid var(--color-primary, #007acc);
  background: var(--color-primary, #007acc);
  color: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.confirm-btn:hover:not(:disabled) {
  background: var(--color-primary-hover, #0056b3);
  border-color: var(--color-primary-hover, #0056b3);
}

.confirm-btn:disabled {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #666);
  border-color: var(--border-color, #ddd);
  cursor: not-allowed;
}
</style>