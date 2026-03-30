<template>
  <div v-if="question" 
       class="question-detail-overlay" 
       :class="{ show }" 
       :style="{ width: width + 'px' }">
    <div class="resizer" 
         :class="{ active: isResizing }"
         @mousedown="$emit('resize-start', $event)"
         @mouseover="$emit('resize-over')"
         @mouseleave="$emit('resize-leave')">
    </div>
    <div class="detail-header">
      <button class="back-btn" @click="$emit('close')">
        <svg t="1760584170728" class="icon" viewBox="0 0 1536 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="13220" width="20" height="20"><path d="M981.418667 71.893333A60.245333 60.245333 0 0 1 1070.506667 152.746667l-3.925334 4.309333L711.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z" fill="#838B9F" opacity=".25" p-id="13221"></path><path d="M469.418667 71.893333A60.245333 60.245333 0 0 1 558.506667 152.746667l-3.925334 4.309333L199.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z" fill="#838B9F" p-id="13222"></path></svg>
      </button>
      <h4>题目详情</h4>
      <button class="edit-btn" @click="$emit('toggle-edit')" :title="isEditMode ? '取消编辑' : '编辑题目'">
        <svg v-if="!isEditMode" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div class="detail-scroll-wrap">
      <div class="detail-content" ref="detailContentRef">
      <div v-if="!isEditMode">
        <div class="detail-item">
          <label>题目ID:</label>
          <div class="detail-value">{{ question?.id }}</div>
        </div>
        <div class="detail-item">
          <label>题目内容:</label>
          <div class="detail-value question-content">
            <template v-for="(part, i) in contentParts" :key="i">
              <span v-if="part.type === 'text'">{{ part.text }}</span>
              <img 
                v-else-if="imgSrc(part.url as string)" 
                :src="imgSrc(part.url as string)" 
                :class="['question-image', invertClass(part.url as string)]"
                @load="handleContentLayoutChange"
              />
              <span v-else class="image-loading">[图片加载中]</span>
            </template>
          </div>
        </div>
        <div class="detail-item">
          <label>选项:</label>
          <div class="detail-value options-content">
            <template v-for="(part, i) in optionsParts" :key="'opt-' + i">
              <span v-if="part.type === 'text'">{{ part.text }}</span>
              <img 
                v-else-if="imgSrc(part.url as string)" 
                :src="imgSrc(part.url as string)" 
                :class="['question-image', invertClass(part.url as string)]"
                @load="handleContentLayoutChange"
              />
              <span v-else class="image-loading">[图片加载中]</span>
            </template>
          </div>
        </div>
        <div class="detail-item">
          <label>答案:</label>
          <div class="detail-value answer-content">
            <template v-for="(part, i) in answerParts" :key="'ans-' + i">
              <span v-if="part.type === 'text'">{{ part.text }}</span>
              <img 
                v-else-if="imgSrc(part.url as string)" 
                :src="imgSrc(part.url as string)" 
                :class="['question-image', invertClass(part.url as string)]"
                @load="handleContentLayoutChange"
              />
              <span v-else class="image-loading">[图片加载中]</span>
            </template>
          </div>
        </div>
        <div class="detail-item detail-meta-item">
          <label>题目信息:</label>
          <div class="detail-meta-strip">
            <div class="meta-pill">
              <span class="meta-pill-label">类型</span>
              <span class="meta-pill-value meta-type-value">{{ question?.question_type || '未分类' }}</span>
            </div>
            <div class="meta-pill meta-pill-folder" :title="question?.folder_name || '未分类'">
              <span class="meta-pill-label">文件夹</span>
              <span class="meta-pill-value">{{ question?.folder_name || '未分类' }}</span>
            </div>
            <div class="meta-pill" :title="formatTime(question?.create_time)">
              <span class="meta-pill-label">创建</span>
              <span class="meta-pill-value">{{ formatCompactTime(question?.create_time) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="edit-form">
        <div class="form-group">
          <label>题目内容:</label>
          <textarea 
            :value="editQuestion"
            @input="onQuestionInput"
            ref="questionTextarea"
            class="edit-textarea"
            rows="4"
            placeholder="请输入题目内容..."
          ></textarea>
        </div>
        <div class="form-group">
          <label>选项:</label>
          <textarea 
            :value="editOptions"
            @input="onOptionsInput"
            ref="optionsTextarea"
            class="edit-textarea"
            rows="4"
            placeholder="请输入选项..."
          ></textarea>
        </div>
        <div class="form-group">
          <label>答案:</label>
          <textarea 
            :value="editAnswer"
            @input="onAnswerInput"
            ref="answerTextarea"
            class="edit-textarea"
            rows="6"
            placeholder="请输入答案..."
          ></textarea>
        </div>
        <div class="form-group">
          <label>题目类型:</label>
          <input 
            :value="editType"
            @input="$emit('update:editType', ($event.target as HTMLInputElement).value)"
            class="edit-input"
            placeholder="请输入题目类型..."
          />
        </div>
        <div class="edit-actions">
          <button @click="$emit('cancel-edit')" class="cancel-btn" :disabled="isSavingEdit">取消</button>
          <button @click="$emit('save-edit')" class="save-btn" :disabled="!isEditFormValid || isSavingEdit">
            {{ isSavingEdit ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
      </div>
      <div class="custom-scrollbar" :class="{ 'is-visible': scrollbarVisible }" ref="customScrollbarRef" @mousedown="onScrollbarMousedown">
        <div class="custom-scrollbar-thumb" ref="customScrollbarThumbRef"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { AIResponse } from '../../services/database'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  question: AIResponse | null
  show: boolean
  width: number
  isEditMode: boolean
  editQuestion: string
  editOptions: string
  editAnswer: string
  editType: string
  isEditFormValid: boolean
  isSavingEdit: boolean
  isResizing: boolean
  formatTime: (t?: string) => string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-edit'): void
  (e: 'cancel-edit'): void
  (e: 'save-edit'): void
  (e: 'resize-start', ev: MouseEvent): void
  (e: 'resize-over'): void
  (e: 'resize-leave'): void
  (e: 'update:editQuestion', v: string): void
  (e: 'update:editOptions', v: string): void
  (e: 'update:editAnswer', v: string): void
  (e: 'update:editType', v: string): void
}>()
interface Part { type: 'text' | 'image'; text?: string; url?: string }
const imageSrcMap = ref<Record<string, string>>({})
const blackOnlyMap = ref<Record<string, boolean>>({})
const urlRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif))(?:\b|(?=\s)|$)/gi

const splitContentParts = (text: string): Part[] => {
  const parts: Part[] = []
  let lastIndex = 0
  const regex = new RegExp(urlRegex.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const off = m.index
    if (off > lastIndex) parts.push({ type: 'text', text: text.slice(lastIndex, off) })
    parts.push({ type: 'image', url: m[0] })
    lastIndex = off + m[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text }]
}

const contentParts = computed<Part[]>(() => splitContentParts(props.question?.question || ''))
const optionsParts = computed<Part[]>(() => splitContentParts(props.question?.options || ''))
const answerParts = computed<Part[]>(() => splitContentParts(props.question?.answer || ''))

const formatCompactTime = (timeStr?: string) => {
  if (!timeStr) return '未知'

  const date = new Date(timeStr)
  if (Number.isNaN(date.getTime())) {
    const formatted = props.formatTime(timeStr)
    return formatted ? formatted.replace(/:\d{2}(?=\s*$)/, '') : '未知'
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const imageUrls = computed(() => {
  const qUrls = contentParts.value.filter(p => p.type === 'image').map(p => p.url as string)
  const oUrls = optionsParts.value.filter(p => p.type === 'image').map(p => p.url as string)
  const aUrls = answerParts.value.filter(p => p.type === 'image').map(p => p.url as string)
  return Array.from(new Set([...qUrls, ...oUrls, ...aUrls]))
})

const imgSrc = (u: string) => imageSrcMap.value[u]
const invertClass = (u: string) => blackOnlyMap.value[u] ? 'invert-on-dark' : ''

const questionTextarea = ref<HTMLTextAreaElement | null>(null)
const optionsTextarea = ref<HTMLTextAreaElement | null>(null)
const answerTextarea = ref<HTMLTextAreaElement | null>(null)
const detailContentRef = ref<HTMLElement | null>(null)
const customScrollbarRef = ref<HTMLElement | null>(null)
const customScrollbarThumbRef = ref<HTMLElement | null>(null)
const scrollbarVisible = ref(false)

let scrollbarHideTimer: ReturnType<typeof setTimeout> | null = null
let scrollbarResizeObserver: ResizeObserver | null = null
let scrollbarMutationObserver: MutationObserver | null = null
let cleanupScrollbarListeners: (() => void) | null = null

const clearScrollbarHideTimer = () => {
  if (scrollbarHideTimer) {
    clearTimeout(scrollbarHideTimer)
    scrollbarHideTimer = null
  }
}

const hideScrollbar = () => {
  scrollbarVisible.value = false
  clearScrollbarHideTimer()
}

const showScrollbar = () => {
  const content = detailContentRef.value
  if (!content || content.scrollHeight <= content.clientHeight + 1) {
    hideScrollbar()
    return
  }

  scrollbarVisible.value = true
  clearScrollbarHideTimer()
  scrollbarHideTimer = setTimeout(() => {
    scrollbarVisible.value = false
  }, 1500)
}

const updateScrollbarThumb = () => {
  const content = detailContentRef.value
  const thumb = customScrollbarThumbRef.value
  const bar = customScrollbarRef.value
  if (!content || !thumb || !bar) return

  const ratio = content.clientHeight / content.scrollHeight
  if (!Number.isFinite(ratio) || ratio >= 1) {
    thumb.style.height = '0px'
    thumb.style.transform = 'translateY(0)'
    hideScrollbar()
    return
  }

  const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
  const maxThumbTop = Math.max(bar.clientHeight - thumbHeight, 0)
  const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 1)
  const thumbTop = (content.scrollTop / maxScrollTop) * maxThumbTop

  thumb.style.height = `${thumbHeight}px`
  thumb.style.transform = `translateY(${thumbTop}px)`
}

const handleContentLayoutChange = () => {
  requestAnimationFrame(() => {
    updateScrollbarThumb()
    showScrollbar()
  })
}

const onScrollbarMousedown = (event: MouseEvent) => {
  const thumb = customScrollbarThumbRef.value
  const content = detailContentRef.value
  const bar = customScrollbarRef.value
  if (!thumb || !content || !bar) return

  const dragStartY = event.clientY
  const dragStartScrollTop = content.scrollTop

  const onMouseMove = (moveEvent: MouseEvent) => {
    const thumbHeight = thumb.clientHeight
    const barHeight = bar.clientHeight
    const maxThumbTravel = Math.max(barHeight - thumbHeight, 1)
    const delta = moveEvent.clientY - dragStartY
    const scrollRatio = delta / maxThumbTravel
    content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  event.preventDefault()
  showScrollbar()
}

const cleanupCustomScrollbar = () => {
  cleanupScrollbarListeners?.()
  cleanupScrollbarListeners = null
  scrollbarResizeObserver?.disconnect()
  scrollbarResizeObserver = null
  scrollbarMutationObserver?.disconnect()
  scrollbarMutationObserver = null
  clearScrollbarHideTimer()
}

const bindCustomScrollbar = () => {
  cleanupCustomScrollbar()

  const content = detailContentRef.value
  if (!content) return

  const onScroll = () => {
    updateScrollbarThumb()
    showScrollbar()
  }
  const onPointerEnter = () => {
    updateScrollbarThumb()
    showScrollbar()
  }
  const onPointerLeave = () => {
    updateScrollbarThumb()
  }

  content.addEventListener('scroll', onScroll, { passive: true })
  content.addEventListener('mouseenter', onPointerEnter)
  content.addEventListener('mouseleave', onPointerLeave)

  scrollbarResizeObserver = new ResizeObserver(() => updateScrollbarThumb())
  scrollbarResizeObserver.observe(content)

  scrollbarMutationObserver = new MutationObserver(() => {
    requestAnimationFrame(() => updateScrollbarThumb())
  })
  scrollbarMutationObserver.observe(content, { childList: true, subtree: true, characterData: true })

  cleanupScrollbarListeners = () => {
    content.removeEventListener('scroll', onScroll)
    content.removeEventListener('mouseenter', onPointerEnter)
    content.removeEventListener('mouseleave', onPointerLeave)
  }

  requestAnimationFrame(() => updateScrollbarThumb())
}

const initCustomScrollbar = async () => {
  await nextTick()
  bindCustomScrollbar()
  requestAnimationFrame(() => updateScrollbarThumb())
}

const autoResize = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  requestAnimationFrame(() => updateScrollbarThumb())
}

const onQuestionInput = (e: Event) => {
  const v = (e.target as HTMLTextAreaElement).value
  emit('update:editQuestion', v)
  const el = questionTextarea.value
  if (el) autoResize(el)
}

const onOptionsInput = (e: Event) => {
  const v = (e.target as HTMLTextAreaElement).value
  emit('update:editOptions', v)
  const el = optionsTextarea.value
  if (el) autoResize(el)
}

const onAnswerInput = (e: Event) => {
  const v = (e.target as HTMLTextAreaElement).value
  emit('update:editAnswer', v)
  const el = answerTextarea.value
  if (el) autoResize(el)
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode.apply(null, Array.from(sub) as any)
  }
  return btoa(binary)
}

const getMime = (url: string) => {
  const ext = (url.split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'application/octet-stream'
}

const fetchImages = async (urls: string[]) => {
  if (!urls.length) { imageSrcMap.value = {}; return }
  const unique = Array.from(new Set(urls))
  for (const url of unique) {
    try {
      const dataUrl = await invoke<string>('fetch_image_as_base64', { url })
      imageSrcMap.value = { ...imageSrcMap.value, [url]: dataUrl }
      analyzeImage(url, dataUrl)
    } catch {}
  }
}

const analyzeImage = (url: string, src: string) => {
  try {
    const img = new Image()
    img.onload = () => {
      const w = 32
      const h = 32
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      let nonTransparent = 0
      let hasNonBlack = false
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]
        if (a < 10) continue
        nonTransparent++
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const bright = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (bright > 30) { hasNonBlack = true; break }
      }
      blackOnlyMap.value = { ...blackOnlyMap.value, [url]: nonTransparent > 0 && !hasNonBlack }
    }
    img.src = src
  } catch {}
}

