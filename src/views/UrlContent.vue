<template>
  <div class="page">
    <!-- 窗口标题栏 -->
    <div class="window-header" data-tauri-drag-region>
      <div class="header-left">
        <button class="menu-toggle-btn" @click="toggleSidebar" :title="sidebarCollapsed ? '展开题目列表' : '收起题目列表'">
          <svg class="menu-icon" :class="{ 'flipped': sidebarCollapsed }" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M106.24 535.893333l165.546667 115.626667c20.053333 14.08 45.653333 0 45.653333-22.613333V395.093333c0-5.973333-2.133333-11.946667-5.546667-17.066666-9.386667-12.373333-27.306667-14.933333-40.106666-5.546667l-165.546667 115.626667c-14.08 11.093333-14.08 33.706667 0 47.786666zM129.28 213.333333h785.066667c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133333h-785.066667c-18.773333 0-34.133333 15.36-34.133333 34.133333s15.36 34.133333 34.133333 34.133333zM129.28 878.933333h785.066667c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133333h-785.066667c-18.773333 0-34.133333 15.36-34.133333 34.133333s15.36 34.133333 34.133333 34.133333zM419.413333 435.2h494.933334c18.773333 0 34.133333-15.36 34.133333-34.133333s-15.36-34.133333-34.133333-34.133334h-494.933334c-18.773333 0-34.133333 15.36-34.133333 34.133334s15.36 34.133333 34.133333 34.133333zM419.413333 657.066667h495.36c18.773333 0 34.133333-15.36 34.133334-34.133334s-15.36-34.133333-34.133334-34.133333H419.413333c-18.773333 0-34.133333 15.36-34.133333 34.133333v0.426667c0 18.346667 15.36 33.706667 34.133333 33.706667z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div class="header-center"></div>
      <div class="header-right">
        <button class="window-control minimize" @click="minimizeWindow" title="最小化">
          <svg width="12" height="12" viewBox="0 0 1024 1024"><path d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z" fill="currentColor"/></svg>
        </button>
        <button class="window-control maximize" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
          <svg width="12" height="12" viewBox="0 0 1024 1024" v-if="!isMaximized"><path d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z" fill="currentColor"/></svg>
          <svg width="12" height="12" viewBox="0 0 12 12" v-else><rect x="2" y="3" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="4" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
        </button>
        <button class="window-control close" @click="closeWindow" title="关闭">
          <svg width="12" height="12" viewBox="0 0 1024 1024"><path d="M897.6 183.5L183 898.1c-7.5 7.5-19.6 7.5-27.1 0l-29.5-29.5c-7.5-7.5-7.5-19.6 0-27.1L841 126.9c7.5-7.5 19.6-7.5 27.1 0l29.5 29.5c7.5 7.4 7.5 19.6 0 27.1z" fill="currentColor"/><path d="M183 126.9l714.7 714.7c7.5 7.5 7.5 19.6 0 27.1l-29.5 29.5c-7.5 7.5-19.6 7.5-27.1 0L126.4 183.5c-7.5-7.5-7.5-19.6 0-27.1l29.5-29.5c7.4-7.5 19.6-7.5 27.1 0z" fill="currentColor"/></svg>
        </button>
      </div>
    </div>

    <!-- 主区域 -->
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

      <!-- 聊天主区域 -->
      <div class="chat-area" v-if="currentQuestion">
        <!-- 消息列表 -->
        <div class="messages">
          <!-- 用户气泡：题目图片 -->
          <div class="message user-message">
            <div class="bubble user-bubble">
              <div class="bubble-label">题目</div>
              <div class="question-image-box">
                <div v-if="cachedImageUrl" class="cached-image-wrapper">
                  <img :src="cachedImageUrl" alt="题目图片" class="final-image cached-image" />
                </div>
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
          </div>

          <!-- AI 气泡：分析结果 -->
          <div class="message ai-message" v-if="analyzing || analysisResult || analysisError">
            <div class="ai-avatar">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
              </svg>
            </div>
            <div class="bubble ai-bubble">
              <div class="bubble-label">{{ selectedVisionModel?.displayName || 'AI' }}</div>
              <div v-if="analyzing">
                <div class="thinking" v-if="!streamingResponse">
                  <span></span><span></span><span></span>
                </div>
                <MarkdownRender v-if="streamingResponse" :content="streamingResponse" />
              </div>
              <div v-else-if="analysisResult">
                <MarkdownRender :content="analysisResult.response" />
                <div v-if="analysisResult.answer" class="answer-bar">
                  <span class="answer-label">答案</span>
                  <span class="answer-text">{{ analysisResult.answer }}</span>
                  <button class="quick-add-btn" @click="quickAddToBank" :disabled="addingToBank">
                    {{ addingToBank ? '添加中...' : '一键入库' }}
                  </button>
                </div>
              </div>
              <div v-else-if="analysisError" class="error-box">
                <span>{{ analysisError }}</span>
                <button class="retry-btn" @click="retryAnalysis">重试</button>
              </div>
            </div>
          </div>

          <!-- 空状态提示 -->
          <div class="chat-placeholder" v-if="!analyzing && !analysisResult && !analysisError">
            <p v-if="!hasRenderedImage">等待题目渲染完成...</p>
            <p v-else>选择模型后点击「开始分析」</p>
          </div>
        </div>

        <!-- 底部工具栏 -->
        <div class="toolbar">
          <button class="toolbar-btn model-btn" @click="showModelSelector = true" :disabled="analyzing">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
            {{ selectedVisionModel ? selectedVisionModel.displayName : '选择模型' }}
          </button>
          <div class="toolbar-right">
            <button class="toolbar-btn bank-btn" @click="openAddToQuestionBank" :disabled="!currentQuestion">
              添加到题库
            </button>
            <button class="toolbar-btn analyze-btn" @click="analyzeWithAI" :disabled="!selectedVisionModel || analyzing || !hasRenderedImage">
              {{ analyzing ? '分析中...' : '开始分析' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div class="empty" v-else>
        <p>暂无题目</p>
      </div>
    </div>

    <!-- 模型选择弹窗 -->
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
            <textarea v-model="questionToAdd.content" readonly class="question-content-textarea" rows="6"></textarea>
          </div>
          <div class="form-group">
            <label>答案：</label>
            <textarea v-model="questionToAdd.answer" placeholder="请输入答案内容" class="answer-textarea" rows="4"></textarea>
            <div class="hint-text">💡 如果答案是图片最好填写图片的url以便ocs匹配</div>
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
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import { invoke } from '@tauri-apps/api/core'
import { useModelConfig } from '../services/modelConfig'
import { useTheme } from '../composables/useTheme'
import { databaseService } from '../services/database'
import type { AIModel } from '../services/modelConfig'

const { settings: modelConfig, selectedVisionModel: globalSelectedVisionModel } = useModelConfig()
const { initTheme, cleanup: cleanupTheme } = useTheme()

const isMaximized = ref(false)
const isTauri = ref(false)
const questions = ref<any[]>([])
const currentQuestionIndex = ref(0)
const sidebarCollapsed = ref(false)

// 当前窗口的唯一 ID，从 URL 参数读取，用于隔离多窗口数据
const windowId = ref('')
const storageKey = computed(() => windowId.value ? `urlContentQuestions_${windowId.value}` : 'urlContentQuestions')
const renderCache = ref<Map<string, { imageUrl: string | null, isRendered: boolean, timestamp: number }>>(new Map())
const imageGenerator = ref<InstanceType<typeof ImageGenerator>>()
const selectedVisionModel = ref<AIModel | null>(null)
const analyzing = ref(false)
const analysisResult = ref<any>(null)
const analysisError = ref('')
const streamingResponse = ref('')
const hasRenderedImage = ref(false)
const analysisAbortController = ref<AbortController | null>(null)
const showModelSelector = ref(false)
const showAddToQuestionBank = ref(false)
const addingToBank = ref(false)
const questionToAdd = ref({ content: '', answer: '' })

const availableVisionModels = computed(() => {
  const visionModels: AIModel[] = []
  for (const platform of modelConfig.platforms) {
    if (platform.enabled && platform.models) {
      visionModels.push(...platform.models.filter(m => m.category === 'vision' && m.enabled))
    }
  }
  return visionModels
})

const platformsWithVisionModels = computed(() => {
  const platformMap = new Map<string, any>()
  modelConfig.platforms.forEach(p => { if (p.enabled) platformMap.set(p.id, { ...p, models: [] }) })
  availableVisionModels.value.forEach(model => {
    const p = platformMap.get(model.platformId)
    if (p) p.models.push(model)
  })
  return Array.from(platformMap.values()).filter(p => p.models.length > 0)
})

const currentQuestion = computed(() => questions.value[currentQuestionIndex.value] || null)

const cleanDuplicateUrls = (text: string): string => {
  if (!text || !text.trim()) return text
  let cleanedText = text
  const urlPattern = /https?:\/\/[^\s`]+/g
  const urls = text.match(urlPattern)
  if (urls && urls.length > 1) {
    const urlCounts = new Map<string, number>()
    urls.forEach(url => urlCounts.set(url, (urlCounts.get(url) || 0) + 1))
    Array.from(urlCounts.entries()).filter(([, count]) => count > 1).forEach(([url]) => {
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      let matchCount = 0
      cleanedText = cleanedText.replace(new RegExp(escapedUrl, 'g'), (match) => {
        matchCount++
        return matchCount === 1 ? match : ''
      })
    })
  }
  return cleanedText
}

const combinedContent = computed(() => {
  if (!currentQuestion.value) return ''
  let content = currentQuestion.value.title || ''
  if (currentQuestion.value.options && currentQuestion.value.options.trim()) {
    content += '\n\n**选项：**\n' + currentQuestion.value.options
    content = cleanDuplicateUrls(content)
  }
  return content
})

const shouldRenderCurrentQuestion = computed(() => {
  if (!currentQuestion.value) return false
  const cached = renderCache.value.get(currentQuestion.value.id)
  return !cached || !cached.isRendered
})

const cachedImageUrl = computed(() => {
  if (!currentQuestion.value) return null
  const cached = renderCache.value.get(currentQuestion.value.id)
  if (cached && cached.isRendered && cached.imageUrl) {
    if (Date.now() - cached.timestamp > 10 * 60 * 1000) {
      renderCache.value.delete(currentQuestion.value.id)
      return null
    }
    return cached.imageUrl
  }
  return null
})

const selectQuestion = (index: number) => {
  if (index < 0 || index >= questions.value.length) return
  const previousIndex = currentQuestionIndex.value
  if (previousIndex === index) return
  if (questions.value[previousIndex]) {
    renderCache.value.set(questions.value[previousIndex].id, {
      imageUrl: getRenderedImageDataSync(),
      isRendered: hasRenderedImage.value,
      timestamp: Date.now()
    })
  }
  currentQuestionIndex.value = index
  if (questions.value[index]?.isNew) {
    questions.value[index].isNew = false
    saveQuestionsToStorage()
  }
  const cached = renderCache.value.get(questions.value[index].id)
  if (cached && cached.isRendered) {
    hasRenderedImage.value = true
    nextTick(() => checkRenderedImage())
  } else {
    hasRenderedImage.value = false
    resetAnalysisState()
    setTimeout(() => checkRenderedImage(), 1000)
  }
}

const removeQuestion = (index: number) => {
  if (questions.value.length <= 1) { clearAllQuestions(); return }
  questions.value.splice(index, 1)
  if (currentQuestionIndex.value >= questions.value.length) currentQuestionIndex.value = questions.value.length - 1
  else if (currentQuestionIndex.value > index) currentQuestionIndex.value--
  saveQuestionsToStorage()
}

const markAsRead = (index: number) => {
  if (questions.value[index]) { questions.value[index].isNew = false; saveQuestionsToStorage() }
}

const clearAllQuestions = () => {
  questions.value = []
  currentQuestionIndex.value = 0
  resetAnalysisState()
  try { localStorage.removeItem(storageKey.value) } catch (e) {}
}

const toggleSidebar = () => { sidebarCollapsed.value = !sidebarCollapsed.value }

const getQuestionPreview = (question: any) => {
  const title = question.title || ''
  return title.length > 30 ? title.substring(0, 30) + '...' : title
}

const onImageReady = (imageUrl: string) => {
  const q = questions.value[currentQuestionIndex.value]
  if (!q) return
  hasRenderedImage.value = true
  renderCache.value.set(q.id, { imageUrl, isRendered: true, timestamp: Date.now() })
}

const onRenderComplete = () => {
  const q = questions.value[currentQuestionIndex.value]
  if (!q) return
  hasRenderedImage.value = true
  renderCache.value.set(q.id, { imageUrl: getRenderedImageDataSync(), isRendered: true, timestamp: Date.now() })
}

const resetAnalysisState = () => {
  analyzing.value = false
  analysisResult.value = null
  analysisError.value = ''
  streamingResponse.value = ''
  hasRenderedImage.value = false
  if (analysisAbortController.value) { analysisAbortController.value.abort(); analysisAbortController.value = null }
}

const saveQuestionsToStorage = () => {
  try { localStorage.setItem(storageKey.value, JSON.stringify(questions.value)) } catch (e) {}
}

const selectVisionModel = (model: AIModel) => {
  selectedVisionModel.value = model
  showModelSelector.value = false
}

const openAddToQuestionBank = () => {
  if (!currentQuestion.value) return
  let combined = combinedContent.value
  const urlRegex = /http:\/\/p\.ananas\.chaoxing\.com\/star3\/origin\/[a-f0-9]+\.gif/g
  const urls = combined.match(urlRegex) || []
  if (urls.length > 0) {
    const urlCount = new Map()
    urls.forEach(url => urlCount.set(url, (urlCount.get(url) || 0) + 1))
    Array.from(urlCount.entries()).filter(([, count]) => count > 1).forEach(([url]) => {
      let firstFound = false
      combined = combined.replace(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (match) => {
        if (!firstFound) { firstFound = true; return match }
        return ''
      })
    })
  }
  questionToAdd.value = { content: combined, answer: '' }
  showAddToQuestionBank.value = true
}

const addQuestionToBank = async () => {
  if (!questionToAdd.value.answer.trim()) { alert('请填写答案内容'); return }
  addingToBank.value = true
  try {
    await databaseService.addQuestion({ content: questionToAdd.value.content, answer: questionToAdd.value.answer, folderId: 0 })
    alert('题目已成功添加到默认文件夹！')
    showAddToQuestionBank.value = false
    questionToAdd.value = { content: '', answer: '' }
  } catch (error: any) {
    alert(`添加失败: ${error.message}`)
  } finally {
    addingToBank.value = false
  }
}

const minimizeWindow = async () => {
  if (!isTauri.value) return
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().minimize() } catch (e) {}
}

const toggleMaximize = async () => {
  if (!isTauri.value) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const w = getCurrentWindow()
    if (isMaximized.value) await w.unmaximize(); else await w.maximize()
    isMaximized.value = !isMaximized.value
  } catch (e) {}
}

const closeWindow = async () => {
  if (!isTauri.value) return
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close() } catch (e) {}
}

const checkTauriEnvironment = () => typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined

watch(() => imageGenerator.value, (generator) => {
  if (generator) setTimeout(() => checkRenderedImage(), 2000)
}, { immediate: true })

const checkRenderedImage = () => {
  try {
    const questionBox = document.querySelector('.question-image-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      if (finalImage && finalImage.src) { hasRenderedImage.value = true; return }
      if (questionBox.querySelector('.rendering-state')) { setTimeout(checkRenderedImage, 1000); return }
      if (questionBox.querySelector('.render-error')) { hasRenderedImage.value = false; return }
      const markdownContent = questionBox.querySelector('.markdown-content')
      if (markdownContent && !questionBox.querySelector('.url-content')) { hasRenderedImage.value = true; return }
    }
    if (!hasRenderedImage.value) setTimeout(checkRenderedImage, 1000)
  } catch (e) { setTimeout(checkRenderedImage, 1000) }
}

const getRenderedImageDataSync = (): string | null => {
  try {
    const questionBox = document.querySelector('.question-image-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      if (finalImage && finalImage.src) return finalImage.src
    }
    if (imageGenerator.value && (imageGenerator.value as any).finalImageUrl) return (imageGenerator.value as any).finalImageUrl
    return null
  } catch (e) { return null }
}

const getRenderedImageData = async (): Promise<string | null> => {
  try {
    const questionBox = document.querySelector('.question-image-box')
    if (questionBox) {
      const finalImage = questionBox.querySelector('.final-image') as HTMLImageElement
      if (finalImage && finalImage.src) return finalImage.src
    }
    if (imageGenerator.value && (imageGenerator.value as any).finalImageUrl) return (imageGenerator.value as any).finalImageUrl
    if (questionBox) {
      for (const img of questionBox.querySelectorAll('.rendered-image, .inline-image, .direct-image')) {
        const el = img as HTMLImageElement
        if (el.src && el.src.startsWith('data:')) return el.src
      }
    }
    return null
  } catch (e) { return null }
}

const analyzeWithAI = async () => {
  if (!selectedVisionModel.value) { analysisError.value = '请选择一个视觉模型'; return }
  const imageData = await getRenderedImageData()
  if (!imageData) { analysisError.value = '无法获取渲染后的图片数据'; return }

  analysisAbortController.value = new AbortController()
  analyzing.value = true
  analysisResult.value = null
  analysisError.value = ''
  streamingResponse.value = ''

  try {
    const platform = modelConfig.platforms.find(p => p.models.some(m => m.id === selectedVisionModel.value!.id))
    if (!platform) throw new Error('找不到模型对应的平台')

    // 构建题目文本（标题 + 编号化选项）
    const questionTitle = currentQuestion.value?.title || ''
    const questionOptions = currentQuestion.value?.options || ''
    const parsedOptions = parseOptions(questionOptions)
    
    // 构建编号映射表 { '1' -> '原始文本', '2' -> ... }
    const optionMap = new Map<string, string>()
    parsedOptions.forEach((opt, i) => {
      optionMap.set(String(i + 1), opt.text)
    })

    let questionText = questionTitle
    if (parsedOptions.length > 0) {
      const numberedOptions = parsedOptions.map((opt, i) => `${i + 1}. ${opt.text}`).join('\n')
      questionText += '\n\n选项：\n' + numberedOptions
    }

    const hasOptions = parsedOptions.length > 0
    const promptText = `以下是题目的原始文本内容（图片中也包含相同题目）：

${questionText}

请仔细分析图片和文本中的题目，给出详细的解题过程和答案。

在回答末尾，严格按照以下格式单独一行给出答案编号：
ANSWER: <编号>

其中编号规则：
${hasOptions
  ? `- 单选题：写正确选项的编号，如 ANSWER: 2
- 多选题：多个编号用空格分隔，如 ANSWER: 1 3
- 判断题：写 正确 或 错误，如 ANSWER: 正确`
  : `- 填空题/解答题：写完整答案内容，如 ANSWER: 42`
}`

    const analysisInput = {
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: imageData, detail: 'high' } },
        { type: 'text', text: promptText }
      ]}],
      model: selectedVisionModel.value.id,
      stream: true
    }
    const config = { apiKey: platform.apiKey, baseUrl: platform.baseUrl, model: selectedVisionModel.value.id, ...selectedVisionModel.value }

    let tauriFetch
    try { const h = await import('@tauri-apps/plugin-http'); tauriFetch = h.fetch } catch { tauriFetch = fetch }

    if (selectedVisionModel.value.jsCode) {
      try {
        let executableCode = selectedVisionModel.value.jsCode.trim()
        let processModel
        if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
          processModel = new Function('input', 'config', 'fetch', 'abortSignal', `${executableCode}\nreturn processModel;`)(analysisInput, config, tauriFetch, analysisAbortController.value?.signal)
        } else {
          processModel = new Function('input', 'config', 'fetch', 'abortSignal', `return (async function processModel(input, config) { ${executableCode} });`)(analysisInput, config, tauriFetch, analysisAbortController.value?.signal)
        }
        const result = await processModel(analysisInput, config)
        if (result) {
          if (result[Symbol.asyncIterator]) {
            let fullResponse = ''
            for await (const chunk of result) {
              if (chunk.content) { fullResponse += chunk.content; streamingResponse.value = fullResponse }
            }
            const answer = resolveAnswerText(parseAnswer(fullResponse), optionMap)
            analysisResult.value = { response: fullResponse, answer, timestamp: new Date().toLocaleString(), modelName: selectedVisionModel.value.displayName }
            // 自动回填答案到原始挂起请求
            if (answer && currentQuestion.value?.requestId) {
              await sendAnswerToRequest(currentQuestion.value.requestId, answer)
            }
          } else {
            const answer = resolveAnswerText(parseAnswer(String(result)), optionMap)
            analysisResult.value = { response: result, answer, timestamp: new Date().toLocaleString(), modelName: selectedVisionModel.value.displayName }
            if (answer && currentQuestion.value?.requestId) {
              await sendAnswerToRequest(currentQuestion.value.requestId, answer)
            }
          }
        } else {
          analysisError.value = '模型配置代码未返回有效结果'
        }
      } catch (codeError: any) {
        analysisError.value = `代码执行错误: ${codeError.message}`
      }
    } else {
      analysisError.value = '模型未配置JavaScript代码'
    }
  } catch (error: any) {
    analysisError.value = `分析失败: ${error.message}`
  } finally {
    analyzing.value = false
    analysisAbortController.value = null
    if (analysisError.value) streamingResponse.value = ''
  }
}

const retryAnalysis = () => analyzeWithAI()

// 解析选项字符串为数组，返回 [{label, text}, ...]
// 支持 "A.xxx" / "A、xxx" / 换行分隔等格式
const parseOptions = (optionsStr: string): Array<{ label: string, text: string }> => {
  if (!optionsStr || !optionsStr.trim()) return []
  const matches = [...optionsStr.matchAll(/(?:^|\n)\s*([A-Za-z])[\.、．]\s*([^\n]*)/g)]
  if (matches.length >= 2) return matches.map(m => ({ label: m[1].toUpperCase(), text: m[2].trim() }))
  const lines = optionsStr.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length >= 2) return lines.map((line, i) => ({ label: String(i + 1), text: line }))
  return [{ label: '1', text: optionsStr.trim() }]
}

// 从 AI 响应中解析 ANSWER: 字段（返回编号数组）
const parseAnswer = (response: string): string[] => {
  const match = response.match(/ANSWER:\s*(.+)/i)
  if (!match) return []
  return match[1].trim().split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
}

// 将编号答案转换为原始文本
const resolveAnswerText = (answerNums: string[], optionMap: Map<string, string>): string => {
  if (answerNums.length === 0) return ''
  return answerNums.map(num => optionMap.get(num) || num).join('###')
}

// 将 AI 答案回填给原始挂起的请求
const sendAnswerToRequest = async (requestId: string, answer: string) => {
  if (!requestId || !answer) return
  try {
    let baseUrl = ''
    try { const status = await invoke<any>('get_server_status'); baseUrl = status?.url || '' } catch (e) {}
    if (!baseUrl) return
    await fetch(`${baseUrl}/api/model/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, content: JSON.stringify({ answer }) })
    })
    console.log('✅ 答案已回填到原始请求:', requestId)
  } catch (e) {
    console.warn('回填答案失败:', e)
  }
}

