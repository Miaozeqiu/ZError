import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { linter, lintGutter } from '@codemirror/lint'
import * as acorn from 'acorn'
import { modelHasVision, type AIModel, type ThinkingEffort, type ThinkingOffResponsesEffort } from '../../../services/model/config'
import { buildPresetProcessModelJsCode, normalizeApiProtocol, readModelIdFromJsCode, resolveExecutableModelJsCode } from '../../../services/model/protocol'
import { useExclusiveMenu } from '../../../composables/useExclusiveMenu'

export interface Props {
  show: boolean
  model?: AIModel | null
  platformBaseUrl?: string
  platformApiKey?: string
  platformApiProtocol?: AIModel['apiProtocol']
}
export interface Emits {
  (e: 'close'): void
  (e: 'save', model: Partial<AIModel>): void
  (e: 'afterLeave'): void
}

export function useModelConfigDialog(props: Props, emit: Emits) {

  const thinkingEffortOptions: { value: ThinkingEffort; label: string }[] = [
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'max', label: 'max' },
  ]

  type EffortMatrixPulse = {
    c: number
    r: number
    peak: number
    steps: number
    fadeRate: number
    maxSteps: number
    skipChance: number
    stepEvery: number
    stepAcc: number
  }

  let effortMatrixRaf = 0
  let effortMatrixStop: (() => void) | null = null
  let effortMatrixIo: IntersectionObserver | null = null
  let effortMatrixRo: ResizeObserver | null = null

  const stopEffortMatrixFx = () => {
    effortMatrixStop?.()
    effortMatrixStop = null
    if (effortMatrixRaf) {
      cancelAnimationFrame(effortMatrixRaf)
      effortMatrixRaf = 0
    }
    effortMatrixIo?.disconnect()
    effortMatrixRo?.disconnect()
    effortMatrixIo = null
    effortMatrixRo = null
  }

  const startEffortMatrixFx = (canvas: HTMLCanvasElement) => {
    stopEffortMatrixFx()
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const CELL = 4
    const GAP = 1
    const STEP = CELL + GAP
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let offsetX = 0
    let offsetY = 0
    let visible = true
    let running = true
    let last = performance.now()
    let bright = new Float32Array(0)
    const pulses: EffortMatrixPulse[] = []
    let spawnWait = 0

    const idx = (c: number, r: number) => r * cols + c

    const rebuild = () => {
      const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 0
      const cssH = canvas.clientHeight || canvas.parentElement?.clientHeight || 0
      if (cssW < 2 || cssH < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = cssW
      height = cssH
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.max(1, Math.floor((width + GAP) / STEP))
      rows = Math.max(1, Math.floor((height + GAP) / STEP))
      offsetX = (width - (cols * STEP - GAP)) / 2
      offsetY = (height - (rows * STEP - GAP)) / 2
      bright = new Float32Array(cols * rows)
      pulses.length = 0
    }

    const draw = (now: number) => {
      if (!running) return
      effortMatrixRaf = requestAnimationFrame(draw)
      if (!visible || document.hidden) {
        last = now
        return
      }
      if (width < 2) rebuild()
      if (width < 2) return

      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      if (!reduceMotion) {
        spawnWait -= dt
        while (spawnWait <= 0) {
          const r = (Math.random() * rows) | 0
          pulses.push({
            c: cols - 1,
            r,
            peak: 0.95 + Math.random() * 0.4,
            steps: 0,
            fadeRate: 0.7 + Math.random() * 0.9,
            maxSteps: Math.floor(cols * (0.45 + Math.random() * 0.6)),
            skipChance: Math.random() * 0.18,
            stepEvery: 0.05 + Math.random() * 0.05,
            stepAcc: 0
          })
          const bi = idx(cols - 1, r)
          bright[bi] = Math.max(bright[bi], 1.2)
          spawnWait += 0.012 + Math.random() * 0.02
        }

        for (let p = pulses.length - 1; p >= 0; p--) {
          const pulse = pulses[p]
          pulse.stepAcc += dt
          while (pulse.stepAcc >= pulse.stepEvery) {
            pulse.stepAcc -= pulse.stepEvery
            if (Math.random() < pulse.skipChance) {
              pulse.c -= 1
              pulse.steps += 1
            }
            pulse.c -= 1
            pulse.steps += 1
            if (pulse.c < 0 || pulse.steps >= pulse.maxSteps) {
              pulses.splice(p, 1)
              break
            }
            const fade = Math.max(0, 1 - (pulse.steps / pulse.maxSteps) * pulse.fadeRate)
            const endJitter = pulse.steps > pulse.maxSteps * 0.55
              ? 0.5 + Math.random() * 0.5
              : 0.85 + Math.random() * 0.2
            const g = pulse.peak * fade * endJitter
            if (g < 0.08 && Math.random() < 0.45) {
              pulses.splice(p, 1)
              break
            }
            const bi = idx(pulse.c, pulse.r)
            bright[bi] = Math.max(bright[bi], g)
          }
        }
      }

      for (let i = 0; i < bright.length; i++) {
        const decay = 0.1 + (i % 7) * 0.012 + Math.random() * 0.08
        bright[i] *= Math.pow(decay, dt)
        if (bright[i] < 0.01) bright[i] = 0
      }

      ctx.clearRect(0, 0, width, height)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const g = bright[idx(c, r)]
          if (g < 0.04) continue
          const x = offsetX + c * STEP
          const y = offsetY + r * STEP
          if (g > 0.35) {
            ctx.globalAlpha = Math.min(0.9, (g - 0.25) * 0.85)
            ctx.fillStyle = '#ffd56a'
            ctx.fillRect(x - 0.5, y - 0.5, CELL + 1, CELL + 1)
          }
          ctx.globalAlpha = Math.min(1, g)
          ctx.fillStyle = g > 0.75 ? '#ffffff' : '#fff3cc'
          ctx.fillRect(x, y, CELL, CELL)
        }
      }
      ctx.globalAlpha = 1
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting
      if (visible) last = performance.now()
    }, { threshold: 0 })
    io.observe(canvas)
    const ro = new ResizeObserver(() => rebuild())
    ro.observe(canvas.parentElement || canvas)

    rebuild()
    effortMatrixIo = io
    effortMatrixRo = ro
    effortMatrixStop = () => { running = false }
    effortMatrixRaf = requestAnimationFrame(draw)
  }

  const bindEffortMatrix = (el: Element | null) => {
    if (el instanceof HTMLCanvasElement) startEffortMatrixFx(el)
    else stopEffortMatrixFx()
  }

  const modelDropdownAnchorRef = ref<HTMLElement | null>(null)
  const modelIdInputRef = ref<HTMLInputElement | null>(null)
  const modelDropdownRef = ref<HTMLElement | null>(null)
  const modelDropdownStyle = ref<Record<string, string>>({})
  const isFetchingModels = ref(false)
  const showModelDropdown = ref(false)
  useExclusiveMenu('model-config-model-dropdown', showModelDropdown)

  type FetchedModelItem = {
    id: string
    name?: string
    ownedBy?: string
  }

  const fetchedModelList = ref<FetchedModelItem[]>([])

  const formData = ref({
    displayName: '',
    hasVision: false,
    jsCode: '',
    modelId: '',
    enableThinking: false,
    thinkingOffEnableThinkingFalse: true,
    thinkingOffThinkingTypeDisabled: false,
    thinkingOffResponsesEffort: 'minimal' as ThinkingOffResponsesEffort,
    thinkingEffort: 'medium' as ThinkingEffort,
    apiProtocol: 'openai-chat' as AIModel['apiProtocol']
  })

  const isEditing = computed(() => !!props.model)
  const isRemote = computed(() => !!props.model?.isRemote)
  const effortMaxIndex = thinkingEffortOptions.length - 1
  const EFFORT_THUMB_PX = 28
  const effortBarRef = ref<HTMLElement | null>(null)
  const effortSlide = ref(1)
  const isDraggingEffort = ref(false)
  const effortIndex = computed(() => {
    const index = thinkingEffortOptions.findIndex(opt => opt.value === formData.value.thinkingEffort)
    return index >= 0 ? index : 1
  })
  const isMaxEffort = computed(() => !isDraggingEffort.value && formData.value.thinkingEffort === 'max')
  const effortThumbOffset = (t: number) => {
    const clamped = Math.min(1, Math.max(0, t))
    return `calc(${clamped} * (100% - ${EFFORT_THUMB_PX}px) + ${EFFORT_THUMB_PX / 2}px)`
  }
  const effortFillWidth = computed(() => {
    const t = Math.min(1, Math.max(0, effortSlide.value / effortMaxIndex))
    return `calc(${t} * (100% - ${EFFORT_THUMB_PX}px) + ${EFFORT_THUMB_PX}px)`
  })
  const effortStopLeft = (index: number) => effortThumbOffset(index / effortMaxIndex)
  const effortThumbLeft = computed(() => effortThumbOffset(effortSlide.value / effortMaxIndex))
  const snapEffortValue = (raw: number) => {
    const index = Math.min(effortMaxIndex, Math.max(0, Math.round(raw)))
    effortSlide.value = index
    const next = thinkingEffortOptions[index]
    if (next) formData.value.thinkingEffort = next.value
  }
  const applyEffortMagnet = (raw: number) => {
    const magnets = [1, 2]
    const radius = 0.42
    let nearest = -1
    let nearestDist = radius
    for (const stop of magnets) {
      const dist = Math.abs(raw - stop)
      if (dist < nearestDist) {
        nearest = stop
        nearestDist = dist
      }
    }
    if (nearest < 0) return raw
    const u = (raw - nearest) / radius
    const sticky = Math.sign(u) * (Math.abs(u) ** 2.4)
    return nearest + sticky * radius
  }
  const slideEffortFromClientX = (clientX: number) => {
    const bar = effortBarRef.value
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const usable = Math.max(1, rect.width - EFFORT_THUMB_PX)
    const t = (clientX - rect.left - EFFORT_THUMB_PX / 2) / usable
    const linear = Math.min(effortMaxIndex, Math.max(0, t * effortMaxIndex))
    effortSlide.value = applyEffortMagnet(linear)
  }
  const suppressEffortSelectStart = (event: Event) => {
    event.preventDefault()
  }
  const lockEffortTextSelect = (locked: boolean) => {
    const root = document.documentElement
    root.style.userSelect = locked ? 'none' : ''
    root.style.webkitUserSelect = locked ? 'none' : ''
    if (locked) {
      window.getSelection()?.removeAllRanges()
      document.addEventListener('selectstart', suppressEffortSelectStart, true)
    } else {
      document.removeEventListener('selectstart', suppressEffortSelectStart, true)
    }
  }
  const onEffortPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    isDraggingEffort.value = true
    lockEffortTextSelect(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    slideEffortFromClientX(event.clientX)
  }
  const onEffortPointerMove = (event: PointerEvent) => {
    if (!isDraggingEffort.value) return
    event.preventDefault()
    slideEffortFromClientX(event.clientX)
  }
  const onEffortPointerUp = () => {
    if (!isDraggingEffort.value) return
    snapEffortValue(effortSlide.value)
    isDraggingEffort.value = false
    lockEffortTextSelect(false)
  }
  const onEffortKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      snapEffortValue(effortIndex.value - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      snapEffortValue(effortIndex.value + 1)
    }
  }
  watch(() => formData.value.thinkingEffort, () => {
    if (isDraggingEffort.value) return
    effortSlide.value = effortIndex.value
  }, { immediate: true })
  const dialogTitle = computed(() => {
    if (isRemote.value) return '查看模型'
    return isEditing.value ? '编辑模型' : '添加模型'
  })
  const requiresModelId = computed(() => formData.value.apiProtocol !== 'custom')
  const isChatProtocol = computed(() => formData.value.apiProtocol === 'openai-chat' || formData.value.apiProtocol === 'custom')
  const isResponsesProtocol = computed(() => formData.value.apiProtocol === 'openai-response')
  const isMessagesProtocol = computed(() => formData.value.apiProtocol === 'anthropic')
  const isFormValid = computed(() => {
    if (!formData.value.displayName.trim()) return false
    if (requiresModelId.value && !formData.value.modelId.trim()) return false
    return true
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
      tauriFetchPromise = import('../../../services/security/secureFetch').then(m => m.secureFetch)
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
    if (isRemote.value) return
    if (fetchedModelList.value.length > 0) {
      await openModelDropdown()
      return
    }
    // 兜底：若打开弹窗时未拉到列表，聚焦时再触发一次
    if (!isFetchingModels.value) {
      void fetchModels()
    }
  }

  const toggleModelDropdown = async () => {
    if (isRemote.value) return
    if (fetchedModelList.value.length === 0) {
      if (!isFetchingModels.value) void fetchModels()
      return
    }
    if (showModelDropdown.value) {
      closeModelDropdown()
      return
    }
    await openModelDropdown()
    modelIdInputRef.value?.focus()
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

  const handleModelDropdownOutsideClick = (event: Event) => {
    if (!showModelDropdown.value) return
    const target = event.target as Node | null
    if (
      target &&
      (
        modelDropdownAnchorRef.value?.contains(target) ||
        modelDropdownRef.value?.contains(target)
      )
    ) {
      return
    }
    closeModelDropdown()
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

  const thinkingPresetOptions = () => ({
    enableThinking: formData.value.enableThinking,
    thinkingOffEnableThinkingFalse: formData.value.thinkingOffEnableThinkingFalse,
    thinkingOffThinkingTypeDisabled: formData.value.thinkingOffThinkingTypeDisabled,
    thinkingOffResponsesEffort: formData.value.thinkingOffResponsesEffort,
    thinkingEffort: formData.value.thinkingEffort,
  })

  const buildCurrentPresetJsCode = () => buildPresetProcessModelJsCode({
    protocol: formData.value.apiProtocol,
    modelId: formData.value.modelId,
    ...thinkingPresetOptions()
  })

  const syncPresetJsCode = () => {
    if (formData.value.apiProtocol === 'custom') return
    const nextCode = buildCurrentPresetJsCode()
    if (nextCode !== formData.value.jsCode) {
      formData.value.jsCode = nextCode
    }
  }

  const EFFORT_VALUES: ThinkingEffort[] = ['low', 'medium', 'high', 'max']
  const normalizeEffort = (effort?: AIModel['thinkingEffort']): ThinkingEffort =>
    effort && EFFORT_VALUES.includes(effort) ? effort : 'medium'

  const normalizeOffResponsesEffort = (
    model?: AIModel | null
  ): ThinkingOffResponsesEffort => {
    if (model?.thinkingOffResponsesEffort === 'none' || model?.thinkingOffResponsesEffort === 'minimal') {
      return model.thinkingOffResponsesEffort
    }
    return 'minimal'
  }

  const createDialogFormData = (model?: AIModel | null) => {
    const protocol = normalizeApiProtocol(props.platformApiProtocol || model?.apiProtocol)
    // 统一展示 modelId（服务端/同步保证有值；缺省用目录 id）
    const modelId = model?.modelId?.trim() || model?.id || readModelIdFromJsCode(model?.jsCode) || ''
    const hasVision = modelHasVision(model)
    const enableThinking = deriveEnableThinking(model)
    const thinkingOffEnableThinkingFalse = model?.thinkingOffEnableThinkingFalse !== false
    const thinkingOffThinkingTypeDisabled = model?.thinkingOffThinkingTypeDisabled === true
    const thinkingOffResponsesEffort = normalizeOffResponsesEffort(model)
    const thinkingEffort = normalizeEffort(model?.thinkingEffort)

    return {
      displayName: model?.displayName || '',
      hasVision,
      jsCode: protocol === 'custom'
        ? (model?.jsCode || (hasVision ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE))
        : buildPresetProcessModelJsCode({
          protocol,
          modelId,
          enableThinking,
          thinkingOffEnableThinkingFalse,
          thinkingOffThinkingTypeDisabled,
          thinkingOffResponsesEffort,
          thinkingEffort,
        }),
      modelId,
      enableThinking,
      thinkingOffEnableThinkingFalse,
      thinkingOffThinkingTypeDisabled,
      thinkingOffResponsesEffort,
      thinkingEffort,
      apiProtocol: protocol
    }
  }

  // 监听模型变化，更新表单数据
  watch(() => props.platformApiProtocol, (protocol) => {
    if (!props.show) return
    formData.value.apiProtocol = normalizeApiProtocol(protocol || props.model?.apiProtocol)
    if (formData.value.apiProtocol !== 'custom') syncPresetJsCode()
  })

  watch(() => props.model, (newModel) => {
    if (!props.show) return
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

  // 监听视觉能力切换自动替换模板
  watch(() => formData.value.hasVision, (hasVision) => {
    if (formData.value.apiProtocol !== 'custom') {
      syncPresetJsCode()
      return
    }
    if (!isEditing.value && (!formData.value.jsCode || formData.value.jsCode === DEFAULT_JS_CODE || formData.value.jsCode === DEFAULT_VISION_JS_CODE)) {
      formData.value.jsCode = hasVision ? DEFAULT_VISION_JS_CODE : DEFAULT_JS_CODE;
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

  // 开关 / 关闭参数 / 强度变化 → 同步预设协议代码
  watch(
    () => [
      formData.value.enableThinking,
      formData.value.thinkingOffEnableThinkingFalse,
      formData.value.thinkingOffThinkingTypeDisabled,
      formData.value.thinkingOffResponsesEffort,
      formData.value.thinkingEffort,
      formData.value.apiProtocol,
    ],
    () => {
      if (formData.value.apiProtocol !== 'custom') {
        syncPresetJsCode()
        return
      }
      if (readEnableThinkingFromJsCode(formData.value.jsCode) === null) return
      const updated = applyEnableThinkingToJsCode(formData.value.jsCode, formData.value.enableThinking)
      if (updated !== formData.value.jsCode) {
        formData.value.jsCode = updated
        nextTick(() => { if (cmView) setEditorDoc(updated) })
      }
    }
  )

  // 刚开启思考时，若强度非法则落到默认 medium
  watch(() => formData.value.enableThinking, (enabled, wasEnabled) => {
    if (enabled && !wasEnabled) {
      formData.value.thinkingEffort = normalizeEffort(formData.value.thinkingEffort) || 'medium'
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

  watch(
    () => [formData.value.modelId, formData.value.apiProtocol, props.platformBaseUrl],
    () => {
      if (isTestingModel.value) return
      modelTestStatus.value = 'idle'
      modelTestMessage.value = ''
      modelTestElapsedMs.value = null
    }
  )

  // 监听弹窗显示状态，打开时初始化，关闭时销毁以避免视图挂载丢失
  watch(() => props.show, async (visible) => {
    showModelDropdown.value = false
    resetModelTestState()
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
    }
  })

  const onDialogAfterLeave = () => {
    if (props.show) return
    if (cmView) {
      cmView.destroy()
      cmView = null
    }
    emit('afterLeave')
  }

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
    // 捕获阶段监听，确保点外部时可靠关闭（含 Teleport 到 body 的菜单）
    document.addEventListener('mousedown', handleModelDropdownOutsideClick, true)
    window.addEventListener('resize', handleModelDropdownViewportChange)
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
    stopEffortMatrixFx()
    lockEffortTextSelect(false)
    resetModelTestState()
    clearModelDropdownBlurTimer()
    document.removeEventListener('mousedown', handleModelDropdownOutsideClick, true)
    window.removeEventListener('resize', handleModelDropdownViewportChange)
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

  const handlePrimaryAction = () => {
    handleSubmit()
  }

  const handleSubmit = () => {
    if (!formData.value.displayName.trim()) {
      alert('请输入显示名')
      return
    }
    if (requiresModelId.value && !formData.value.modelId.trim()) {
      alert('请输入模型 ID')
      return
    }

    const modelData: Partial<AIModel> = {
      displayName: formData.value.displayName.trim(),
      category: 'text',
      hasVision: formData.value.hasVision,
      modelId: formData.value.modelId.trim(),
      jsCode: formData.value.apiProtocol === 'custom' ? formData.value.jsCode : buildCurrentPresetJsCode(),
      enableThinking: formData.value.enableThinking,
      thinkingOffEnableThinkingFalse: formData.value.thinkingOffEnableThinkingFalse,
      thinkingOffResponsesEffort: formData.value.thinkingOffResponsesEffort,
      thinkingOffThinkingTypeDisabled: formData.value.thinkingOffThinkingTypeDisabled,
      thinkingEffort: formData.value.thinkingEffort,
      apiProtocol: formData.value.apiProtocol
    }

    // 如果是编辑模式，保留原有的id
    if (isEditing.value && props.model) {
      modelData.id = props.model.id
    }

    emit('save', modelData)
  }

  const isTestingModel = ref(false)
  const modelTestStatus = ref<'idle' | 'success' | 'error'>('idle')
  const modelTestMessage = ref('')
  const modelTestElapsedMs = ref<number | null>(null)
  let modelTestAbort: AbortController | null = null

  const canTestModel = computed(() => {
    if (!normalizeBaseUrl(props.platformBaseUrl)) return false
    if (requiresModelId.value && !formData.value.modelId.trim()) return false
    if (formData.value.apiProtocol === 'custom' && !formData.value.jsCode.trim()) return false
    return true
  })

  const modelTestCardClass = computed(() => ({
    testing: isTestingModel.value,
    success: !isTestingModel.value && modelTestStatus.value === 'success',
    error: !isTestingModel.value && modelTestStatus.value === 'error'
  }))

  const modelTestTitle = computed(() => {
    if (isTestingModel.value) return '测试中'
    if (modelTestStatus.value === 'success') return '可用'
    if (modelTestStatus.value === 'error') return '不可用'
    return '测试'
  })

  const modelTestTooltip = computed(() => {
    if (isTestingModel.value) return '正在请求模型'
    if (modelTestStatus.value === 'error') return modelTestMessage.value || '不可用'
    if (modelTestStatus.value === 'success') {
      return modelTestMeta.value ? `可用 · ${modelTestMeta.value}` : '可用'
    }
    if (!canTestModel.value) {
      if (!normalizeBaseUrl(props.platformBaseUrl)) return '当前平台未配置接口地址'
      if (requiresModelId.value && !formData.value.modelId.trim()) return '填写模型 ID 后即可测试'
    }
    return '测试可用性'
  })

  const modelTestMeta = computed(() => {
    if (isTestingModel.value || modelTestElapsedMs.value == null) return ''
    const ms = modelTestElapsedMs.value
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
  })

  const resetModelTestState = () => {
    if (modelTestAbort) {
      modelTestAbort.abort()
      modelTestAbort = null
    }
    isTestingModel.value = false
    modelTestStatus.value = 'idle'
    modelTestMessage.value = ''
    modelTestElapsedMs.value = null
  }

  const isAbortError = (error: unknown) => {
    const name = (error as { name?: string } | null)?.name
    const message = String((error as Error)?.message || error || '')
    return name === 'AbortError' || /abort/i.test(message)
  }

  const collectProcessModelOutput = async (result: any): Promise<{ content: string; reasoning: string }> => {
    let content = ''
    let reasoning = ''

    if (!result) return { content, reasoning }

    if (result[Symbol.asyncIterator]) {
      for await (const chunk of result) {
        if (typeof chunk?.content === 'string') content += chunk.content
        if (typeof chunk?.reasoning_content === 'string') reasoning += chunk.reasoning_content
      }
      return { content, reasoning }
    }

    if (typeof result === 'string') {
      return { content: result, reasoning }
    }

    if (typeof result === 'object') {
      content = String(result.content ?? result.response ?? '')
      reasoning = String(result.reasoning_content ?? '')
    }

    return { content, reasoning }
  }

  const testModelAvailability = async () => {
    if (isTestingModel.value || !canTestModel.value) return

    const runtimeModelId = formData.value.modelId.trim()
    const executableCode = resolveExecutableModelJsCode({
      apiProtocol: formData.value.apiProtocol,
      jsCode: formData.value.jsCode,
      modelId: runtimeModelId,
      enableThinking: formData.value.enableThinking,
      thinkingOffEnableThinkingFalse: formData.value.thinkingOffEnableThinkingFalse,
      thinkingOffThinkingTypeDisabled: formData.value.thinkingOffThinkingTypeDisabled,
      thinkingOffResponsesEffort: formData.value.thinkingOffResponsesEffort,
      thinkingEffort: formData.value.thinkingEffort
    })

    if (!executableCode) {
      modelTestStatus.value = 'error'
      modelTestMessage.value = '当前配置没有可执行的请求代码'
      return
    }

    if (modelTestAbort) modelTestAbort.abort()
    modelTestAbort = new AbortController()
    const abortSignal = modelTestAbort.signal

    isTestingModel.value = true
    modelTestStatus.value = 'idle'
    modelTestMessage.value = ''
    modelTestElapsedMs.value = null
    const startedAt = performance.now()

    try {
      const tauriFetch = await getTauriFetch()
      const fetchWithSignal = (input: RequestInfo | URL, init: RequestInit = {}) => {
        return tauriFetch(input as any, {
          ...init,
          credentials: init.credentials ?? 'include',
          signal: init.signal ?? abortSignal
        } as any)
      }
      const testInput = {
        messages: [{ role: 'user', content: 'ping' }],
        model: runtimeModelId,
        stream: true
      }
      const config = {
        apiKey: props.platformApiKey,
        baseUrl: normalizeBaseUrl(props.platformBaseUrl),
        model: runtimeModelId,
        modelId: runtimeModelId
      }

      const processModel = new Function('input', 'config', 'fetch', 'abortSignal', `
        ${executableCode}
        return processModel;
      `)(testInput, config, fetchWithSignal, abortSignal)

      const result = await processModel(testInput, config, fetchWithSignal, abortSignal)
      const { content, reasoning } = await collectProcessModelOutput(result)
      const elapsed = Math.round(performance.now() - startedAt)

      if (abortSignal.aborted) return

      modelTestElapsedMs.value = elapsed

      if (!content.trim() && !reasoning.trim()) {
        modelTestStatus.value = 'error'
        modelTestMessage.value = '请求成功但未返回内容'
        return
      }

      modelTestStatus.value = 'success'
      modelTestMessage.value = ''
    } catch (error) {
      if (abortSignal.aborted || isAbortError(error)) return
      modelTestElapsedMs.value = Math.round(performance.now() - startedAt)
      modelTestStatus.value = 'error'
      modelTestMessage.value = (error as Error)?.message || String(error)
    } finally {
      if (modelTestAbort?.signal === abortSignal) {
        isTestingModel.value = false
        modelTestAbort = null
      }
    }
  }
  return {
    thinkingEffortOptions,
    effortMatrixRaf,
    effortMatrixStop,
    effortMatrixIo,
    effortMatrixRo,
    stopEffortMatrixFx,
    startEffortMatrixFx,
    bindEffortMatrix,
    modelDropdownAnchorRef,
    modelIdInputRef,
    modelDropdownRef,
    modelDropdownStyle,
    isFetchingModels,
    showModelDropdown,
    fetchedModelList,
    formData,
    isEditing,
    isRemote,
    effortMaxIndex,
    EFFORT_THUMB_PX,
    effortBarRef,
    effortSlide,
    isDraggingEffort,
    effortIndex,
    isMaxEffort,
    effortThumbOffset,
    effortFillWidth,
    effortStopLeft,
    effortThumbLeft,
    snapEffortValue,
    applyEffortMagnet,
    slideEffortFromClientX,
    suppressEffortSelectStart,
    lockEffortTextSelect,
    onEffortPointerDown,
    onEffortPointerMove,
    onEffortPointerUp,
    onEffortKeydown,
    dialogTitle,
    requiresModelId,
    isChatProtocol,
    isResponsesProtocol,
    isMessagesProtocol,
    isFormValid,
    filteredFetchedModels,
    groupedFetchedModels,
    updateModelDropdownPosition,
    modelDropdownBlurTimer,
    clearModelDropdownBlurTimer,
    openModelDropdown,
    closeModelDropdown,
    normalizeBaseUrl,
    modelsCacheByBaseUrl,
    fetchModelsGeneration,
    tauriFetchPromise,
    getTauriFetch,
    applyFetchedModels,
    restoreModelsFromCache,
    handleModelIdFocus,
    toggleModelDropdown,
    handleModelIdBlur,
    handleModelIdInput,
    handleModelDropdownOutsideClick,
    handleModelDropdownViewportChange,
    parseModelsResponse,
    fetchModels,
    selectFetchedModel,
    DEFAULT_JS_CODE,
    DEFAULT_VISION_JS_CODE,
    thinkingPresetOptions,
    buildCurrentPresetJsCode,
    syncPresetJsCode,
    EFFORT_VALUES,
    normalizeEffort,
    normalizeOffResponsesEffort,
    createDialogFormData,
    readEnableThinkingFromJsCode,
    applyEnableThinkingToJsCode,
    deriveEnableThinking,
    showAdvancedCode,
    applyModelIdToJsCode,
    onDialogAfterLeave,
    cmContainerRef,
    cmView,
    themeObserver,
    rebuildEditorWithDoc,
    jsSyntaxLinter,
    initCodeMirror,
    setEditorDoc,
    handleOverlayClick,
    handlePrimaryAction,
    handleSubmit,
    isTestingModel,
    modelTestStatus,
    modelTestMessage,
    modelTestElapsedMs,
    modelTestAbort,
    canTestModel,
    modelTestCardClass,
    modelTestTitle,
    modelTestTooltip,
    modelTestMeta,
    resetModelTestState,
    isAbortError,
    collectProcessModelOutput,
    testModelAvailability,
  }
}
