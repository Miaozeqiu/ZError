<template>
  <!-- 当市场打开时，独立显示市场弹窗，不渲染底层编辑弹窗阴影 -->
  <div v-if="show && marketplaceOpen" class="marketplace-overlay" @click="handleMarketplaceOverlay">
    <div class="marketplace-panel" @click.stop>
      <div class="marketplace-header">
        <div class="marketplace-tabs">
          <button class="marketplace-tab" :class="{ active: marketTab === 'remote' }" @click="marketTab = 'remote'">全部平台</button>
          <button class="marketplace-tab" :class="{ active: marketTab === 'free' }" @click="switchToFreeTab">免费模型</button>
        </div>
        <div class="marketplace-header-actions">
          <button v-if="marketTab === 'free'" class="btn btn-free-search" :disabled="isSearchingFree" @click="searchFreeModels">
            {{ isSearchingFree ? '搜索中…' : '🔍 搜索全网免费模型' }}
          </button>
          <button class="dialog-close" @click="closeMarketplace">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="marketplace-body">
        <!-- 全部平台 Tab -->
        <template v-if="marketTab === 'remote'">
          <div class="marketplace-left">
            <div class="marketplace-list-title">平台</div>
            <div class="platform-list" v-if="!isLoadingMarket && marketPlatforms.length">
              <div
                v-for="p in marketPlatforms"
                :key="p.id"
                class="platform-item"
                :class="{ active: selectedPlatformId === p.id }"
                @click="selectPlatform(p.id)"
              >
                <div class="platform-item-row">
                  <div class="platform-item-icon">
                    <img v-if="p.icon && isImageIcon(p.icon)" :src="getIconUrl(p.icon)" :alt="p.displayName || p.name || p.id" />
                    <div v-else class="icon-fallback-small">{{ (p.displayName || p.name || p.id).slice(0,2).toUpperCase() }}</div>
                  </div>
                  <div class="platform-item-info">
                    <div class="platform-name">{{ p.displayName || p.name || p.id }}</div>
                    <div class="platform-desc">{{ p.description }}</div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="marketplace-placeholder">
              <div v-if="isLoadingMarket">正在加载平台列表…</div>
              <div v-else-if="marketError">{{ marketError }}</div>
              <div v-else>暂无平台数据</div>
            </div>
          </div>
          <div class="marketplace-right">
            <div class="marketplace-list-title">模型</div>
            <div class="custom-item" @click="chooseCustomModel">
              <div class="model-header">
                <div class="model-name">自定义模型</div>
                <div class="model-tag">手动配置</div>
              </div>
              <div class="model-desc">不依赖预设，直接进入编辑配置。</div>
            </div>
            <div class="model-list" v-if="selectedPlatform && selectedPlatform.models?.length">
              <div
                v-for="m in selectedPlatform.models"
                :key="m.id || m.name"
                class="model-item"
                :class="{ active: selectedModelId === (m.id || m.name) }"
                @click="selectModel(m)"
              >
                <div class="model-header">
                  <div class="model-name">{{ m.displayName || m.name || m.id }}</div>
                  <div class="model-tag">{{ (m.category === 'vision' ? '视觉' : '文本') }}</div>
                </div>
                <div class="model-desc">{{ m.description }}</div>
              </div>
            </div>
            <div v-else class="marketplace-placeholder">
              <div v-if="!selectedPlatformId">请先选择左侧平台</div>
              <div v-else>此平台暂无模型或加载失败</div>
            </div>
          </div>
        </template>
        <!-- 免费模型 Tab -->
        <template v-if="marketTab === 'free'">
          <div class="marketplace-free">
            <div class="free-search-bar">
              <input
                v-model="freeSearchQuery"
                type="text"
                class="free-search-input"
                placeholder="搜索免费模型名称…"
              />
            </div>
            <div v-if="isSearchingFree" class="free-loading">
              <div class="free-spinner"></div>
              <span>正在搜索全网免费模型，请稍候…</span>
            </div>
            <div v-else-if="freeModelsError" class="free-error">{{ freeModelsError }}</div>
            <div v-else class="free-model-list">
              <div
                v-for="m in filteredFreeModels"
                :key="m.id"
                class="free-model-item"
                @click="selectFreeModel(m)"
              >
                <div class="free-model-header">
                  <div class="free-model-name">{{ m.displayName || m.name || m.id }}</div>
                  <div class="free-model-badge">{{ m.category === 'vision' ? '🖼️' : '📝' }}</div>
                </div>
                <div class="free-model-provider">{{ m.provider }}</div>
                <div class="free-model-desc">{{ m.description || '免费模型，需自行申请 API Key' }}</div>
                <div class="free-model-tags">
                  <span v-if="m.pricing?.inputTokens === 0" class="free-tag free-tag-free">免费</span>
                  <span v-else-if="m.pricing" class="free-tag">${{ formatPrice(m.pricing.inputTokens) }}/1K tokens</span>
                  <span class="free-tag free-tag-info">{{ m.apiProtocol || 'OpenAI' }} 协议</span>
                </div>
              </div>
              <div v-if="filteredFreeModels.length === 0" class="marketplace-placeholder">
                没有找到匹配的免费模型
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
  <!-- 市场未打开时，显示常规编辑弹窗 -->
  <div v-else-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content" @click.stop>
      <!-- <div class="dialog-header" v-if="!marketplaceOpen">
        <h3 class="dialog-title">{{ isEditing ? '编辑模型' : '添加模型' }}</h3>
        <div class="dialog-header-actions">
          <button class="dialog-close" @click="$emit('close')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div> -->

      <div class="dialog-body">
        <div class="split-container" v-if="!marketplaceOpen">
          <!-- 左侧：JavaScript 配置代码（高亮 + 语法检查） -->
          <div class="editor-panel">
            <div class="editor-header">JavaScript 配置代码</div>
          <div class="code-editor">
            <div ref="cmContainerRef" class="cm-container"></div>
          </div>
        </div>

          <!-- 右侧：基本信息与操作按钮 -->
          <form class="form-panel" @submit.prevent="handleSubmit">
            <div class="form-group">
              <label class="form-label">名称</label>
              <input
                v-model="formData.displayName"
                type="text"
                class="form-input"
                placeholder="例如：GPT-4 Turbo"
                required
              >
            </div>

            <div class="form-group">
              <label class="form-label">模型分类</label>
              <ModelCategorySwitch v-model="formData.category" />
            </div>

            <div class="form-group">
              <label class="form-label form-label--row">
                <span>启用思考</span>
                <label class="switch-toggle">
                  <input type="checkbox" v-model="formData.enableThinking" />
                  <span class="switch-slider"></span>
                </label>
              </label>
              <p class="form-hint">开启后，模型会输出思考过程，但响应时间可能明显变长。部分模型/API服务不支持此功能。</p>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" @click="$emit('close')">取消</button>
              <button type="submit" class="btn btn-primary">{{ isEditing ? '保存' : '添加' }}</button>
            </div>
          </form>
        </div>
        <!-- 市场弹窗独立渲染于根节点，移除内嵌版本 -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { linter, lintGutter } from '@codemirror/lint'