watch(() => [props.question?.question, props.question?.options, props.question?.answer], async () => {
  imageSrcMap.value = {}
  await fetchImages(imageUrls.value)
  requestAnimationFrame(() => updateScrollbarThumb())
}, { immediate: true })

watch(() => props.editQuestion, async () => {
  await nextTick()
  const el = questionTextarea.value
  if (el) autoResize(el)
})

watch(() => props.editOptions, async () => {
  await nextTick()
  const el = optionsTextarea.value
  if (el) autoResize(el)
})

watch(() => props.editAnswer, async () => {
  await nextTick()
  const el = answerTextarea.value
  if (el) autoResize(el)
})

watch(() => props.isEditMode, async (v) => {
  if (v) {
    await nextTick()
    if (questionTextarea.value) autoResize(questionTextarea.value)
    if (optionsTextarea.value) autoResize(optionsTextarea.value)
    if (answerTextarea.value) autoResize(answerTextarea.value)
  }
  if (props.show) {
    await initCustomScrollbar()
  }
})

watch(() => [props.show, props.question?.id, props.width] as const, async ([show]) => {
  if (!show) {
    hideScrollbar()
    return
  }
  await initCustomScrollbar()
}, { immediate: true })

onMounted(async () => {
  await nextTick()
  if (questionTextarea.value) autoResize(questionTextarea.value)
  if (optionsTextarea.value) autoResize(optionsTextarea.value)
  if (answerTextarea.value) autoResize(answerTextarea.value)
  await initCustomScrollbar()
})