// 一键添加：用 AI 解析出的答案直接入库
const quickAddToBank = async () => {
  if (!currentQuestion.value || !analysisResult.value?.answer) return
  addingToBank.value = true
  try {
    let combined = combinedContent.value
    const urlRegex = /http:\/\/p\.ananas\.chaoxing\.com\/star3\/origin\/[a-f0-9]+\.gif/g
    const urls = combined.match(urlRegex) || []
    if (urls.length > 0) {
      const urlCount = new Map()
      urls.forEach(url => urlCount.set(url, (urlCount.get(url) || 0) + 1))
      Array.from(urlCount.entries()).filter(([, count]) => count > 1).forEach(([url]) => {
        let firstFound = false
        combined = combined.replace(new RegExp((url as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (match) => {
          if (!firstFound) { firstFound = true; return match }
          return ''
        })
      })
    }
    await databaseService.addQuestion({ content: combined, answer: analysisResult.value.answer, folderId: 0 })
    alert('已成功添加到题库！')
  } catch (error: any) {
    alert(`添加失败: ${error.message}`)
  } finally {
    addingToBank.value = false
  }
}

const getUrlParams = () => {
  const urlParams = new URLSearchParams(window.location.search)
  
  // 读取窗口唯一 ID
  const wid = urlParams.get('windowId')
  if (wid) windowId.value = wid

  const questionsParam = urlParams.get('questions')
  if (questionsParam) {
    try {
      const decoded = JSON.parse(decodeURIComponent(questionsParam))
      questions.value = Array.isArray(decoded) ? decoded : [decoded]
      if (questions.value.length > 0) currentQuestionIndex.value = 0
    } catch {
      const question = urlParams.get('question')
      const options = urlParams.get('options')
      if (question) {
        questions.value = [{ id: `question_${Date.now()}`, title: decodeURIComponent(question), options: options ? decodeURIComponent(options) : '', timestamp: new Date().toLocaleString(), status: 'pending' }]
        currentQuestionIndex.value = 0
      }
    }
  } else {
    try {
      const stored = localStorage.getItem(storageKey.value)
      if (stored) { questions.value = JSON.parse(stored); if (questions.value.length > 0) currentQuestionIndex.value = 0 }
    } catch (e) {}
  }
}

watch(() => window.location.search, () => getUrlParams(), { immediate: false })

onMounted(async () => {
  try { await initTheme() } catch (e) {}
  isTauri.value = checkTauriEnvironment()
  if (isTauri.value) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const appWindow = getCurrentWindow()
      isMaximized.value = await appWindow.isMaximized()
      const unlistenResize = await appWindow.onResized(() => {
        appWindow.isMaximized().then(m => { isMaximized.value = m })
      })
      onUnmounted(() => unlistenResize())
    } catch (e) {}
  }

  getUrlParams()
  if (globalSelectedVisionModel.value) selectedVisionModel.value = globalSelectedVisionModel.value

  const handleNavigation = () => setTimeout(() => getUrlParams(), 100)
  window.addEventListener('popstate', handleNavigation)

  try {
    const { listen } = await import('@tauri-apps/api/event')
    const unlistenTheme = await listen('theme-changed', (event) => {
      const payload = event.payload as any
      if (payload?.theme) {
        const root = document.documentElement
        root.removeAttribute('data-theme')
        if (payload.theme !== 'light') root.setAttribute('data-theme', payload.theme)
      }
    })
    const unlisten = await listen('new-question-added', (event) => {
      const payload = event.payload as any
      // 只处理属于本窗口的事件
      if (payload?.windowId && windowId.value && payload.windowId !== windowId.value) return
      if (payload?.questions) {
        questions.value = payload.questions
        if (payload.latestQuestion) {
          const idx = questions.value.findIndex(q => q.id === payload.latestQuestion.id)
          if (idx !== -1) currentQuestionIndex.value = idx
        } else if (questions.value.length > 0) {
          currentQuestionIndex.value = 0
        }
        saveQuestionsToStorage()
        resetAnalysisState()
        setTimeout(() => checkRenderedImage(), 1000)
      }
    })
    onUnmounted(() => { window.removeEventListener('popstate', handleNavigation); unlisten(); unlistenTheme(); cleanupTheme() })
  } catch (e) {
    onUnmounted(() => { window.removeEventListener('popstate', handleNavigation); cleanupTheme() })
  }
})