import * as acorn from 'acorn'
import { fetchRemoteModelsCatalog, type AIModel } from '../../../services/modelConfig'
import { getPlatformIconDisplayUrl, isImageIconValue, resolvePlatformIconUrl } from '../../../services/iconCache'
import ModelCategorySwitch from './ModelCategorySwitch.vue'

interface Props {
  show: boolean
  model?: AIModel | null
  // 是否在新增模式下默认打开模型广场
  startInMarketplace?: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'save', model: Partial<AIModel>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const formData = ref({
  displayName: '',
  category: 'text' as 'text' | 'vision' | 'summary',
  jsCode: '',
  enableThinking: false
})

const isEditing = computed(() => !!props.model)

const DEFAULT_JS_CODE = `
/**
 * @param {string} prompt - The user's input prompt.
 * @param {object} context - The context object.
 * @param {object} context.request - The request object from the client.
 * @param {function} context.get - A function to get a value from the context.
 * @param {function} context.set - A function to set a value in the context.
 * @returns {object} - The modified request payload.
 */
function transform(prompt, context) {
  // Example: Add a system message to the chat history
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: prompt }
  ];
  
  const payload = {
    ...context.request, // Preserve original request parameters
    messages: messages,
    stream: true, // Enable streaming response
  };
  
  // If the incoming request has tools (e.g. for function calling), pass them along
  if (context.request.tools) {
    payload.tools = context.request.tools;
  }
  
  return payload;
}
`.trim()

const DEFAULT_VISION_JS_CODE = `
/**
 * @param {string} prompt - The user's input prompt.
 * @param {object} context - The context object.
 * @param {object} context.request - The request object from the client.
 * @param {function} context.get - A function to get a value from the context.
 * @param {function} context.set - A function to set a value in the context.
 * @param {string} context.imageUrl - The base64 encoded image or image URL.
 * @returns {object} - The modified request payload.
 */
function transform(prompt, context) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: context.imageUrl } }
      ]
    }
  ];
  
  const payload = {
    ...context.request,
    messages: messages,
    stream: true,
  };
  
  // If the incoming request has tools (e.g. for function calling), pass them along
  if (context.request.tools) {
    payload.tools = context.request.tools;
  }
  
  return payload;
}
`.trim()

// 监听模型变化，更新表单数据
watch(() => props.model, (newModel) => {
  if (newModel) {
    formData.value = {
      displayName: newModel.displayName,
      category: newModel.category || 'text',
      jsCode: newModel.jsCode || (newModel.category === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE),
      enableThinking: newModel.enableThinking === true
    }
    // 若编辑器已存在，确保文档与最新模型代码同步
    nextTick(() => {
      if (cmView) {
        setEditorDoc(formData.value.jsCode)
      }
    })
  } else {
    // 重置表单为默认值
    formData.value = {
      displayName: '',
      category: 'text',
      jsCode: DEFAULT_JS_CODE,
      enableThinking: false
    }
    // 清空到默认模板，避免残留旧代码
    nextTick(() => {
      if (cmView) {
        setEditorDoc(DEFAULT_JS_CODE)
      }
    })
  }
}, { immediate: true, deep: true })

// 监听类别切换自动替换模板
watch(() => formData.value.category, (newCategory) => {
  if (!isEditing.value && (!formData.value.jsCode || formData.value.jsCode === DEFAULT_JS_CODE || formData.value.jsCode === DEFAULT_VISION_JS_CODE)) {
    formData.value.jsCode = newCategory === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE;
    nextTick(() => {
      if (cmView) {
        setEditorDoc(formData.value.jsCode);
      }
    })
  }
});

// 监听弹窗显示状态，打开时初始化，关闭时销毁以避免视图挂载丢失
watch(() => props.show, async (visible) => {
  if (visible) {
    await nextTick()

    // 打开时先重置市场状态，避免复用旧状态导致错误显示
    marketplaceOpen.value = false

    // 如果是“新增并默认进入市场”的场景，直接打开市场并跳过编辑器初始化
    if (!isEditing.value && props.startInMarketplace) {
      // 清理旧编辑器实例（如果存在）
      if (cmView) {
        cmView.destroy()
        cmView = null
      }
      openMarketplace()
      return
    }

    // 编辑模式或非默认进入市场：确保表单与当前模型同步后再初始化编辑器
    if (props.model) {
      formData.value = {
        displayName: props.model.displayName,
        category: props.model.category || 'text',
        jsCode: props.model.jsCode || (props.model.category === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE),
        enableThinking: props.model.enableThinking === true
      }
    } else {
      // 非编辑模式但不进市场时，使用默认模板
      formData.value = {
        displayName: '',
        category: 'text',
        jsCode: DEFAULT_JS_CODE,
        enableThinking: false
      }
    }

    // 如果存在旧的 EditorView（可能因 v-if 被移除父容器），先销毁后重建
    await rebuildEditorWithDoc(formData.value.jsCode)
  } else {
    // 隐藏时销毁实例，防止持有已移除的 DOM 引用导致下次无法显示
    if (cmView) {
      cmView.destroy()
      cmView = null
    }
  }
})

// ===== JavaScript 高亮 =====
const cmContainerRef = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let themeObserver: MutationObserver | null = null

// 统一的编辑器重建方法：在容器真正挂载后再初始化，避免弹窗复用时出现空白编辑器
const rebuildEditorWithDoc = async (text: string, retries = 6): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    await nextTick()