onUnmounted(() => {
  cleanupCustomScrollbar()
})
</script>

<style scoped>
.question-detail-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.question-detail-overlay.show {
  transform: translateX(0);
}

.resizer {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background-color: transparent;
  cursor: ew-resize;
  z-index: 1001;
  transition: background-color 0.2s ease;
}

.resizer:hover {
  background-color: transparent;
}

.resizer.active {
  background-color: transparent;
}

.detail-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--bg-primary);
  gap: 12px;
}

.detail-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.back-btn, .edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn {
  transform: scaleX(-1);
}

.back-btn:hover, .edit-btn:hover {
  background-color: var(--hover-bg);
}

.edit-btn {
  color: var(--question-detail-edit-btn-text);
}

.edit-btn:hover {
  color: var(--question-detail-edit-btn-hover-text);
}

.detail-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.detail-content {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 20px 28px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.detail-content::-webkit-scrollbar,
.detail-content::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}

.detail-item {
  margin-bottom: 16px;
}

.detail-item label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-config-form-label-text);
  margin-bottom: 6px;
}

.detail-value {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary);
  background-color: var(--form-input-bg, #F7F7F7);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.detail-item:hover .detail-value {
  background-color: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.detail-meta-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}

.meta-pill {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
}

.meta-pill-folder {
  flex: 1 1 220px;
  min-width: 0;
}

