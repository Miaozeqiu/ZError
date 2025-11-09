<template>
  <div v-if="visible" class="update-dialog-overlay" @click="handleOverlayClick">
    <div class="update-dialog" @click.stop>
      <div class="dialog-header">
        <div class="header-icon">
          <svg width="24" height="24" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M875.755596 316.686342l-0.499939-0.499939L558.794288 19.122666c-25.896839-25.496888-67.691737-25.496888-93.588576 0L148.644355 316.186403c-0.199976 0.099988-0.299963 0.299963-0.499939 0.499939-13.998291 13.898303-18.097791 34.695765-10.598706 52.893543 7.499085 18.297766 25.196924 30.096326 44.994507 30.096326h167.579544c2.799658 0 4.99939 2.199731 4.999389 4.899402V778.929916c0 36.595533 29.896351 66.391896 66.591872 66.391895h180.477969c36.695521 0 66.591871-29.796363 66.591871-66.391895V404.575613c0-2.69967 2.199731-4.899402 4.999389-4.899402h167.579544c19.797583 0 37.495423-11.79856 44.994507-30.096326 7.599072-18.197779 3.399585-38.99524-10.598706-52.893543z m-29.696375 36.195582c-0.799902 1.999756-2.399707 3.099622-4.599438 3.099621H673.780251c-26.796729 0-48.694056 21.797339-48.694055 48.594068V778.929916c0 12.498474-10.298743 22.697229-22.897205 22.697229H421.811009c-12.598462 0-22.897205-10.198755-22.897205-22.697229V404.575613c0-26.796729-21.797339-48.594068-48.694055-48.594068H182.640205c-2.199731 0-3.799536-0.999878-4.599438-3.099621-0.799902-1.899768-0.499939-3.599561 0.89989-5.099378l316.461369-296.963749c0.199976-0.099988 0.299963-0.299963 0.499939-0.499939 8.898914-8.898914 23.497132-8.898914 32.396045 0l0.499939 0.499939 316.46137 296.963749c1.199854 1.499817 1.599805 3.199609 0.799902 5.099378zM645.583693 890.316319H378.416307c-12.298499 0-22.297278 9.998779-22.297279 22.297278s9.998779 22.297278 22.297279 22.297278h267.267374c12.298499 0 22.297278-9.998779 22.297278-22.297278-0.099988-12.398487-10.098767-22.297278-22.397266-22.297278zM645.583693 979.405444H378.416307c-12.298499 0-22.297278 9.998779-22.297279 22.297278s9.998779 22.297278 22.297279 22.297278h267.267374c12.298499 0 22.297278-9.998779 22.297278-22.297278s-10.098767-22.297278-22.397266-22.297278z" fill="var(--color-primary)"/>
          </svg>
        </div>
        <div class="header-content">
          <h3 class="dialog-title">发现新版本</h3>
          <p class="version-info">
            <span class="current-version">当前版本: {{ currentVersion }}</span>
            <span class="arrow">→</span>
            <span class="latest-version">最新版本: {{ versionInfo?.version }}</span>
          </p>
        </div>
        <button class="close-button" @click="handleClose" title="关闭">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="changelog-section">
          <h4 class="changelog-title">更新内容</h4>
          <div class="changelog-content">
            <ul class="changelog-list">
              <li v-for="(item, index) in changelogItems" :key="index" class="changelog-item">
                {{ item }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn-secondary" @click="handleLater">
          稍后提醒
        </button>
        <button class="btn-secondary" @click="handleWeekLater">
          一周后提醒
        </button>
        <button class="btn-primary" @click="handleDownload">
          立即下载
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VersionInfo } from '../services/versionCheck'
import { VersionCheckService } from '../services/versionCheck'
import { environmentDetector } from '@/services/environmentDetector'

interface Props {
  visible: boolean
  versionInfo: VersionInfo | null
  currentVersion: string
}

