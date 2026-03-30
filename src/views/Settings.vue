<template>
  <div class="settings-page">

    <div class="settings-layout">
      <!-- 左侧分类导航 -->
      <div class="settings-sidebar">
        <div class="category-list">
          <div 
            v-for="category in categories" 
            :key="category.id"
            :class="['category-item', { active: activeCategory === category.id }]"
            @click="activeCategory = category.id"
          >
            <div class="category-icon">
              <svg v-if="category.id === 'models'" width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M469.333333 42.666667v42.666666H298.666667a128 128 0 0 0-128 128v128a213.333333 213.333333 0 0 0 213.333333 213.333334h256a213.333333 213.333333 0 0 0 213.333333-213.333334V213.333333a128 128 0 0 0-128-128h-170.666666V42.666667h-85.333334zM256 213.333333a42.666667 42.666667 0 0 1 42.666667-42.666666h426.666666a42.666667 42.666667 0 0 1 42.666667 42.666666v128a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V213.333333z m149.333333 170.666667a64 64 0 1 0 0-128 64 64 0 0 0 0 128z m213.333334 0a64 64 0 1 0 0-128 64 64 0 0 0 0 128zM256 938.666667a256 256 0 0 1 512 0h85.333333a341.333333 341.333333 0 1 0-682.666666 0h85.333333z" fill="currentColor"/>
              </svg>
              <svg v-else-if="category.id === 'general'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
              </svg>
              <svg v-else-if="category.id === 'about'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path :d="category.icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <span class="category-name">{{ category.name }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧设置内容 -->
      <div class="settings-content">
        <!-- 常规设置 -->
        <div v-if="activeCategory === 'general'" class="settings-section">
          <div class="settings-inner-wrapper general-scroll-wrap">
            <div class="settings-content-wrapper general-scroll-content" ref="generalScrollContent" @scroll="onGeneralScroll">
              <GeneralSettings @open-question-folder="handleOpenQuestionFolder" />
            </div>
            <div class="custom-scrollbar" :class="{ 'is-visible': generalScrollbarVisible }" ref="generalScrollbar" @mousedown="onGeneralScrollbarMousedown">
              <div class="custom-scrollbar-thumb" ref="generalScrollbarThumb"></div>
            </div>
          </div>
        </div>

<!-- 模型设置 -->
        <!-- 模型设置 -->
        <div v-if="activeCategory === 'models'" class="settings-section model-settings-layout">
          <div class="settings-inner-wrapper">
            <ModelSettings />
          </div>
        </div>



        <!-- 关于应用 -->
        <div v-if="activeCategory === 'about'" class="settings-section">
          <div class="settings-inner-wrapper about-scroll-wrap">
            <div class="settings-content-wrapper about-scroll-content" ref="aboutScrollContent" @scroll="onAboutScroll">
              <AboutApp />
            </div>
            <div class="custom-scrollbar" :class="{ 'is-visible': aboutScrollbarVisible }" ref="aboutScrollbar" @mousedown="onAboutScrollbarMousedown">
              <div class="custom-scrollbar-thumb" ref="aboutScrollbarThumb"></div>
            </div>
          </div>
        </div>


      </div>
    </div>


  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useSettingsManager } from '../composables/useSettingsManager'
import { useTheme } from '../composables/useTheme'
import GeneralSettings from '../components/settings/GeneralSettings.vue'
import ModelSettings from '../components/settings/ModelSettings.vue'
import AboutApp from '../components/settings/AboutApp.vue'

const emit = defineEmits<{
  'open-question-folder': [folderId: number]
}>()

// 设置管理
const { settings, saveSettings, resetSettings, addSettingsListener, setSetting } = useSettingsManager()

// 主题管理
const { setTheme, getThemeDisplayName, getThemeIcon } = useTheme()

// 当前活跃的设置分类
const activeCategory = ref('models')

// 创建响应式的本地设置变量
const localSettings = ref({
  theme: settings.value.theme,
  autoAddToQuestionBank: settings.value.autoAddToQuestionBank || false,
  network: {
    serverPort: settings.value.network?.serverPort || 3000,
    enableLanAccess: settings.value.network?.enableLanAccess || false,
    bindAddress: (settings.value.network?.enableLanAccess || false) ? '0.0.0.0' : '127.0.0.1'
  }
})

// 监听设置变化并同步到本地变量
const syncLocalSettings = () => {
  localSettings.value = {
    theme: settings.value.theme,
    autoAddToQuestionBank: settings.value.autoAddToQuestionBank || false,
    network: {
      serverPort: settings.value.network?.serverPort || 3000,
      enableLanAccess: settings.value.network?.enableLanAccess || false,
      bindAddress: (settings.value.network?.enableLanAccess || false) ? '0.0.0.0' : '127.0.0.1'
    }
  }
}

