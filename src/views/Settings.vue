<template>
  <div class="settings-page">

    <div class="settings-layout">
      <SettingsNav v-model="activeCategory" />

      <!-- 右侧设置内容 -->
      <div class="settings-content">
        <Transition name="page-switch">
          <div v-if="activeCategory === 'general'" key="general" class="settings-section">
            <div class="settings-inner-wrapper general-scroll-wrap">
              <div class="settings-content-wrapper general-scroll-content" ref="generalScrollContent" @scroll="onGeneralScroll">
                <GeneralSettings @open-question-folder="handleOpenQuestionFolder" />
              </div>
              <div class="custom-scrollbar" :class="{ 'is-visible': generalScrollbarVisible }" ref="generalScrollbar" @mousedown="onGeneralScrollbarMousedown">
                <div class="custom-scrollbar-thumb" ref="generalScrollbarThumb"></div>
              </div>
            </div>
          </div>

          <div v-else-if="activeCategory === 'models'" key="models" class="settings-section model-settings-layout">
            <div class="settings-inner-wrapper">
              <ModelSettings />
            </div>
          </div>

          <div v-else-if="activeCategory === 'about'" key="about" class="settings-section">
            <div class="settings-inner-wrapper about-scroll-wrap">
              <div class="settings-content-wrapper about-scroll-content" ref="aboutScrollContent" @scroll="onAboutScroll">
                <AboutApp />
              </div>
              <div class="custom-scrollbar" :class="{ 'is-visible': aboutScrollbarVisible }" ref="aboutScrollbar" @mousedown="onAboutScrollbarMousedown">
                <div class="custom-scrollbar-thumb" ref="aboutScrollbarThumb"></div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>


  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import GeneralSettings from './settings/GeneralSettings.vue'
import ModelSettings from './settings/ModelSettings.vue'
import AboutApp from './settings/AboutApp.vue'
import SettingsNav from './settings/SettingsNav.vue'

const emit = defineEmits<{
  'open-question-folder': [folderId: number]
}>()

const activeCategory = ref('models')

const handleOpenModelSettings = () => {
  activeCategory.value = 'models'
}

const handleOpenQuestionFolder = (folderId: number) => {
  emit('open-question-folder', folderId)
}

onMounted(() => {
  window.addEventListener('open-model-settings', handleOpenModelSettings)
})

onUnmounted(() => {
  window.removeEventListener('open-model-settings', handleOpenModelSettings)
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

.settings-layout {
  background-color: var(--bg-primary, #f4f4f4);
  height: 100%;
  display: flex;
  gap: 4px;
}

.settings-content {
  box-sizing: border-box;
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 4px;
  margin-bottom: 5px;
  margin-right: 5px;
}

.settings-section {
  position: absolute;
  inset: 0;
  height: auto;
  margin: 0;
}

/* 常规 / 关于：整张卡片错开浮入 */
.settings-section:not(.model-settings-layout).page-switch-enter-from {
  opacity: 1;
  transform: none;
}

.settings-section:not(.model-settings-layout).page-switch-leave-to {
  transform: none;
}

.settings-section:not(.model-settings-layout).page-switch-enter-active {
  transition-duration: 620ms;
}

.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group) {
  animation: settings-stagger-in 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(1)) { animation-delay: 0ms; }
.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(2)) { animation-delay: 70ms; }
.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(3)) { animation-delay: 140ms; }
.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(4)) { animation-delay: 210ms; }
.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(5)) { animation-delay: 280ms; }
.settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group:nth-child(6)) { animation-delay: 350ms; }

@keyframes settings-stagger-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-section:not(.model-settings-layout).page-switch-enter-active :deep(.network-group) {
    animation: none;
  }
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

.general-scroll-content.settings-content-wrapper {
  padding: 16px;
  padding-top: 0;
}

.about-scroll-content.settings-content-wrapper {
  padding: 16px;
  padding-top: 0;
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

@media (max-width: 768px) {
  .settings-page {
    padding: 20px;
  }

  .settings-layout {
    flex-direction: column;
    height: auto;
  }
}
</style>
