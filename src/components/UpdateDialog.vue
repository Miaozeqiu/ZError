<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel update-dialog-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="handleClose" title="关闭">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">发现新版本</h3>
        <button class="btn-confirm" type="button" @click="handleDownload">立即下载</button>
      </div>

      <div class="dialog-body">
        <p class="version-line">
          <span class="version-muted">当前 {{ currentVersion }}</span>
          <span class="version-arrow" aria-hidden="true">→</span>
          <span class="version-latest">最新 {{ versionInfo?.version }}</span>
        </p>

        <div class="changelog-section">
          <div class="form-label">更新内容</div>
          <div class="changelog-box">
            <ul v-if="changelogItems.length" class="changelog-list">
              <li v-for="(item, index) in changelogItems" :key="index">{{ item }}</li>
            </ul>
            <p v-else class="changelog-empty">暂无更新说明</p>
          </div>
        </div>

        <div class="secondary-actions">
          <button type="button" class="btn-ghost" @click="handleLater">稍后提醒</button>
          <button type="button" class="btn-ghost" @click="handleWeekLater">一周后提醒</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VersionInfo } from '../services/versionCheck'
import { VersionCheckService } from '../services/versionCheck'

interface Props {
  visible: boolean
  versionInfo: VersionInfo | null
  currentVersion: string
  downloadFileName?: string
  downloadUrl?: string
  nativeUpdater?: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'download', url: string): void
  (e: 'later'): void
  (e: 'week-later'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const changelogItems = computed(() => {
  if (!props.versionInfo?.changelog) return []
  return VersionCheckService.formatChangelog(props.versionInfo.changelog)
})

const handleClose = () => {
  emit('close')
}

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
      target.closest('input') || target.closest('textarea') || target.closest('select')) {
    return
  }

  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }

    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }

    emit('close')
  }, 0)
}

const handleLater = () => {
  emit('later')
}

const handleWeekLater = () => {
  emit('week-later')
}

const handleDownload = () => {
  emit('download', props.versionInfo?.downloadUrl || '')
}
</script>

<style>
@import '../styles/dialog.css';
</style>

<style scoped>
.dialog-overlay {
  background: var(--platform-config-overlay-bg);
  z-index: 2000;
}

.update-dialog-panel {
  max-width: 460px;
  display: flex;
  flex-direction: column;
}

.version-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.5;
}

.version-muted {
  color: var(--text-secondary);
}

.version-arrow {
  color: var(--text-secondary);
  font-weight: 600;
}

.version-latest {
  color: var(--platform-config-dialog-title-text);
  font-weight: 600;
}

.changelog-section {
  margin-bottom: 16px;
}

.changelog-box {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--form-input-bg, #F7F7F7);
  border: 1px solid transparent;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: none;
}

.changelog-box::-webkit-scrollbar {
  width: 0;
  display: none;
}

.changelog-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.changelog-list li {
  position: relative;
  padding-left: 14px;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--platform-config-dialog-title-text);
}

.changelog-list li:last-child {
  margin-bottom: 0;
}

.changelog-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #F8B62B;
}

.changelog-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.secondary-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.btn-ghost:hover {
  background: var(--platform-config-toggle-button-hover-bg, rgba(0, 0, 0, 0.04));
  color: var(--platform-config-dialog-title-text);
}
</style>