.meta-pill-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.meta-pill-value {
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-type-value {
  color: var(--question-detail-type-tag-text);
  font-weight: 600;
}

.question-content,
.options-content,
.answer-content {
  overflow-x: auto;
  line-height: 1.5;
  white-space: pre-wrap;
}

.answer-content {
  word-break: break-word;
}


.question-image {
  display: inline;
  max-width: 100%;
  border-radius: 6px;
  margin: 0 4px;
  vertical-align: middle;
}

.image-loading {
  display: inline;
  color: var(--text-secondary);
  margin: 0 4px;
  vertical-align: middle;
}

:root[data-theme="dark"] .question-image.invert-on-dark {
  filter: invert(1) brightness(1.8) contrast(1.05);
}


.edit-form {
  padding: 20px 0;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-config-form-label-text);
  margin-bottom: 6px;
}

.edit-input,
.edit-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary);
  background-color: var(--form-input-bg, #F7F7F7);
  font-family: inherit;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.edit-textarea {
  min-height: 96px;
  height: auto;
  overflow-y: hidden;
  resize: none;
}

.edit-input:hover,
.edit-textarea:hover {
  background-color: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.edit-input:focus,
.edit-textarea:focus {
  outline: none;
  background-color: var(--form-input-bg, #F7F7F7);
  border-color: var(--form-input-focus-border, #3182ce);
  box-shadow: none;
}

.edit-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--border-primary);
}

.cancel-btn, .save-btn {
  min-width: 88px;
  height: 38px;
  padding: 0 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, opacity 0.18s ease;
}

.cancel-btn {
  border-radius: 999px;
  background-color: var(--question-detail-cancel-btn-bg);
  color: var(--question-detail-cancel-btn-text);
  border: 1px solid var(--question-detail-cancel-btn-border);
}

.cancel-btn:hover {
  background-color: var(--question-detail-cancel-btn-hover-bg);
  color: var(--question-detail-cancel-btn-hover-text);
  transform: translateY(-1px);
}

.save-btn {
  border: none;
  border-radius: 999px;
  background: linear-gradient(180deg, #f9cd52 0%, #f2b733 100%);
  color: #ffffff;
}

.save-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #fad664 0%, #f4bd3e 100%);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(242, 183, 51, 0.34);
}

.cancel-btn:active,
.save-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}

.cancel-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-primary) 12%, transparent);
}

.save-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(242, 183, 51, 0.24), 0 8px 18px rgba(242, 183, 51, 0.3);
}

.save-btn:disabled {
  background: linear-gradient(180deg, #e9e0be 0%, #d8c78f 100%);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.78;
}
</style>