watch(globalSelectedVisionModel, (newModel) => {
  if (newModel && (!selectedVisionModel.value || selectedVisionModel.value.id !== newModel.id)) {
    selectedVisionModel.value = newModel
  }
}, { immediate: true })
</script>

<style scoped>
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
  background: var(--bg-primary, #fff);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* 标题栏 */
.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: var(--bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  user-select: none;
  z-index: 1000;
  -webkit-app-region: drag;
}

.header-left {
  margin-left: 10px;
  display: flex;
  align-items: center;
  -webkit-app-region: drag;
}

.menu-toggle-btn {
  padding: 4px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  border-radius: 4px;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
}

.menu-toggle-btn:hover {
  background: var(--bg-tertiary, #e8e8e8);
  color: var(--text-primary, #333);
}

.menu-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  transition: transform 0.3s ease;
}

.menu-icon.flipped { transform: scaleX(-1); }

.header-center {
  flex: 1;
  -webkit-app-region: drag;
}

.header-right {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.window-control {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  -webkit-app-region: no-drag;
}

.window-control:hover { background: var(--bg-tertiary, rgba(0,0,0,0.08)); }
.window-control.close:hover { background: #e74c3c; color: white; }

/* 主区域 */
.main-area {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  width: 200px;
  background: var(--bg-secondary, #f7f7f7);
  border-right: 1px solid var(--border-color, #e0e0e0);
  overflow-y: auto;
  transition: width 0.25s ease;
  flex-shrink: 0;
}

.sidebar.collapsed { width: 0; overflow: hidden; }

.questions { padding: 6px; }

.question {
  padding: 7px 8px;
  margin: 2px 0;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-primary, #333);
  font-size: 13px;
  transition: background 0.15s;
}

.question:hover { background: var(--bg-tertiary, #ebebeb); }
.question.active { background: var(--color-primary, #007acc); color: white; }

.question-content-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  position: relative;
  min-width: 0;
  margin-right: 6px;
}

.question-preview {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  margin-right: 10px;
}

.new-indicator {
  width: 7px;
  height: 7px;
  background: #e74c3c;
  border-radius: 50%;
  position: absolute;
  top: 0;
  right: 0;
  cursor: pointer;
  box-shadow: 0 0 4px rgba(231,76,60,0.5);
}

.question button {
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 14px;
  opacity: 0.5;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.question button:hover { opacity: 1; }

/* 聊天区域 */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary, #fff);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 消息气泡 */
.message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.user-message {
  flex-direction: row-reverse;
}

.ai-message {
  flex-direction: row;
}

.ai-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-primary, #007acc);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 4px;
}

.bubble {
  max-width: 75%;
  border-radius: 12px;
  padding: 12px 16px;
  position: relative;
}

.bubble-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.55;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.user-bubble {
  background: var(--color-primary, #007acc);
  color: white;
  border-top-right-radius: 4px;
}

.user-bubble .bubble-label { color: rgba(255,255,255,0.7); }

.ai-bubble {
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #333);
  border-top-left-radius: 4px;
  border: 1px solid var(--border-color, #e8e8e8);
}

/* 题目图片区域 */
.question-image-box {
  min-width: 200px;
}

.cached-image-wrapper {
  display: block;
  text-align: center;
}

.cached-image {
  max-width: 500px !important;
  width: auto !important;
  height: auto !important;
  border-radius: 6px !important;
  display: block !important;
  margin: 0 auto !important;
}

.question-image-box :deep(.final-image-wrapper) {
  all: initial;
  display: block !important;
  text-align: center;
}

.question-image-box :deep(.final-image) {
  max-width: 500px !important;
  width: auto !important;
  height: auto !important;
  display: block !important;
  margin: 0 auto !important;
  border-radius: 6px !important;
}

/* 思考动画 */
.thinking {
  display: flex;
  gap: 5px;
  padding: 4px 0;
  align-items: center;
}

.thinking span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-secondary, #999);
  animation: bounce 1.2s infinite ease-in-out;
}

.thinking span:nth-child(2) { animation-delay: 0.2s; }
.thinking span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* 答案栏 */
.answer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  border-left: 3px solid var(--color-primary, #007acc);
}

.answer-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary, #007acc);
  white-space: nowrap;
}

.answer-text {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.quick-add-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-primary, #007acc);
  background: var(--color-primary, #007acc);
  color: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.15s;
}

.quick-add-btn:hover:not(:disabled) { background: var(--color-primary-hover, #0062a3); }
.quick-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 错误框 */
.error-box {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #e74c3c;
  font-size: 14px;
}

.retry-btn {
  padding: 4px 10px;
  border: 1px solid #e74c3c;
  background: transparent;
  color: #e74c3c;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  white-space: nowrap;
}

.retry-btn:hover { background: #e74c3c; color: white; }

/* 占位提示 */
.chat-placeholder {
  text-align: center;
  color: var(--text-secondary, #aaa);
  font-size: 14px;
  padding: 40px 0;
}

/* 底部工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border-color, #e8e8e8);
  background: var(--bg-secondary, #fafafa);
  gap: 10px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  color: var(--text-primary, #333);
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
  white-space: nowrap;
}

.toolbar-btn:hover:not(:disabled) { background: var(--bg-tertiary, #f0f0f0); }
.toolbar-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.model-btn {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bank-btn {
  border-color: var(--success-color, #28a745);
  color: var(--success-color, #28a745);
}

.bank-btn:hover:not(:disabled) {
  background: var(--success-color, #28a745);
  color: white;
}

.analyze-btn {
  background: var(--color-primary, #007acc);
  border-color: var(--color-primary, #007acc);
  color: white;
}

.analyze-btn:hover:not(:disabled) {
  background: var(--color-primary-hover, #0062a3);
  border-color: var(--color-primary-hover, #0062a3);
}

/* 空状态 */
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #aaa);
  font-size: 15px;
}

/* 模态框 */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-content {
  background: var(--bg-primary, white);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  width: 400px;
  max-height: 520px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

.add-question-modal { width: 580px; max-height: 80vh; }

.modal-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #eee);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header span { color: var(--text-primary); font-weight: 600; font-size: 15px; }

.modal-header button {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.modal-header button:hover { background: var(--bg-tertiary, #f0f0f0); }

.modal-body {
  padding: 14px 16px;
  max-height: 460px;
  overflow-y: auto;
}

.modal-body h4 {
  margin: 10px 0 5px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.model-item {
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 5px;
  margin: 2px 0;
  color: var(--text-primary);
  font-size: 14px;
  transition: background 0.15s;
}

.model-item:hover { background: var(--bg-tertiary, #f0f0f0); }
.model-item.active { background: var(--color-primary, #007acc); color: white; }

.form-group { margin-bottom: 16px; }

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary);
}

.question-content-textarea,
.answer-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  background: var(--bg-primary, white);
  color: var(--text-primary);
}

.question-content-textarea { background: var(--bg-tertiary, #f8f9fa); color: var(--text-secondary, #666); }

.answer-textarea:focus {
  outline: none;
  border-color: var(--color-primary, #007acc);
  box-shadow: 0 0 0 2px rgba(0,122,204,0.15);
}

.hint-text { margin-top: 6px; font-size: 12px; color: var(--text-secondary, #888); }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #eee);
}

.cancel-btn {
  padding: 8px 18px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  color: var(--text-primary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s;
}

.cancel-btn:hover { background: var(--bg-tertiary, #f0f0f0); }

.confirm-btn {
  padding: 8px 18px;
  border: 1px solid var(--color-primary, #007acc);
  background: var(--color-primary, #007acc);
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.confirm-btn:hover:not(:disabled) { background: var(--color-primary-hover, #0056b3); }

.confirm-btn:disabled {
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #999);
  border-color: var(--border-color, #ddd);
  cursor: not-allowed;
}
</style>