interface Emits {
  (e: 'close'): void
  (e: 'download', url: string): void
  (e: 'later'): void
  (e: 'week-later'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 格式化更新日志
const changelogItems = computed(() => {
  if (!props.versionInfo?.changelog) return []
  return VersionCheckService.formatChangelog(props.versionInfo.changelog)
})

// 处理关闭
const handleClose = () => {
  emit('close')
}

// 处理遮罩层点击
const handleOverlayClick = (event: MouseEvent) => {
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || 
      target.closest('input') || target.closest('textarea') || target.closest('select')) {
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
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }
    
    emit('close')
  }, 0)
}

// 处理稍后提醒
const handleLater = () => {
  emit('later')
}

// 处理一周后提醒
const handleWeekLater = () => {
  emit('week-later')
}

// 处理立即下载
const handleDownload = async () => {
  console.log('立即下载按钮被点击')
  
  // 使用专门的环境检测服务
  const isTauri = environmentDetector.isTauriEnvironment(true) // 启用日志
  console.log('环境检测结果:', isTauri ? 'Tauri环境' : '浏览器环境')
  
  try {
    if (isTauri) {
      console.log('检测到 Tauri 环境，尝试使用 opener 插件')
      try {
        // 使用 Tauri 的 opener 插件打开外部链接
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        console.log('成功导入 opener 插件，准备打开链接')
        await openUrl('https://app.zerror.cc')
        console.log('成功使用 opener 插件打开链接')
      } catch (openerError) {
        console.error('opener 插件失败:', openerError)
        console.log('回退到 window.open 方法')
        window.open('https://app.zerror.cc', '_blank')
      }
    } else {
      console.log('浏览器环境，使用 window.open')
      // 在浏览器环境中使用 window.open
      window.open('https://app.zerror.cc', '_blank')
    }
    emit('close')
  } catch (error) {
    console.error('打开链接失败:', error)
    console.log('最终回退到 window.open')
    // 如果所有方法都失败，最后尝试 window.open
    try {
      window.open('https://app.zerror.cc', '_blank')
    } catch (finalError) {
      console.error('window.open 也失败了:', finalError)
      alert('无法打开链接，请手动访问 https://app.zerror.cc')
    }
    emit('close')
  }
}
</script>

<style scoped>
.update-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease-out;
}

.update-dialog {
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  animation: slideIn 0.3s ease-out;
  border: 1px solid var(--border-color);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
}

.header-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.header-icon svg {
  width: 24px;
  height: 24px;
  fill: var(--color-primary);
}

.header-content {
  flex: 1;
}

.dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

.current-version {
  color: var(--text-secondary);
}

.arrow {
  color: var(--color-primary, #667eea);
  font-weight: 600;
}

.latest-version {
  color: var(--color-primary, #667eea);
  font-weight: 600;
}

.close-button {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--dialog-button-close-bg);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dialog-button-close-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-button:hover {
  background: var(--dialog-button-close-hover-bg);
  color: var(--dialog-button-close-hover-text);
}

.dialog-body {
  padding: 0 24px 24px;
  max-height: 400px;
  overflow-y: auto;
}

.changelog-section {
  margin-top: 16px;
}

.changelog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

.changelog-content {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--border-color);
}

.changelog-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.changelog-item {
  position: relative;
  padding-left: 20px;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
}

.changelog-item:last-child {
  margin-bottom: 0;
}

.changelog-item::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--color-primary, #667eea);
  font-weight: bold;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px 24px;
  justify-content: flex-end;
}

.btn-secondary {
  padding: 10px 20px;
  border: 1px solid var(--dialog-button-secondary-border);
  background: var(--dialog-button-secondary-bg);
  color: var(--dialog-button-secondary-text);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: var(--dialog-button-secondary-hover-bg);
  border-color: var(--dialog-button-secondary-hover-border);
  color: var(--dialog-button-secondary-hover-text);
}

.btn-primary {
  padding: 10px 20px;
  border: none;
  background: var(--dialog-button-primary-bg);
  color: var(--dialog-button-primary-text);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: var(--dialog-button-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 滚动条样式 */
.dialog-body::-webkit-scrollbar {
  width: 6px;
}

.dialog-body::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: 3px;
}

.dialog-body::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.dialog-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>