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
    <div class="detail-content">
      <div v-if="!isEditMode">
        <div class="detail-item">
          <label>题目ID:</label>
          <span>{{ question?.id }}</span>
        </div>
        <div class="detail-item">
          <label>题目内容:</label>
          <div class="question-content">
            <template v-for="(part, i) in contentParts" :key="i">
              <span v-if="part.type === 'text'">{{ part.text }}</span>
              <img 
                v-else-if="imgSrc(part.url as string)" 
                :src="imgSrc(part.url as string)" 
                :class="['question-image', invertClass(part.url as string)]" 
              />
              <span v-else class="image-loading">[图片加载中]</span>
            </template>
          </div>
        </div>
        <div class="detail-item">
          <label>答案:</label>
          <div class="answer-content">{{ question?.answer }}</div>
        </div>
        <div class="detail-item">
          <label>题目类型:</label>
          <span class="type-tag">{{ question?.question_type || '未分类' }}</span>
        </div>
        <div class="detail-item">
          <label>所属文件夹:</label>
          <span>{{ question?.folder_name || '未分类' }}</span>
        </div>
        <div class="detail-item">
          <label>创建时间:</label>
          <span>{{ formatTime(question?.create_time) }}</span>
        </div>
      </div>
      <div v-else class="edit-form">
        <div class="form-group">
          <label>题目内容:</label>
          <textarea 
            :value="editQuestion"
            @input="$emit('update:editQuestion', ($event.target as HTMLTextAreaElement).value)"
            class="edit-textarea"
            rows="4"
            placeholder="请输入题目内容..."
          ></textarea>
        </div>
        <div class="form-group">
          <label>答案:</label>
          <textarea 
            :value="editAnswer"
            @input="$emit('update:editAnswer', ($event.target as HTMLTextAreaElement).value)"
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
          <button @click="$emit('cancel-edit')" class="cancel-btn">取消</button>
          <button @click="$emit('save-edit')" class="save-btn" :disabled="!isEditFormValid">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AIResponse } from '../../services/database'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  question: AIResponse | null
  show: boolean
  width: number
  isEditMode: boolean
  editQuestion: string
  editAnswer: string
  editType: string
  isEditFormValid: boolean
  isResizing: boolean
  formatTime: (t?: string) => string
}

const props = defineProps<Props>()

defineEmits<{
  (e: 'close'): void
  (e: 'toggle-edit'): void
  (e: 'cancel-edit'): void
  (e: 'save-edit'): void
  (e: 'resize-start', ev: MouseEvent): void
  (e: 'resize-over'): void
  (e: 'resize-leave'): void
  (e: 'update:editQuestion', v: string): void
  (e: 'update:editAnswer', v: string): void
  (e: 'update:editType', v: string): void
}>()
interface Part { type: 'text' | 'image'; text?: string; url?: string }
const imageSrcMap = ref<Record<string, string>>({})
const blackOnlyMap = ref<Record<string, boolean>>({})
const urlRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif))(?:\b|(?=\s)|$)/gi

const contentParts = computed<Part[]>(() => {
  const text = props.question?.question || ''
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
})

const imageUrls = computed(() => contentParts.value.filter(p => p.type === 'image').map(p => p.url as string))

const imgSrc = (u: string) => imageSrcMap.value[u]
const invertClass = (u: string) => blackOnlyMap.value[u] ? 'invert-on-dark' : ''

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

watch(() => props.question?.question, async () => {
  imageSrcMap.value = {}
  await fetchImages(imageUrls.value)
}, { immediate: true })
</script>

<style scoped>
.question-detail-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background-color: var(--bg-primary);
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
  border-bottom: 1px solid var(--request-details-border);
  background-color: var(--bg-primary);
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

.detail-content {
  overflow: auto;
  flex: 1;
  padding: 20px;
}

.detail-item {
  margin-bottom: 16px;
}

.detail-item label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-item span {
  font-size: 14px;
  color: var(--text-primary);
}

.question-content {
  overflow-x: auto;
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
  white-space: pre-wrap;
}

.answer-content {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
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

.detail-item .type-tag {
  display: inline-block;
  padding: 4px 8px;
  background-color: var(--question-detail-type-tag-bg);
  color: var(--question-detail-type-tag-text);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.edit-form {
  padding: 20px 0;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #666666;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.edit-textarea {
  height: 250px;
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.edit-textarea:focus {
  outline: none;
  border-color: rgb(236, 236, 236);
  box-shadow: 0 0 0 2px var(--shadow-input);
}

.edit-input {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.edit-input:focus {
  outline: none;
  border-color: var(--border-color);
  box-shadow: 0 0 0 2px var(--shadow-input);
}

.edit-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-primary);
}

.cancel-btn, .save-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn {
  background-color: var(--question-detail-cancel-btn-bg);
  color: var(--question-detail-cancel-btn-text);
  border: 1px solid var(--question-detail-cancel-btn-border);
}

.cancel-btn:hover {
  background-color: var(--question-detail-cancel-btn-hover-bg);
  color: var(--question-detail-cancel-btn-hover-text);
}

.save-btn {
  background-color: var(--question-detail-save-btn-bg);
  color: var(--question-detail-save-btn-text);
}

.save-btn:hover:not(:disabled) {
  background-color: var(--question-detail-save-btn-hover-bg);
}

.save-btn:disabled {
  background-color: var(--question-detail-save-btn-disabled-bg);
  cursor: not-allowed;
}
</style>