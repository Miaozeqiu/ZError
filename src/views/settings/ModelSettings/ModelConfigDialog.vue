<template>
  <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel model-config-panel" :class="{ 'model-config-panel--compact': !showAdvancedCode }" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('close')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <span class="dialog-title">{{ isEditing ? '编辑模型' : '添加模型' }}</span>
        <button class="btn-confirm" type="button" :disabled="!isFormValid" @click="handleSubmit">
          {{ isEditing ? '完成' : '完成' }}
        </button>
      </div>
      <div class="dialog-body">
        <div class="split-container" :class="{ 'split-container--compact': !showAdvancedCode }">
          <!-- 左侧：JavaScript 配置代码（高亮 + 语法检查，默认收起） -->
          <div class="editor-panel" :class="{ 'editor-panel--collapsed': !showAdvancedCode }">
            <div class="editor-header">JavaScript 配置代码</div>
          <div class="code-editor">
            <div ref="cmContainerRef" class="cm-container"></div>
          </div>
        </div>

          <!-- 右侧：基本信息与操作按钮 -->
          <form class="form-panel" :class="{ 'form-panel--full': !showAdvancedCode }" @submit.prevent="handleSubmit">
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

            <div ref="modelDropdownAnchorRef" class="form-group qa-model-id-group">
              <label class="form-label">模型 ID</label>
              <div class="qa-model-id-row">
                <input
                  ref="modelIdInputRef"
                  v-model="formData.modelId"
                  type="text"
                  class="form-input"
                  placeholder="例如：gpt-4o-mini"
                  @input="handleModelIdInput"
                  @focus="handleModelIdFocus"
                  @click="handleModelIdFocus"
                  @blur="handleModelIdBlur"
                >
              </div>
            </div>
            <Teleport to="body">
              <div
                v-if="showModelDropdown && fetchedModelList.length > 0"
                ref="modelDropdownRef"
                class="qa-dropdown"
                :style="modelDropdownStyle"
                @mousedown.prevent
              >
                <div class="qa-dropdown-list">
                  <template v-if="filteredFetchedModels.length > 0">
                    <div v-for="group in groupedFetchedModels" :key="group.owner" class="qa-dropdown-group">
                      <div class="qa-dropdown-group-title">{{ group.owner }}</div>
                      <div
                        v-for="m in group.models"
                        :key="m.id"
                        class="qa-dropdown-item"
                        @mousedown.prevent="selectFetchedModel(m.id)"
                      >
                        <span class="qa-dropdown-item-id">{{ m.id }}</span>
                      </div>
                    </div>
                  </template>
                  <div v-else class="qa-dropdown-empty">无匹配模型</div>
                </div>
              </div>
            </Teleport>

            <div class="form-group">
              <label class="form-label">API 协议</label>
              <div ref="protocolSelectRef" class="protocol-select-wrap">
                <button
                  type="button"
                  class="protocol-select-trigger"
                  :class="{ open: showProtocolDropdown }"
                  @click="toggleProtocolDropdown"
                >
                  <span class="protocol-select-text">
                    {{ currentProtocolOption.label }} - {{ currentProtocolOption.endpoint }}
                  </span>
                  <span class="protocol-select-arrow" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </button>
              </div>
              <Teleport to="body">
                <div
                  v-if="showProtocolDropdown"
                  ref="protocolDropdownRef"
                  class="protocol-dropdown"
                  :style="protocolDropdownStyle"
                >
                  <button
                    v-for="option in protocolOptions"
                    :key="option.value"
                    type="button"
                    class="protocol-dropdown-item"
                    :class="{ active: formData.apiProtocol === option.value }"
                    @click="selectProtocol(option.value)"
                  >
                    <span class="protocol-dropdown-label">{{ option.label }}</span>
                    <span class="protocol-dropdown-endpoint">{{ option.endpoint }}</span>
                  </button>
                </div>
              </Teleport>
            </div>

            <div v-if="showCategorySelect" class="form-group qa-form-row">
              <label class="form-label">模型类型</label>
              <div class="qa-category-switch">
                <ModelCategorySwitch v-model="formData.category" :show-summary="false" />
              </div>
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

          </form>
        </div>
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
import { type AIModel } from '../../../services/modelConfig'
import { buildPresetProcessModelJsCode, normalizeApiProtocol, readModelIdFromJsCode } from '../../../services/modelProtocol'
import ModelCategorySwitch from './ModelCategorySwitch.vue'