    if (!cmContainerRef.value) {
      continue
    }

    if (cmView) {
      cmView.destroy()
      cmView = null
    }

    initCodeMirror()
    if (cmView) {
      setEditorDoc(text ?? '')
      return
    }
  }

  console.warn('ModelConfigDialog: CodeMirror 初始化失败，cmContainerRef 未就绪')
}

// 轻量语法检查：仅捕获语法错误（不做风格检查）
const jsSyntaxLinter = linter((view) => {
  const diagnostics = [] as any[]
  const code = view.state.doc.toString()
  try {
    acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: true
    })
  } catch (err: any) {
    const pos = typeof err?.pos === 'number' ? err.pos : 0
    diagnostics.push({
      from: Math.max(0, Math.min(pos, view.state.doc.length)),
      to: Math.max(0, Math.min(pos + 1, view.state.doc.length)),
      severity: 'error',
      message: err?.message || 'Syntax error'
    })
  }
  return diagnostics
})

const initCodeMirror = () => {
  if (!cmContainerRef.value || cmView) return
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark'
  const baseExtensions = [
    lineNumbers(),
    javascript(),
    jsSyntaxLinter,
    lintGutter(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        formData.value.jsCode = update.state.doc.toString()
      }
    }),
    EditorView.theme({
      '.cm-content': {
        fontFamily: "'Consolas','Monaco','Courier New',monospace",
        fontSize: '13px',
        lineHeight: '20px'
      },
      '&.cm-editor': { height: '100%' }
    })
  ]
  const themeExtensions = isDarkTheme
    ? [oneDark]
    : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]

  const state = EditorState.create({
    doc: formData.value.jsCode ?? '',
    extensions: [...baseExtensions, ...themeExtensions]
  })
  cmView = new EditorView({ state, parent: cmContainerRef.value })
}

const setEditorDoc = (text: string) => {
  if (!cmView) return
  const state = cmView.state
  cmView.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text ?? '' } }))
}

onMounted(() => {
  // 监听主题变化：当 data-theme 改变且弹窗可见时，重建编辑器以应用新主题
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        if (props.show) {
          const currentText = cmView ? cmView.state.doc.toString() : formData.value.jsCode
          if (cmView) {
            cmView.destroy()
            cmView = null
          }
          void rebuildEditorWithDoc(currentText ?? '')
        }
      }
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
})

const handleOverlayClick = (event: MouseEvent) => {
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.closest('input') ||
    target.closest('textarea') ||
    target.closest('.code-editable') ||
    target.closest('.cm-editor') ||
    target.closest('.cm-content') ||
    target.closest('.cm-gutters')
  ) {
    return
  }
  
  // 使用 setTimeout 延迟检查文本选择状态，避免时序问题
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }
    
    // 检查是否有任何输入框处于焦点状态
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return
    }
    
    emit('close')
  }, 0)
}