// 设置分类
const categories = [
  {
    id: 'models',
    name: '模型设置',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
  },
  {
    id: 'general',
    name: '常规设置',
    icon: ''
  },
  {
    id: 'about',
    name: '关于应用',
    icon: ''
  }
]

// 主题选项
// 处理其他设置变更
const handleSettingChange = async (key: string, value: any) => {
  setSetting(key as any, value)
  await saveSettings()
}

const handleOpenQuestionFolder = (folderId: number) => {
  emit('open-question-folder', folderId)
}

// 设置变更监听器
let unsubscribe: (() => void) | null = null

onMounted(() => {
  syncLocalSettings()
  unsubscribe = addSettingsListener((newSettings) => {
    console.log('Settings updated:', newSettings)
    syncLocalSettings()
  })
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
  }
})

// 常规设置自定义滚动条
const generalScrollContent = ref<HTMLElement | null>(null)
const generalScrollbar = ref<HTMLElement | null>(null)
const generalScrollbarThumb = ref<HTMLElement | null>(null)
const generalScrollbarVisible = ref(false)
let generalScrollHideTimer: ReturnType<typeof setTimeout> | null = null
let generalIsDragging = false
let generalDragStartY = 0
let generalDragStartScrollTop = 0

const updateGeneralScrollbarThumb = () => {
  const content = generalScrollContent.value
  const thumb = generalScrollbarThumb.value
  const bar = generalScrollbar.value
  if (!content || !thumb || !bar) return
  const ratio = content.clientHeight / content.scrollHeight
  const barHeight = bar.clientHeight
  thumb.style.height = Math.max(ratio * barHeight, 24) + 'px'
  thumb.style.top = (content.scrollTop / content.scrollHeight) * barHeight + 'px'
}

const onGeneralScroll = () => {
  generalScrollbarVisible.value = true
  if (generalScrollHideTimer) clearTimeout(generalScrollHideTimer)
  generalScrollHideTimer = setTimeout(() => { generalScrollbarVisible.value = false }, 1500)
  updateGeneralScrollbarThumb()
}

const onGeneralScrollbarMousedown = (e: MouseEvent) => {
  generalIsDragging = true
  generalDragStartY = e.clientY
  generalDragStartScrollTop = generalScrollContent.value?.scrollTop || 0
  document.addEventListener('mousemove', onGeneralScrollbarMousemove)
  document.addEventListener('mouseup', onGeneralScrollbarMouseup)
}

const onGeneralScrollbarMousemove = (e: MouseEvent) => {
  if (!generalIsDragging || !generalScrollContent.value || !generalScrollbar.value) return
  const dy = e.clientY - generalDragStartY
  const ratio = generalScrollContent.value.scrollHeight / generalScrollbar.value.clientHeight
  generalScrollContent.value.scrollTop = generalDragStartScrollTop + dy * ratio
}

const onGeneralScrollbarMouseup = () => {
  generalIsDragging = false
  document.removeEventListener('mousemove', onGeneralScrollbarMousemove)
  document.removeEventListener('mouseup', onGeneralScrollbarMouseup)
}

// 关于应用自定义滚动条
const aboutScrollContent = ref<HTMLElement | null>(null)
const aboutScrollbar = ref<HTMLElement | null>(null)
const aboutScrollbarThumb = ref<HTMLElement | null>(null)
const aboutScrollbarVisible = ref(false)
let aboutScrollHideTimer: ReturnType<typeof setTimeout> | null = null
let aboutIsDragging = false
let aboutDragStartY = 0
let aboutDragStartScrollTop = 0

const updateAboutScrollbarThumb = () => {
  const content = aboutScrollContent.value
  const thumb = aboutScrollbarThumb.value
  const bar = aboutScrollbar.value
  if (!content || !thumb || !bar) return
  const ratio = content.clientHeight / content.scrollHeight
  const barHeight = bar.clientHeight
  thumb.style.height = Math.max(ratio * barHeight, 24) + 'px'
  thumb.style.top = (content.scrollTop / content.scrollHeight) * barHeight + 'px'
}

const onAboutScroll = () => {
  aboutScrollbarVisible.value = true
  if (aboutScrollHideTimer) clearTimeout(aboutScrollHideTimer)
  aboutScrollHideTimer = setTimeout(() => { aboutScrollbarVisible.value = false }, 1500)
  updateAboutScrollbarThumb()
}