interface Props {
  show: boolean
  model?: AIModel | null
  platformBaseUrl?: string
  platformApiKey?: string
}

interface Emits {
  (e: 'close'): void
  (e: 'save', model: Partial<AIModel>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const protocolOptions = [
  { value: 'openai-chat', label: 'OpenAI Chat', endpoint: '/v1/chat/completions' },
  { value: 'openai-response', label: 'OpenAI Responses', endpoint: '/v1/responses' },
  { value: 'anthropic', label: 'Anthropic', endpoint: '/v1/messages' },
  { value: 'custom', label: '自定义', endpoint: 'jsCode' }
] as const
const protocolSelectRef = ref<HTMLElement | null>(null)
const protocolDropdownRef = ref<HTMLElement | null>(null)
const protocolDropdownStyle = ref<Record<string, string>>({})
const showProtocolDropdown = ref(false)
const modelDropdownAnchorRef = ref<HTMLElement | null>(null)
const modelIdInputRef = ref<HTMLInputElement | null>(null)
const modelDropdownRef = ref<HTMLElement | null>(null)
const modelDropdownStyle = ref<Record<string, string>>({})
const isFetchingModels = ref(false)
const showModelDropdown = ref(false)

type FetchedModelItem = {
  id: string
  name?: string
  ownedBy?: string
}

const fetchedModelList = ref<FetchedModelItem[]>([])

const formData = ref({
  displayName: '',
  category: 'text' as 'text' | 'vision' | 'summary',
  jsCode: '',
  modelId: '',
  enableThinking: false,
  apiProtocol: 'openai-chat' as AIModel['apiProtocol']
})

const isEditing = computed(() => !!props.model)
const showCategorySelect = computed(() => !isEditing.value)
const requiresModelId = computed(() => formData.value.apiProtocol !== 'custom')
const isFormValid = computed(() => {
  if (!formData.value.displayName.trim()) return false
  if (requiresModelId.value && !formData.value.modelId.trim()) return false
  return true
})
const currentProtocolOption = computed(() => {
  return protocolOptions.find(option => option.value === formData.value.apiProtocol) ?? protocolOptions[0]
})
const filteredFetchedModels = computed(() => {
  const q = formData.value.modelId.trim().toLowerCase()
  if (!q) return fetchedModelList.value
  return fetchedModelList.value.filter(m =>
    m.id.toLowerCase().includes(q) ||
    (m.ownedBy || '').toLowerCase().includes(q)
  )
})
const groupedFetchedModels = computed(() => {
  const groups = new Map<string, FetchedModelItem[]>()
  for (const model of filteredFetchedModels.value) {
    const owner = model.ownedBy || '未分类'
    if (!groups.has(owner)) groups.set(owner, [])
    groups.get(owner)!.push(model)
  }
  return Array.from(groups.entries()).map(([owner, models]) => ({ owner, models }))
})

const updateProtocolDropdownPosition = () => {
  if (!protocolSelectRef.value) return
  const triggerRect = protocolSelectRef.value.getBoundingClientRect()
  const dropdownWidth = triggerRect.width
  const estimatedHeight = protocolDropdownRef.value?.getBoundingClientRect().height || 220
  const spaceBelow = window.innerHeight - triggerRect.bottom
  const showAbove = spaceBelow < estimatedHeight + 12 && triggerRect.top > estimatedHeight + 12

  protocolDropdownStyle.value = {
    position: 'fixed',
    left: `${Math.max(8, Math.min(triggerRect.left, window.innerWidth - dropdownWidth - 8))}px`,
    top: showAbove ? `${Math.max(8, triggerRect.top - estimatedHeight - 6)}px` : `${triggerRect.bottom + 6}px`,
    width: `${dropdownWidth}px`,
    zIndex: '2000'
  }
}

const toggleProtocolDropdown = async () => {
  showProtocolDropdown.value = !showProtocolDropdown.value
  if (showProtocolDropdown.value) {
    await nextTick()
    await nextTick()
    updateProtocolDropdownPosition()
  }
}

const selectProtocol = (protocol: AIModel['apiProtocol']) => {
  formData.value.apiProtocol = protocol
  showProtocolDropdown.value = false
}

const handleProtocolOutsideClick = (event: MouseEvent) => {
  const target = event.target as Node | null
  if (
    !target ||
    (
      !protocolSelectRef.value?.contains(target) &&
      !protocolDropdownRef.value?.contains(target)
    )
  ) {
    showProtocolDropdown.value = false
  }
}

const handleProtocolViewportChange = () => {
  if (showProtocolDropdown.value) {
    updateProtocolDropdownPosition()
  }
}

const updateModelDropdownPosition = () => {
  if (!modelDropdownAnchorRef.value) return
  const anchorRect = modelDropdownAnchorRef.value.getBoundingClientRect()
  const dropdownWidth = anchorRect.width
  const estimatedHeight = modelDropdownRef.value?.getBoundingClientRect().height || 260
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const showAbove = spaceBelow < estimatedHeight + 12 && anchorRect.top > estimatedHeight + 12

  modelDropdownStyle.value = {
    position: 'fixed',
    left: `${Math.max(8, Math.min(anchorRect.left, window.innerWidth - dropdownWidth - 8))}px`,
    top: showAbove ? `${Math.max(8, anchorRect.top - estimatedHeight - 6)}px` : `${anchorRect.bottom + 6}px`,
    width: `${dropdownWidth}px`,
    zIndex: '2000'
  }
}

let modelDropdownBlurTimer: ReturnType<typeof setTimeout> | null = null

const clearModelDropdownBlurTimer = () => {
  if (modelDropdownBlurTimer != null) {
    clearTimeout(modelDropdownBlurTimer)
    modelDropdownBlurTimer = null
  }
}

const openModelDropdown = async () => {
  clearModelDropdownBlurTimer()
  showModelDropdown.value = true
  await nextTick()
  await nextTick()
  updateModelDropdownPosition()
}

const closeModelDropdown = () => {
  clearModelDropdownBlurTimer()
  showModelDropdown.value = false
}

const normalizeBaseUrl = (url?: string) => (url || '').trim().replace(/\/+$/, '')

const modelsCacheByBaseUrl = new Map<string, FetchedModelItem[]>()
let fetchModelsGeneration = 0
let tauriFetchPromise: Promise<typeof import('@tauri-apps/plugin-http').fetch> | null = null

const getTauriFetch = () => {
  if (!tauriFetchPromise) {
    tauriFetchPromise = import('@tauri-apps/plugin-http').then(m => m.fetch)
  }
  return tauriFetchPromise
}

const applyFetchedModels = async (models: FetchedModelItem[]) => {
  fetchedModelList.value = models
  if (document.activeElement === modelIdInputRef.value && models.length > 0) {
    await openModelDropdown()
  }
}

const restoreModelsFromCache = () => {
  const baseUrl = normalizeBaseUrl(props.platformBaseUrl)
  const cached = baseUrl ? modelsCacheByBaseUrl.get(baseUrl) : undefined
  fetchedModelList.value = cached ? [...cached] : []
}

const handleModelIdFocus = async () => {
  if (fetchedModelList.value.length > 0) {
    await openModelDropdown()
    return
  }
  // 兜底：若打开弹窗时未拉到列表，聚焦时再触发一次
  if (!isFetchingModels.value) {
    void fetchModels()
  }
}

const handleModelIdBlur = () => {
  clearModelDropdownBlurTimer()
  // 延迟关闭，避免点击下拉项时因 blur 先触发而收起导致点选失效
  modelDropdownBlurTimer = setTimeout(() => {
    modelDropdownBlurTimer = null
    const active = document.activeElement
    if (
      modelIdInputRef.value === active ||
      modelDropdownRef.value?.contains(active)
    ) {
      return
    }
    closeModelDropdown()
  }, 150)
}

const handleModelIdInput = async () => {
  if (fetchedModelList.value.length > 0) {
    await openModelDropdown()
  }
}

const handleModelDropdownOutsideClick = (event: MouseEvent) => {
  const target = event.target as Node | null
  if (
    !target ||
    (
      !modelDropdownAnchorRef.value?.contains(target) &&
      !modelDropdownRef.value?.contains(target)
    )
  ) {
    closeModelDropdown()
  }
}

const handleModelDropdownViewportChange = () => {
  if (showModelDropdown.value) {
    updateModelDropdownPosition()
  }
}

const parseModelsResponse = (data: any): FetchedModelItem[] => {
  if (data?.data && Array.isArray(data.data)) {
    return data.data.map((m: any) => ({
      id: m.id,
      name: m.id,
      ownedBy: m.owned_by || m.ownedBy || m.owner || ''
    }))
  }
  if (Array.isArray(data)) {
    return data.map((m: any) => ({
      id: m.id || m.name,
      name: m.name || m.id,
      ownedBy: m.owned_by || m.ownedBy || m.owner || ''
    }))
  }
  if (data?.models && Array.isArray(data.models)) {
    return data.models.map((m: any) => ({
      id: m.id || m.name,
      name: m.name || m.id,
      ownedBy: m.owned_by || m.ownedBy || m.owner || ''
    }))
  }
  return []
}

const fetchModels = async () => {
  const baseUrl = normalizeBaseUrl(props.platformBaseUrl)
  if (!baseUrl) return

  const cached = modelsCacheByBaseUrl.get(baseUrl)
  if (cached?.length) {
    await applyFetchedModels(cached)
  }

  const generation = ++fetchModelsGeneration
  isFetchingModels.value = true

  try {
    const endpoints = [`${baseUrl}/models`, `${baseUrl}/v1/models`]
    let models: FetchedModelItem[] = []
    let lastErr = ''
    let unauthorized = false
    const tauriFetch = await getTauriFetch()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (props.platformApiKey) headers['Authorization'] = `Bearer ${props.platformApiKey}`

    for (const url of endpoints) {
      try {
        const res = await tauriFetch(url, { method: 'GET', headers })
        if (res.status === 401) { unauthorized = true; lastErr = 'HTTP 401'; continue }
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
        const data = await res.json()
        models = parseModelsResponse(data)
        if (models.length > 0) break
        lastErr = '无法解析响应格式'
      } catch (error: any) {
        lastErr = error?.message || String(error)
      }
    }

    if (generation !== fetchModelsGeneration) return

    if (models.length === 0) {
      console.warn('获取模型列表失败:', unauthorized ? 'HTTP 401' : lastErr)
      return
    }

    const seen = new Set<string>()
    const uniqueModels = models
      .filter(m => {
        if (!m.id || seen.has(m.id)) return false
        seen.add(m.id)
        return true
      })
      .sort((a, b) => {
        const ownerCompare = (a.ownedBy || '未分类').localeCompare(b.ownedBy || '未分类')
        if (ownerCompare !== 0) return ownerCompare
        return a.id.localeCompare(b.id)
      })

    modelsCacheByBaseUrl.set(baseUrl, uniqueModels)
    await applyFetchedModels(uniqueModels)
  } catch (error: any) {
    if (generation === fetchModelsGeneration) {
      console.warn('获取模型列表失败:', error?.message || String(error))
    }
  } finally {
    if (generation === fetchModelsGeneration) {
      isFetchingModels.value = false
    }
  }
}

const selectFetchedModel = (modelId: string) => {
  clearModelDropdownBlurTimer()
  formData.value.modelId = modelId
  if (!formData.value.displayName.trim()) {
    formData.value.displayName = modelId
  }
  closeModelDropdown()
}

const DEFAULT_JS_CODE = buildPresetProcessModelJsCode({ protocol: 'openai-chat', modelId: '' })
const DEFAULT_VISION_JS_CODE = DEFAULT_JS_CODE

const buildCurrentPresetJsCode = () => buildPresetProcessModelJsCode({
  protocol: formData.value.apiProtocol,
  modelId: formData.value.modelId,
  enableThinking: formData.value.enableThinking
})

const syncPresetJsCode = () => {
  if (formData.value.apiProtocol === 'custom') return
  const nextCode = buildCurrentPresetJsCode()
  if (nextCode !== formData.value.jsCode) {
    formData.value.jsCode = nextCode
  }
}

const createDialogFormData = (model?: AIModel | null) => {
  const protocol = normalizeApiProtocol(model?.apiProtocol)
  const modelId = model?.modelId?.trim() || readModelIdFromJsCode(model?.jsCode) || ''
  const category = model?.category || 'text'

  return {
    displayName: model?.displayName || '',
    category,
    jsCode: protocol === 'custom'
      ? (model?.jsCode || (category === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE))
      : buildPresetProcessModelJsCode({ protocol, modelId, enableThinking: deriveEnableThinking(model) }),
    modelId,
    enableThinking: deriveEnableThinking(model),
    apiProtocol: protocol
  }
}

// 监听模型变化，更新表单数据
watch(() => props.model, (newModel) => {
  if (newModel) {
    formData.value = createDialogFormData(newModel)
    // 若编辑器已存在，确保文档与最新模型代码同步
    nextTick(() => {
      if (cmView) {
        setEditorDoc(formData.value.jsCode)
      }
    })
  } else {
    // 重置表单为默认值
    formData.value = createDialogFormData(null)
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
  if (formData.value.apiProtocol !== 'custom') {
    syncPresetJsCode()
    return
  }
  if (!isEditing.value && (!formData.value.jsCode || formData.value.jsCode === DEFAULT_JS_CODE || formData.value.jsCode === DEFAULT_VISION_JS_CODE)) {
    formData.value.jsCode = newCategory === 'vision' ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE;
    nextTick(() => {
      if (cmView) {
        setEditorDoc(formData.value.jsCode);
      }
    })
  }
});

// ===== 思考开关与 jsCode 中 enable_thinking 字面量双向同步 =====

// 读取 jsCode 里 enable_thinking 的布尔字面量；不存在则返回 null
function readEnableThinkingFromJsCode(code: string | undefined | null): boolean | null {
  if (!code) return null
  const m = code.match(/enable_thinking\s*:\s*(true|false)\b/)
  return m ? m[1] === 'true' : null
}

// 将 jsCode 中 enable_thinking 字面量改写为目标值；不存在则原样返回
// （不向不支持该参数的模板注入，避免污染 OpenAI 等协议的请求体）
const applyEnableThinkingToJsCode = (code: string, enabled: boolean): string => {
  if (!code) return code
  return code.replace(/enable_thinking\s*:\s*(true|false)\b/, `enable_thinking: ${enabled}`)
}

// 加载模型时推导开关初始状态：优先以 jsCode 里的字面量为准，其次回退到存储字段
function deriveEnableThinking(model: AIModel | null | undefined): boolean {
  const fromCode = readEnableThinkingFromJsCode(model?.jsCode)
  if (fromCode !== null) return fromCode
  return model?.enableThinking === true
}

// 开关变化 → 改写 jsCode 中 enable_thinking 字面量（仅当其已存在时）
watch(() => formData.value.enableThinking, (enabled) => {
  if (formData.value.apiProtocol !== 'custom') {
    syncPresetJsCode()
    return
  }
  if (readEnableThinkingFromJsCode(formData.value.jsCode) === null) return
  const updated = applyEnableThinkingToJsCode(formData.value.jsCode, enabled)
  if (updated !== formData.value.jsCode) {
    formData.value.jsCode = updated
    nextTick(() => { if (cmView) setEditorDoc(updated) })
  }
})

// jsCode 变化（用户在编辑器中手改）→ 回写开关
watch(() => formData.value.jsCode, (code) => {
  const inCode = readEnableThinkingFromJsCode(code)
  if (inCode === null) return
  if (formData.value.enableThinking !== inCode) {
    formData.value.enableThinking = inCode
  }
})

// ===== 模型 ID 与 jsCode 中 model 字面量双向同步 =====

// 仅当协议为“自定义”时显示 JavaScript 编辑器
const showAdvancedCode = computed(() => formData.value.apiProtocol === 'custom')

// 将模型 ID 写入 jsCode：已有 model 字面量则替换其值（保留原引号风格）；
// 默认模板无 model 字面量时，在 `...context.request,` 之后注入；都不命中则原样返回
const applyModelIdToJsCode = (code: string, id: string): string => {
  if (!code) return code
  const trimmed = id.trim()
  if (/model\s*:\s*(['"`])[^'"`\n]*?\1/.test(code)) {
    return code.replace(/(model\s*:\s*)(['"`])([^'"`\n]*?)\2/, (_m, p1: string, q: string) => `${p1}${q}${trimmed}${q}`)
  }
  if (!trimmed) return code
  if (/...\s*context\.request\s*,/.test(code)) {
    return code.replace(/(...\s*context\.request\s*,)/, `$1\n    model: '${trimmed}',`)
  }
  return code
}

// 加载模型时推导模型 ID：以 jsCode 里 model 字面量为准，无则空串
// 模型 ID 变化 → 同步写入 jsCode
watch(() => formData.value.modelId, (id) => {
  if (formData.value.apiProtocol !== 'custom') {
    syncPresetJsCode()
    return
  }
  if (!id) return
  const updated = applyModelIdToJsCode(formData.value.jsCode, id)
  if (updated !== formData.value.jsCode) {
    formData.value.jsCode = updated
    nextTick(() => { if (cmView) setEditorDoc(updated) })
  }
})

// jsCode 变化 → 回写模型 ID（与上面的 enableThinking 回写共用同一 jsCode 源）
watch(() => formData.value.jsCode, (code) => {
  const inCode = readModelIdFromJsCode(code)
  if (inCode === null) return
  if (formData.value.modelId !== inCode) {
    formData.value.modelId = inCode
  }
})

// 自定义协议显示编辑器时（重新）初始化编辑器，确保在可见容器中正确测量尺寸
watch(showAdvancedCode, async (visible) => {
  if (!visible) return
  await nextTick()
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
  await rebuildEditorWithDoc(formData.value.jsCode)
})

// 监听弹窗显示状态，打开时初始化，关闭时销毁以避免视图挂载丢失
watch(() => props.show, async (visible) => {
  showProtocolDropdown.value = false
  showModelDropdown.value = false
  if (visible) {
    // 弹窗一打开就预拉 /models，避免聚焦输入框时再等网络
    restoreModelsFromCache()
    void fetchModels()

    await nextTick()
    formData.value = createDialogFormData(props.model)

    // 仅在自定义协议下初始化编辑器，避免在隐藏容器中测量尺寸异常
    if (showAdvancedCode.value) {
      await rebuildEditorWithDoc(formData.value.jsCode)
    }
  } else {
    fetchModelsGeneration += 1
    isFetchingModels.value = false
    fetchedModelList.value = []
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
  document.addEventListener('click', handleProtocolOutsideClick)
  document.addEventListener('click', handleModelDropdownOutsideClick)
  window.addEventListener('resize', handleProtocolViewportChange)
  window.addEventListener('resize', handleModelDropdownViewportChange)
  window.addEventListener('scroll', handleProtocolViewportChange, true)
  window.addEventListener('scroll', handleModelDropdownViewportChange, true)
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
  clearModelDropdownBlurTimer()
  document.removeEventListener('click', handleProtocolOutsideClick)
  document.removeEventListener('click', handleModelDropdownOutsideClick)
  window.removeEventListener('resize', handleProtocolViewportChange)
  window.removeEventListener('resize', handleModelDropdownViewportChange)
  window.removeEventListener('scroll', handleProtocolViewportChange, true)
  window.removeEventListener('scroll', handleModelDropdownViewportChange, true)
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

const handleSubmit = () => {
  if (!formData.value.displayName.trim()) {
    alert('请输入模型名称')
    return
  }
  if (requiresModelId.value && !formData.value.modelId.trim()) {
    alert('请输入模型 ID')
    return
  }

  const modelData: Partial<AIModel> = {
    displayName: formData.value.displayName.trim(),
    category: formData.value.category,
    modelId: formData.value.modelId.trim(),
    jsCode: formData.value.apiProtocol === 'custom' ? formData.value.jsCode : buildCurrentPresetJsCode(),
    enableThinking: formData.value.enableThinking,
    apiProtocol: formData.value.apiProtocol
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
.model-config-panel {
  width: 92vw;           /* 随主窗口变化的宽度 */
  max-width: 1400px;     /* 合理的最大宽度限制 */      /* 随主窗口变化的高度 */
  display: flex;
  flex-direction: column;
  transition: max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 隐藏 JavaScript 代码时收窄弹窗，避免表单两侧留大块空白 */
.model-config-panel--compact {
  max-width: 580px;
}

.model-config-panel > .dialog-body {
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
  transition: gap 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 编辑器收起时去掉间距，让表单居中无偏移 */
.split-container--compact {
  gap: 0;
}

.editor-panel {
  flex: 1 1 auto;         /* 占据除右侧表单外的剩余宽度 */
  display: flex;
  flex-direction: column;
  min-height: 0;          /* 让编辑器按高度自适应 */
  min-width: 0;           /* 允许内容在窄屏时收缩 */
  max-height: none;
  max-width: 100%;        /* 展开时不超出容器 */
  overflow: hidden;       /* 收起过程中裁剪内部编辑器 */
  opacity: 1;
  transition: max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              max-height 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              opacity 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 收起：宽度归零 + 淡出，配合 overflow:hidden 实现平滑过渡 */
.editor-panel--collapsed {
  flex: 0 0 0;
  max-width: 0;
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}

.form-panel {
  flex: 0 0 360px;        /* 固定宽度 */
  max-width: 380px;       /* 限制最大宽度以防样式抖动 */
  transition: flex-basis 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 编辑器收起时，表单占满可用宽度并居中，避免左侧留大块空白 */
.form-panel--full {
  flex: 0 0 520px;        /* 用具体 flex-basis 以便过渡动画 */
  max-width: 520px;
  margin: 0 auto;
}

.form-hint code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-primary, #2d3748);
  padding: 1px 5px;
  border-radius: 4px;
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

.qa-model-id-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.qa-model-id-row .form-input {
  flex: 1;
}

.qa-dropdown {
  position: fixed;
  box-sizing: border-box;
  border: 1px solid var(--platform-config-form-input-border, #e2e8f0);
  border-radius: 10px;
  background: var(--form-input-bg, #F7F7F7);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px;
}

.qa-dropdown-list {
  flex: 1;
  overflow-y: auto;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qa-dropdown-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qa-dropdown-group-title {
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.qa-dropdown-item {
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  transition: background-color 0.2s ease;
}

.qa-dropdown-item:hover {
  background: var(--form-input-hover-bg, #f0f0f0);
}

.qa-dropdown-item-id {
  display: block;
  line-height: 1.4;
}

.qa-dropdown-empty {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.qa-form-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.qa-form-row .form-label {
  margin-bottom: 0;
}

.qa-category-switch {
  flex: 1;
  display: flex;
  justify-content: flex-end;
}


.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.protocol-select-wrap {
  position: relative;
}

.protocol-select-trigger {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  padding-right: 40px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--form-input-bg, #F7F7F7);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.protocol-select-trigger:hover,
.protocol-select-trigger.open {
  border-color: var(--form-input-hover-border, transparent);
  background: var(--form-input-hover-bg, #f0f0f0);
}

.protocol-select-trigger:focus {
  outline: none;
  border-color: var(--form-input-focus-border, #3182ce);
}

.protocol-select-text {
  display: block;
  width: 100%;
  padding-right: 8px;
  line-height: 1.5;
}

.protocol-select-arrow {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #718096);
  pointer-events: none;
  transition: transform 0.2s ease;
}

.protocol-select-trigger.open .protocol-select-arrow {
  transform: translateY(-50%) rotate(180deg);
}

.protocol-dropdown {
  position: fixed;
  box-sizing: border-box;
  max-height: min(320px, calc(100vh - 16px));
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--platform-config-form-input-border, #e2e8f0);
  border-radius: 10px;
  background: var(--form-input-bg, #F7F7F7);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
}

.protocol-dropdown-item {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  outline: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: background-color 0.2s ease, color 0.15s ease;
}

.protocol-dropdown-item:focus,
.protocol-dropdown-item:focus-visible,
.protocol-dropdown-item:active {
  outline: none;
  border: none;
  box-shadow: none;
}

.protocol-dropdown-item:hover,
.protocol-dropdown-item.active:hover {
  background: var(--form-input-hover-bg, #f0f0f0);
}

.protocol-dropdown-item.active {
  background: transparent;
  color: var(--text-primary);
}

.protocol-dropdown-label {
  font-weight: 500;
}

.protocol-dropdown-endpoint {
  color: var(--text-secondary, #718096);
  font-size: 11px;
  flex-shrink: 0;
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