// ===== 免费模型搜索 =====
const FREE_MODELS_PROVIDERS: MarketplacePlatform[] = [
  {
    id: 'free-groq',
    name: 'Groq',
    displayName: 'Groq',
    description: 'Groq LPU 推理引擎，提供极速免费的 LLM 推理',
    baseUrl: 'https://api.groq.com/openai/v1',
    icon: '⚡',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', displayName: 'Llama 3.3 70B', description: 'Meta Llama 3.3 70B，Groq 免费提供', category: 'text', maxTokens: 8192 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', displayName: 'Llama 3.1 8B Instant', description: 'Meta Llama 3.1 8B，极速推理', category: 'text', maxTokens: 8192 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', displayName: 'Mixtral 8x7B', description: 'Mistral Mixtral 8x7B，32K 上下文', category: 'text', maxTokens: 32768 },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B', displayName: 'Gemma 2 9B IT', description: 'Google Gemma 2 9B', category: 'text', maxTokens: 8192 },
    ]
  },
  {
    id: 'free-openrouter',
    name: 'OpenRouter',
    displayName: 'OpenRouter',
    description: '聚合多个 AI 模型，含免费模型额度',
    baseUrl: 'https://openrouter.ai/api/v1',
    icon: '🌐',
    models: [
      { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B', displayName: 'Llama 3.2 3B Instruct (Free)', description: 'Meta 最新小模型，完全免费', category: 'text', maxTokens: 8192 },
      { id: 'microsoft/phi-3-mini-128k-instruct:free', name: 'Phi-3 Mini', displayName: 'Phi-3 Mini 128K (Free)', description: 'Microsoft Phi-3，128K 上下文', category: 'text', maxTokens: 128000 },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B', displayName: 'Mistral 7B Instruct (Free)', description: 'Mistral 7B 开源模型', category: 'text', maxTokens: 8192 },
      { id: 'qwen/qwen-2-7b-instruct:free', name: 'Qwen 2 7B', displayName: 'Qwen 2 7B Instruct (Free)', description: '阿里通义千问 7B', category: 'text', maxTokens: 32768 },
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B', displayName: 'Gemma 2 9B IT (Free)', description: 'Google Gemma 2', category: 'text', maxTokens: 8192 },
    ]
  },
  {
    id: 'free-google',
    name: 'Google AI',
    displayName: 'Google AI Studio',
    description: 'Google Gemini API，有免费额度',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    icon: '🔮',
    models: [
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', displayName: 'Gemini 2.0 Flash', description: 'Google 最新免费模型，快速且强大', category: 'text', maxTokens: 8192 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', displayName: 'Gemini 1.5 Flash', description: '高速免费模型', category: 'text', maxTokens: 32768 },
      { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B', displayName: 'Gemini 1.5 Flash 8B', description: '轻量级免费模型', category: 'text', maxTokens: 32768 },
    ]
  },
  {
    id: 'free-deepseek',
    name: 'DeepSeek',
    displayName: 'DeepSeek',
    description: 'DeepSeek 官方 API，价格极低',
    baseUrl: 'https://api.deepseek.com',
    icon: '🧠',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', displayName: 'DeepSeek V3', description: 'DeepSeek 最新版，极低价格', category: 'text', maxTokens: 32768 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', displayName: 'DeepSeek R1', description: 'DeepSeek 推理模型（思考模型）', category: 'text', maxTokens: 32768, enableThinking: true },
    ]
  },
  {
    id: 'free-github',
    name: 'GitHub Models',
    displayName: 'GitHub Models',
    description: 'GitHub Marketplace 免费模型，需 GitHub Token',
    baseUrl: 'https://models.inference.ai.azure.com',
    icon: '🐙',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', displayName: 'GPT-4o Mini', description: 'OpenAI 最新小模型，GitHub 免费提供', category: 'text', maxTokens: 16384 },
      { id: 'gpt-4o', name: 'GPT-4o', displayName: 'GPT-4o', description: 'OpenAI GPT-4o，GitHub 有限免费', category: 'text', maxTokens: 16384 },
      { id: 'Phi-3.5-MoE-instruct', name: 'Phi-3.5 MoE', displayName: 'Phi-3.5 MoE', description: 'Microsoft Phi-3.5 MoE', category: 'text', maxTokens: 32768 },
      { id: 'AI21-Jamba-1.5-Mini', name: 'Jamba 1.5 Mini', displayName: 'Jamba 1.5 Mini', description: 'AI21 Jamba 1.5', category: 'text', maxTokens: 256000 },
    ]
  },
]

interface FreeModelItem {
  id: string
  name?: string
  displayName?: string
  description?: string
  category?: 'text' | 'vision'
  provider?: string
  providerBaseUrl?: string
  pricing?: { inputTokens: number; outputTokens: number }
  enableThinking?: boolean
  apiProtocol?: string
  icon?: string
}