const onAboutScrollbarMousedown = (e: MouseEvent) => {
  aboutIsDragging = true
  aboutDragStartY = e.clientY
  aboutDragStartScrollTop = aboutScrollContent.value?.scrollTop || 0
  document.addEventListener('mousemove', onAboutScrollbarMousemove)
  document.addEventListener('mouseup', onAboutScrollbarMouseup)
}

const onAboutScrollbarMousemove = (e: MouseEvent) => {
  if (!aboutIsDragging || !aboutScrollContent.value || !aboutScrollbar.value) return
  const dy = e.clientY - aboutDragStartY
  const ratio = aboutScrollContent.value.scrollHeight / aboutScrollbar.value.clientHeight
  aboutScrollContent.value.scrollTop = aboutDragStartScrollTop + dy * ratio
}

const onAboutScrollbarMouseup = () => {
  aboutIsDragging = false
  document.removeEventListener('mousemove', onAboutScrollbarMousemove)
  document.removeEventListener('mouseup', onAboutScrollbarMouseup)
}
</script>

<style scoped>
.settings-page {
  height: 100%;
  overflow: hidden;
}

.settings-header {
  text-align: center;
  margin-bottom: 40px;
}

.page-title {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-primary, #2d3748);
  margin-bottom: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.page-subtitle {
  font-size: 18px;
  color: var(--text-primary, #718096);
}

.settings-layout {
  background-color: var(--bg-primary, #f4f4f4);
  height: 100%;
  display: flex;
  gap: 4px;
}

.settings-sidebar {
  box-sizing: border-box;
  width: 180px;
  background: var(--bg-secondary, #e2e8f0);
  border-radius: 4px;
  padding: 12px;
  flex-shrink: 0;
  margin-bottom: 5px;
}

/* 模型设置布局样式 */
.model-settings-layout .settings-content {
  padding: 0;
  height: 100%;
}

.model-settings-container {
  background-color: var(--bg-primary, #f4f4f4);
  gap: 4px;
  display: flex;
  height: 100%;
}

.platform-sidebar {
  width: 300px;
  background: var(--bg-secondary, #ffffff);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0;
}

.platform-detail {
  flex: 1;
  border-radius: 5px;
  background: var(--platform-detail-bg);
  border-left: 1px solid var(--platform-detail-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  background: var(--platform-detail-content-bg);
}

.detail-section {
  margin-bottom: 32px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.subsection-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--platform-detail-header-text);
  margin: 0 0 16px 0;
}

.platform-description {
  color: var(--platform-detail-description-text);
  margin: 8px 0 0 0;
  line-height: 1.5;
}

/* 表单样式 */
.form-group {
  margin-bottom: 16px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-row .form-group {
  flex: 1;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-detail-form-label-text);
  margin-bottom: 6px;
}





.form-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--platform-detail-form-input-border);
  border-radius: 6px;
  font-size: 14px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  background: var(--platform-detail-form-input-bg);
  color: var(--platform-detail-form-input-text);
  resize: vertical;
  min-height: 120px;
  transition: border-color 0.2s;
}

.form-textarea:focus {
  outline: none;
  border-color: var(--platform-detail-form-input-focus-border);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-group .form-input {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
}

.form-group .form-input {
  width: 100%;
  box-sizing: border-box;
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-secondary, #718096);
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  margin: 0;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-primary);
}

.category-item:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.category-item.active {
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.category-item.active:hover {
  background: var(--color-accent-light);
  color: var(--color-accent);
}



.category-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.category-name {
  font-size: 16px;
  font-weight: 500;
}

.settings-content {
  box-sizing: border-box;
  flex: 1;
  background: var(--bg-primary);
  border-radius: 4px;
  margin-bottom: 5px;
  margin-right: 5px;
}

.settings-section {
  height: 100%;
  margin-bottom: 40px;
}

.settings-inner-wrapper {
  height: 100%;
}

.general-scroll-wrap,
.about-scroll-wrap {
  position: relative;
  overflow: hidden;
}

.general-scroll-content,
.about-scroll-content {
  height: 100%;
  overflow-y: scroll;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.general-scroll-content::-webkit-scrollbar,
.about-scroll-content::-webkit-scrollbar {
  display: none;
}

.settings-content-wrapper {
  background: var(--bg-secondary);
  padding: 24px;
  padding-top: 0px;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 4px;
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
}

.custom-scrollbar.is-visible {
  opacity: 1;
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



.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--bg-primary);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
}

.setting-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.setting-description {
  font-size: 14px;
  color: #718096;
}

.setting-control {
  flex-shrink: 0;
  margin-left: 20px;
}

.select-input {
  padding: 8px 12px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #2d3748;
  min-width: 120px;
  transition: border-color 0.2s ease;
}

.select-input:focus {
  outline: none;
  border-color: #667eea;
}

.number-input {
  padding: 8px 12px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #2d3748;
  width: 80px;
  text-align: center;
  transition: border-color 0.2s ease;
}

.number-input:focus {
  outline: none;
  border-color: #667eea;
}

.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--platform-toggle-bg);
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #667eea;
}

input:checked + .slider:before {
  transform: translateX(26px);
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.btn-primary:hover {
  background: var(--btn-primary-hover);
  /* transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3); */
}



/* 主题选择器样式 */
.theme-selector {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  border: 2px solid var(--border-primary, #e2e8f0);
  border-radius: 12px;
  background: var(--bg-primary, white);
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 80px;
  text-align: center;
}

.theme-option:hover {
  border-color: var(--color-primary, #667eea);
  background: var(--hover-bg, #f7fafc);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.1));
}

.theme-option.active {
  border-color: var(--color-primary, #667eea);
  background: var(--color-primary, #667eea);
  color: white;
}

.theme-option.active:hover {
  background: var(--color-primary-hover, #5a67d8);
  border-color: var(--color-primary-hover, #5a67d8);
}

.theme-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}

.theme-option.active .theme-icon {
  background: rgba(255, 255, 255, 0.2);
}

.theme-name {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
}

/* 模型设置样式 */
.setting-group {
  margin-bottom: 32px;
}

.group-title {
  font-size: 18px;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e2e8f0;
}

.platform-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 20px;
}

.platform-info {
  flex: 1;
}

.platform-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.platform-status {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  /* background: #fed7d7; */
  color: #c53030;
}

.platform-status.active {
  background: #c6f6d5;
  color: #22543d;
}

.platform-description {
  font-size: 14px;
  color: #718096;
  margin: 0 0 8px 0;
}

.platform-models {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 图标样式 */
.icon {
  color: currentColor;
  transition: color 0.2s ease;
}

.btn:hover .icon {
  color: var(--primary, #667eea);
}
.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-with-suffix {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.input-with-suffix .form-group{
  width: 100%;
}

.input-with-suffix .form-input {
  width: 100%;
  padding-right: 40px;
  flex: 1;
}

.input-suffix-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: color 0.2s ease;
}

.input-suffix-btn:hover {
  color: var(--primary-color);
}

.input-suffix {
  font-size: 14px;
  color: #718096;
  white-space: nowrap;
  padding: 8px 12px;
  min-width: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.readonly-value {
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
  font-size: 14px;
}

.setting-actions {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}

.model-count {
  font-size: 12px;
  color: #a0aec0;
}

.platform-actions {
  display: flex;
  gap: 8px;
}

.btn-small {
  padding: 6px 12px;
  font-size: 14px;
}

.btn-outline {
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.btn-outline:hover {
  background: hsl(27, 100%, 93%);
  color: var(--color-accent);
}

.btn-danger {
  background: #ffe7e7;
  color: rgb(255, 76, 76);
}

.btn-danger:hover {
  background: #ffcccc;
}

@media (max-width: 768px) {
  .theme-selector {
    justify-content: center;
  }
  
  .theme-option {
    flex: 1;
    min-width: 70px;
  }

  .settings-page {
    padding: 20px;
  }
  
  .settings-layout {
    flex-direction: column;
    height: auto;
  }
  
  .settings-sidebar {
    width: 100%;
  }
  
  .category-list {
    flex-direction: row;
    overflow-x: auto;
  }
  
  .category-item {
    flex-shrink: 0;
    min-width: 120px;
  }
  
  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .setting-control {
    margin-left: 0;
    width: 100%;
  }
  
  .select-input {
    width: 100%;
  }
}

/* 测试结果样式 */
.test-result {
  margin-top: 16px;
  border-radius: 8px;
  overflow: hidden;
}

.test-result.success {
  border: 1px solid #48bb78;
  background: #f0fff4;
}

.test-result.error {
  border: 1px solid #f56565;
  background: #fff5f5;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-weight: 600;
}

.test-result.success .result-header {
  background: #c6f6d5;
  color: #22543d;
}

.test-result.error .result-header {
  background: #fed7d7;
  color: #742a2a;
}

.result-time {
  font-size: 12px;
  opacity: 0.8;
}

.result-content {
  padding: 16px;
  background: white;
}

/* 平台状态切换开关样式 */
.platform-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}


.status-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.result-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #2d3748;
}
</style>