const marketTab = ref<'remote' | 'free'>('remote')
const freeSearchQuery = ref('')
const isSearchingFree = ref(false)
const freeModelsError = ref<string | null>(null)
const discoveredFreeModels = ref<FreeModelItem[]>([])

const switchToFreeTab = () => {
  marketTab.value = 'free'
  // 首次打开免费tab时，加载内置列表
  if (discoveredFreeModels.value.length === 0) {
    loadBuiltinFreeModels()
  }
}

const loadBuiltinFreeModels = () => {
  const models: FreeModelItem[] = []
  for (const provider of FREE_MODELS_PROVIDERS) {
    for (const m of (provider.models || [])) {
      models.push({
        id: m.id || m.name || '',
        name: m.name,
        displayName: m.displayName || m.name || m.id,
        description: m.description || provider.description,
        category: m.category || 'text',
        provider: provider.displayName || provider.name,
        providerBaseUrl: provider.baseUrl,
        enableThinking: m.enableThinking,
        apiProtocol: 'OpenAI',
        icon: provider.icon,
      })
    }
  }
  discoveredFreeModels.value = models
}

const filteredFreeModels = computed(() => {
  const q = freeSearchQuery.value.trim().toLowerCase()
  if (!q) return discoveredFreeModels.value
  return discoveredFreeModels.value.filter(m =>
    (m.displayName?.toLowerCase().includes(q)) ||
    (m.name?.toLowerCase().includes(q)) ||
    (m.provider?.toLowerCase().includes(q)) ||
    (m.description?.toLowerCase().includes(q))
  )
})

const formatPrice = (price?: number): string => {
  if (price === undefined || price === null) return '免费'
  if (price === 0) return '免费'
  return price.toFixed(6)
}

const searchFreeModels = async () => {
  isSearchingFree.value = true
  freeModelsError.value = null
  try {
    // 先加载内置免费模型
    loadBuiltinFreeModels()

    // 尝试从 OpenRouter API 获取免费模型
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    let orResponse: Response | null = null
    try {
      orResponse = await tauriFetch('https://openrouter.ai/api/v1/models', { method: 'GET' })
    } catch {
      try {
        orResponse = await fetch('https://openrouter.ai/api/v1/models')
      } catch {}
    }

    if (orResponse?.ok) {
      const data = await orResponse.json()
      if (data?.data && Array.isArray(data.data)) {
        const existingIds = new Set(discoveredFreeModels.value.map(m => m.id))
        const newModels: FreeModelItem[] = []

        for (const model of data.data) {
          // 只取免费模型（定价为空或价格为 0 的）
          const pricing = model.pricing
          const isFree = !pricing || (pricing.prompt === 0 && pricing.completion === 0)
          if (!isFree) continue

          const modelId = model.id || ''
          if (existingIds.has(modelId)) continue
          existingIds.add(modelId)

          newModels.push({
            id: modelId,
            name: model.id,
            displayName: model.name || model.id,
            description: model.description || `OpenRouter 免费模型`,
            category: 'text' as const,
            provider: 'OpenRouter',
            providerBaseUrl: 'https://openrouter.ai/api/v1',
            apiProtocol: 'OpenAI',
            icon: '🌐',
          })
        }

        if (newModels.length > 0) {
          discoveredFreeModels.value = [...newModels, ...discoveredFreeModels.value]
        }
      }
    }
  } catch (err: any) {
    // 内置免费模型已加载，不报错
    console.warn('搜索免费模型失败（内置列表已加载）:', err)
  } finally {
    isSearchingFree.value = false
  }
}

const selectFreeModel = (m: FreeModelItem) => {
  // 选择免费模型后自动填充到表单
  formData.value.displayName = m.displayName || m.name || m.id
  formData.value.category = m.category || 'text'
  formData.value.enableThinking = m.enableThinking === true

  // 生成 jsCode
  const baseUrl = m.providerBaseUrl || ''
  const modelId = m.id
  formData.value.jsCode = `
/**
 * OpenAI 兼容协议 - 免费模型
 */
function transform(prompt, context) {
  const messages = [
    { role: 'system', content: '你是一个答题助手。请直接给出答案，不要额外解释。' },
    { role: 'user', content: prompt }
  ];
  return {
    ...context.request,
    model: '${modelId}',
    messages: messages,
    stream: true,
  };
}
`.trim()

  // 关闭市场
  marketplaceOpen.value = false
  void rebuildEditorWithDoc(formData.value.jsCode)
}

// ===== 模型广场（远程 JSON 选择） =====
interface MarketplaceModel {
  id?: string
  name?: string
  displayName?: string
  description?: string
  category?: 'text' | 'vision'
  jsCode?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  enabled?: boolean
  enableThinking?: boolean
}

interface MarketplacePlatform {
  id: string
  name?: string
  displayName?: string
  description?: string
  baseUrl?: string
  icon?: string
  models?: MarketplaceModel[]
}

const marketplaceOpen = ref(false)
const marketPlatforms = ref<MarketplacePlatform[]>([])
const isLoadingMarket = ref(false)
const marketError = ref<string | null>(null)
const selectedPlatformId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const resolvedIconUrls = ref<Record<string, string>>({})
const selectedPlatform = computed(() => marketPlatforms.value.find(p => p.id === selectedPlatformId.value) || null)
const selectedModel = computed<MarketplaceModel | null>(() => {
  const p = selectedPlatform.value
  if (!p || !p.models) return null
  return p.models.find(m => (m.id || m.name) === selectedModelId.value) || null
})

const primeIconUrlCache = async (icon?: string) => {
  if (!icon || !isImageIconValue(icon)) return

  resolvedIconUrls.value[icon] = getPlatformIconDisplayUrl(icon)

  try {
    resolvedIconUrls.value[icon] = await resolvePlatformIconUrl(icon)
  } catch (error) {
    console.warn('缓存平台图标失败，回退到原始地址:', icon, error)
  }
}

const openMarketplace = async () => {
  marketplaceOpen.value = true
  if (!marketPlatforms.value.length) {
    await loadMarketplace()
  }
}

const closeMarketplace = () => {
  // 在“添加模式且由添加流程直接进入市场”的场景下，关闭市场即退出添加流程
  if (!isEditing.value && props.startInMarketplace) {
    emit('close')
    return
  }
  // 其他场景（例如从编辑界面打开市场），关闭市场返回原编辑界面
  marketplaceOpen.value = false
}

const handleMarketplaceOverlay = () => {
  // 点击遮罩关闭（保留与主对话框一致的体验）
  closeMarketplace()
}

const loadMarketplace = async () => {
  isLoadingMarket.value = true
  marketError.value = null
  try {
    const catalog = await fetchRemoteModelsCatalog()
    marketPlatforms.value = catalog.platforms as MarketplacePlatform[]
    await Promise.all(marketPlatforms.value.map(platform => primeIconUrlCache(platform.icon)))
  } catch (err: any) {
    console.warn('加载模型广场失败：', err)
    marketError.value = err?.message || '无法加载模型广场数据'
  } finally {
    isLoadingMarket.value = false
  }
}

const selectPlatform = (pid: string) => {
  selectedPlatformId.value = pid
  selectedModelId.value = null
}

const selectModel = (m: MarketplaceModel) => {
  selectedModelId.value = (m.id || m.name) ?? ''
  // 点击模型后直接确认并进入编辑
  confirmMarketplaceSelection()
}

const confirmMarketplaceSelection = () => {
  if (!selectedModel.value || !selectedPlatform.value) return
  const m = selectedModel.value

  // 仅从市场选择中回填必要字段
  formData.value.displayName = m.displayName || m.name || m.id || ''
  // 若市场提供分类，则同步到表单，便于直接提交
  if (m.category) {
    formData.value.category = m.category
  }
  formData.value.jsCode = m.jsCode || (formData.value.category === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE)

  // 关闭市场面板
  marketplaceOpen.value = false
  void rebuildEditorWithDoc(formData.value.jsCode)
}

const isImageIcon = (icon: string) => isImageIconValue(icon)

const getIconUrl = (icon: string) => {
  if (!icon) return ''
  return resolvedIconUrls.value[icon] || getPlatformIconDisplayUrl(icon) || icon
}

// 自定义模型入口：不依赖远程数据，打开编辑并填充默认值
const chooseCustomModel = () => {
  // 回填默认值到表单
  formData.value.displayName = ''
  formData.value.category = 'text'
  formData.value.jsCode = DEFAULT_JS_CODE

  // 关闭市场面板，回到编辑界面
  marketplaceOpen.value = false
  void rebuildEditorWithDoc(formData.value.jsCode)
}

const handleSubmit = () => {
  if (!formData.value.displayName.trim()) {
    alert('请输入模型名称')
    return
  }

  const modelData: Partial<AIModel> = {
    displayName: formData.value.displayName.trim(),
    category: formData.value.category,
    jsCode: formData.value.jsCode,
    enableThinking: formData.value.enableThinking
  }

  // 如果是编辑模式，保留原有的id
  if (isEditing.value && props.model) {
    modelData.id = props.model.id
  }

  emit('save', modelData)
}
</script>

<style>
@import '../../../styles/dialog.css';
</style>

<style scoped>
.dialog-overlay {
  background: var(--platform-config-overlay-bg);
}

.dialog-content {
  background: var(--platform-config-dialog-bg);
  border: 1px solid var(--platform-config-dialog-border);
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  width: 92vw;           /* 随主窗口变化的宽度 */
  max-width: 1400px;     /* 合理的最大宽度限制 */      /* 随主窗口变化的高度 */
  overflow: hidden;
  display: flex;
  flex-direction: column;
  will-change: transform, opacity;
  transform-origin: center center;
  backface-visibility: hidden;
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.dialog-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0;
}

.dialog-close {
  height: 30px;
  width: 30px;
  align-items: center;
  justify-content: center;
  background: var(--dialog-button-close-bg);
  border: none;
  color: var(--dialog-button-close-text);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.dialog-close:hover {
  background: var(--dialog-button-close-hover-bg);
  color: var(--dialog-button-close-hover-text);
}

.dialog-body {
  padding: 24px;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 由内部区域控制滚动 */
}

/* 分栏布局 */
.split-container {
  display: flex;
  gap: 16px;
  flex: 1 1 auto;
  min-height: 0;  /* 允许子项根据可用空间收缩 */
  min-width: 0;   /* 防止子项溢出导致布局错位 */
}

.editor-panel {
  flex: 1 1 auto;         /* 占据除右侧表单外的剩余宽度 */
  display: flex;
  flex-direction: column;
  min-height: 0;          /* 让编辑器按高度自适应 */
  min-width: 0;           /* 允许内容在窄屏时收缩 */
}

.form-panel {
  flex: 0 0 360px;        /* 固定宽度 */
  width: 360px;
  max-width: 380px;       /* 限制最大宽度以防样式抖动 */
}

.editor-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
  margin-bottom: 8px;
}

.code-editor {
  position: relative;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  background: var(--bg-primary, #ffffff);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  min-height: 240px;
  overflow: hidden; /* 容器不要出现第二个滚动条 */
  flex: 1;           /* 填满可用高度，底部距离固定 */
  display: flex;     /* 让内部 contenteditable 高度100%生效 */
}

/* CodeMirror 容器与内部样式 */
.cm-container {
  position: relative;
  width: 100%;
  height: 100%;
}
.code-editor :deep(.cm-editor) {
  height: 100%;
}
.code-editor :deep(.cm-content) {
  padding: 12px;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  font-size: 13px;
  line-height: 20px;
}
.code-editor :deep(.cm-gutters) {
  border-right: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-primary, #ffffff);
}

.code-hl {
  position: absolute;
  inset: 0;
  padding: 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden; /* 高亮层不显示滚动条 */
  pointer-events: none;
  z-index: 0;
  font-size: 13px;
}

.code-input {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 12px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: transparent; /* 通过高亮层显示文本 */
  caret-color: var(--text-primary, #2d3748);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  line-height: 1.4;
  overflow: auto; /* 仅 textarea 保留滚动条 */
  box-sizing: border-box;
  white-space: pre-wrap; /* 尽可能与高亮层换行一致 */
  tab-size: 2;
  z-index: 1; /* 保证光标在高亮层之上显示 */
}

/* 已移除 lint 状态区样式 */

/* 高亮配色（轻量） */
.hl-comment { color: #718096; }
.hl-string  { color: #38a169; }
.hl-keyword { color: #6366f1; font-weight: 600; }
.hl-number  { color: #d69e2e; }
.hl-constant{ color: #e11d48; font-weight: 600; }
.hl-operator{ color: #f97316; }
.hl-punc    { color: #64748b; }

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin-bottom: 6px;
}


.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--dialog-button-primary-bg);
  color: var(--dialog-button-primary-text);
}

.btn-primary:hover {
  background: var(--dialog-button-primary-hover);
}

.btn-secondary {
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border: 1px solid var(--dialog-button-secondary-border);
}

.btn-secondary:hover {
  background: var(--dialog-button-secondary-hover-bg);
  color: var(--dialog-button-secondary-hover-text);
}

/* 图标相关样式 */
.icon-section {
  margin-bottom: 20px;
}

.icon-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.icon-display {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border-color, #e2e8f0);
  background: var(--bg-tertiary, #f7fafc);
}

.icon-image {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
}

.icon-emoji {
  font-size: 24px;
}

.icon-fallback {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary, #667eea);
}

.icon-preview-text {
  font-size: 14px;
  color: var(--text-secondary, #718096);
}

.icon-input-group {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.icon-input {
  flex: 1;
}

.btn-icon {
  padding: 10px 16px;
  background: var(--bg-tertiary, #f7fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-primary, #2d3748);
}

.btn-icon:hover {
  background: var(--hover-bg, #edf2f7);
}

.icon-picker {
  position: relative;
}

.icon-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-secondary, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  z-index: 1001;
  max-height: 300px;
  overflow-y: auto;
}

.icon-section-title {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
  background: var(--bg-tertiary, #f7fafc);
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
  gap: 8px;
  padding: 12px;
}

.icon-option {
  width: 50px;
  height: 50px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-secondary, #ffffff);
}

.icon-option:hover {
  border-color: var(--primary, #667eea);
  background: var(--bg-tertiary, #f7fafc);
}

.icon-option img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.icon-option .emoji {
  font-size: 20px;
}


</style>
<style scoped>
/* 追加样式：头部动作区与模型广场 */
.dialog-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-tertiary {
  background: var(--bg-tertiary, #f7fafc);
  color: var(--text-primary, #2d3748);
  border: 1px solid var(--border-color, #e2e8f0);
}

.btn-tertiary:hover {
  background: var(--hover-bg, #edf2f7);
}

.marketplace-overlay {
  position: fixed;
  inset: 0;
  background: var(--platform-config-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: overlay-fade-in 160ms ease-out both;
}

.marketplace-panel {
  width: 90vw;
  max-width: 1200px;
  height: 80vh;
  background: var(--platform-config-dialog-bg, #ffffff);
  border: 1px solid var(--platform-config-dialog-border);
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  will-change: transform, opacity;
  transform-origin: center center;
  backface-visibility: hidden;
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.marketplace-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--platform-config-dialog-header-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.marketplace-title {
  margin: 0px;
  font-size: 18px;
  font-weight: 600;
}

.marketplace-actions {
  display: flex;
  gap: 8px;
}

.marketplace-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.marketplace-left {
  flex: 0 0 380px;
  border-right: 1px solid var(--platform-config-dialog-header-border);
  padding: 12px;
  overflow: auto;
}

.marketplace-right {
  flex: 1;
  padding: 12px;
  overflow: auto;
}

.marketplace-list-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
  margin-bottom: 8px;
}

.platform-list, .model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.platform-item, .model-item {
  border: 1px solid var(--platform-config-icon-option-border, #e2e8f0);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--platform-config-icon-option-bg, #ffffff);
  cursor: pointer;
}

.platform-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.platform-item-icon img {
  width: 40px;
  height: 40px;
  max-width: 40px;
  max-height: 40px;
  object-fit: contain;
  border-radius: 6px;
}

.icon-fallback-small {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--platform-config-icon-fallback-text);
  border: 2px solid var(--platform-config-icon-display-border);
}

/* 自定义项与模型项保持一致的外观 */
.custom-item {
  border: 1px solid var(--platform-config-icon-option-bg, #e2e8f0);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg-primary, #ffffff);
  cursor: pointer;
  margin-bottom: 8px;
}
.custom-item:hover {
  background: var(--bg-tertiary, #f7fafc);
}

.platform-item:hover, .model-item:hover {
  border-color: var(--primary, #667eea);
  background: var(--platform-item-active-bg, #f7fafc);
}

.platform-item.active, .model-item.active {
  border-color: var(--primary, #667eea);
  background: var(--platform-item-active-bg, #f7fafc);
}

.platform-name { font-weight: 600; }
.platform-desc { font-size: 12px; color: var(--text-secondary, #718096); }

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-name { font-weight: 600; }
.model-tag {
  background-color: var(--platform-config-icon-section-title-bg);
  font-size: 12px;
  color: var(--text-secondary, #718096);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 2px 6px;
}

.model-desc { font-size: 12px; color: var(--text-secondary, #718096); margin-top: 6px; }

.marketplace-placeholder { font-size: 13px; color: var(--text-secondary, #718096); padding: 12px; }

/* 市场 tabs */
.marketplace-tabs {
  display: flex;
  gap: 4px;
}

.marketplace-tab {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #718096);
  transition: all 0.2s;
}

.marketplace-tab.active {
  background: var(--color-primary, #667eea);
  color: #fff;
  border-color: var(--color-primary, #667eea);
}

.marketplace-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-free-search {
  padding: 6px 12px;
  border: 1px solid var(--color-primary, #667eea);
  background: transparent;
  color: var(--color-primary, #667eea);
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.2s;
}

.btn-free-search:hover:not(:disabled) {
  background: var(--color-primary, #667eea);
  color: #fff;
}

.btn-free-search:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 免费模型面板 */
.marketplace-free {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}

.free-search-bar {
  margin-bottom: 12px;
  flex-shrink: 0;
}

.free-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #2d3748);
  outline: none;
  box-sizing: border-box;
}

.free-search-input:focus {
  border-color: var(--color-primary, #667eea);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.free-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-secondary, #718096);
  font-size: 14px;
}

.free-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color, #e2e8f0);
  border-top-color: var(--color-primary, #667eea);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.free-error {
  padding: 20px;
  text-align: center;
  color: var(--text-error, #e53e3e);
  font-size: 14px;
}

.free-model-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.free-model-item {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  transition: all 0.2s;
}

.free-model-item:hover {
  border-color: var(--color-primary, #667eea);
  background: var(--hover-bg, #f7fafc);
}

.free-model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.free-model-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #2d3748);
}

.free-model-badge {
  font-size: 16px;
}

.free-model-provider {
  font-size: 12px;
  color: var(--color-primary, #667eea);
  margin-bottom: 4px;
}

.free-model-desc {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin-bottom: 6px;
}

.free-model-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.free-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-tertiary, #f7fafc);
  color: var(--text-secondary, #718096);
  border: 1px solid var(--border-color, #e2e8f0);
}

.free-tag-free {
  background: #c6f6d5;
  color: #276749;
  border-color: #9ae6b4;
  font-weight: 600;
}

.free-tag-info {
  background: #bee3f8;
  color: #2b6cb0;
  border-color: #90cdf4;
}

/* 切换开关样式 */
.form-label--row {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin: 4px 0 0 0;
  line-height: 1.4;
}

.switch-toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--bg-tertiary, #cbd5e0);
  border-radius: 22px;
  transition: 0.3s;
}

.switch-slider::before {
  content: "";
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}

.switch-toggle input:checked + .switch-slider {
  background-color: var(--color-primary, #667eea);
}

.switch-toggle input:checked + .switch-slider::before {
  transform: translateX(18px);
}

</style>
