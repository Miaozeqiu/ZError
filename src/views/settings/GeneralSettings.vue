<template>
  <div class="general-settings">
    <div class="network-group">
      <div class="group-title">显示设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">主题模式</h3>
        <p class="setting-description">选择您偏好的界面主题</p>
      </div>
      <div class="setting-control">
        <ThemeSwitch v-model="localSettings.theme" @update:modelValue="handleThemeChange" />
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">保存设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">缓存文件夹</h3>
        <p class="setting-description">打开应用缓存目录，可手动清理缓存文件</p>
      </div>
      <div class="setting-control">
        <button 
          ref="btnRef"
          class="folder-action-btn select-folder-btn"
          :class="{ 'btn-ripple': isAnimating }"
          @click="handleButtonClick"
        >
          <svg t="1774430153065" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z" fill="currentColor"/>
          </svg>
          打开文件夹
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">题目保存文件夹</h3>
        <p class="setting-description">
          AI返回答案的题目将保存至：
          <button
            v-if="settings.questionSaveDir"
            type="button"
            class="selected-folder-link"
            :disabled="!canOpenQuestionSaveFolder"
            @click="openQuestionSaveFolder"
          >
            {{ settings.questionSaveDir }}
          </button>
          <span v-else class="unset-hint">默认文件夹</span>
        </p>

      </div>
      <div class="setting-control">
        <button class="folder-action-btn select-folder-btn" @click="selectQuestionSaveDir">
          <svg t="1774430153065" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z" fill="currentColor"/>
          </svg>
          选择文件夹
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">AI回答添加到本地题库</h3>
        <p class="setting-description">(该设置暂时无效，ai返回的答案总是会保存)</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="settings.autoAddToQuestionBank" variant="default" size="medium"
          @change="handleSettingChange('autoAddToQuestionBank', $event)" />
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">AI设置</div>
    <div class="setting-item">

      <div class="setting-info">
        <h3 class="setting-title">模型最长响应时间</h3>
        <p class="setting-description">AI 模型单次响应的超时限制（秒）。超过此时间将停止等待并返回已生成的内容。默认 40 秒。</p>
      </div>
      <div class="setting-control timeout-control">
        <input
          type="number"
          class="form-input"
          :value="settings.modelResponseTimeout ?? 40"
          min="5"
          max="600"
          step="5"
          @change="handleSettingChange('modelResponseTimeout', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="timeout-unit">秒</span>
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">网络设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">服务器端口</h3>
        <p class="setting-description">设置本地服务器监听的端口号</p>
      </div>
      <div class="setting-control">
        <div class="input-group">
          <input
            type="number"
            v-model="settings.network.serverPort"
            @change="handleNetworkChange"
            min="1"
            max="65535"
            class="form-input"
            placeholder="3000"
          />
          <span class="input-suffix">端口</span>
        </div>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <div class="setting-title-with-help">
          <h3 class="setting-title">局域网访问</h3>
          <button class="help-button" @click="openLanAccessDocs" title="查看局域网访问文档">
            <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M463.99957 784.352211c0 26.509985 21.490445 48.00043 48.00043 48.00043s48.00043-21.490445 48.00043-48.00043c0-26.509985-21.490445-48.00043-48.00043-48.00043S463.99957 757.842226 463.99957 784.352211z" fill="currentColor"></path>
              <path d="M512 960c-247.039484 0-448-200.960516-448-448S264.960516 64 512 64 960 264.960516 960 512 759.039484 960 512 960zM512 128.287273c-211.584464 0-383.712727 172.128262-383.712727 383.712727 0 211.551781 172.128262 383.712727 383.712727 383.712727 211.551781 0 383.712727-172.159226 383.712727-383.712727C895.712727 300.415536 723.551781 128.287273 512 128.287273z" fill="currentColor"></path>
              <path d="M512 673.695256c-17.664722 0-32.00086-14.336138-32.00086-31.99914l0-54.112297c0-52.352533 39.999785-92.352318 75.32751-127.647359 25.887273-25.919957 52.67249-52.67249 52.67249-74.016718 0-53.343368-43.07206-96.735385-95.99914-96.735385-53.823303 0-95.99914 41.535923-95.99914 94.559333 0 17.664722-14.336138 31.99914-32.00086 31.99914s-32.00086-14.336138-32.00086-31.99914c0-87.423948 71.775299-158.559333 160.00086-158.559333s160.00086 72.095256 160.00086 160.735385c0 47.904099-36.32028 84.191695-71.424378 119.295794-27.839699 27.776052-56.575622 56.511974-56.575622 82.3356l0 54.112297C544.00086 659.328155 529.664722 673.695256 512 673.695256z" fill="currentColor"></path>
            </svg>
          </button>
        </div>
        <p class="setting-description">允许局域网内其他设备访问本地服务器</p>
      </div>
      <div class="setting-control">
        <Toggle
          v-model="settings.network.enableLanAccess"
          variant="default"
          size="medium"
          @change="handleNetworkChange"
        />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">绑定地址</h3>
        <p class="setting-description">服务器绑定的IP地址（自动根据局域网访问设置调整）</p>
      </div>
      <div class="setting-control">
        <div class="readonly-value">
          {{ settings.network.bindAddress }}
        </div>
      </div>
    </div>
    </div>
  </div>

  <FolderPickerDialog
    :visible="showFolderPicker"
    :initial-folder-id="settings.questionSaveFolderId"
    @cancel="showFolderPicker = false"
    @confirm="handleFolderConfirm"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

import { useSettingsManager } from '../../composables/useSettingsManager'

import { useTheme } from '../../composables/useTheme'
import { environmentDetector } from '../../services/environmentDetector'
import ThemeSwitch from './GeneralSettings/ThemeSwitch.vue'
import Toggle from '../../components/Toggle.vue'
import FolderPickerDialog from '../../components/FolderPickerDialog.vue'

const emit = defineEmits<{
  'open-question-folder': [folderId: number]
}>()

// 打开缓存文件夹
const openingCache = ref(false)

const isAnimating = ref(false)
const isCooldown = ref(false)

const btnRef = ref<HTMLElement | null>(null)
let animationTimer: any = null
const handleButtonClick = () => {
  // 1. 每次点击都会强制重新触发视觉动画
  if (animationTimer) clearTimeout(animationTimer)
  
  // 核心逻辑：先取消类名，强制重绘，再重新添加类名
  isAnimating.value = false
  
  if (btnRef.value) {
    // 强制引发重排 (Reflow)，确保浏览器感知到 class 的移除
    void btnRef.value.offsetWidth
  }
  
  // 使用 requestAnimationFrame 确保在下一次重绘时添加类名
  requestAnimationFrame(() => {
    isAnimating.value = true
    animationTimer = setTimeout(() => {
      isAnimating.value = false
      animationTimer = null
    }, 600)
  })

  // 2. 只有在冷却结束后才会再次触发实际逻辑
  if (isCooldown.value || openingCache.value) return
  
  isCooldown.value = true
  setTimeout(() => {
    isCooldown.value = false
  }, 5000)

  openCacheFolder()
}

// 打开处理函数
let invoke: any = null

const openCacheFolder = async () => {
  openingCache.value = true
  try {
    if (!invoke) {
      const core = await import('@tauri-apps/api/core')
      invoke = core.invoke
    }
    await invoke('open_cache_dir')
  } catch (e) {
    console.error('打开缓存文件夹失败:', e)
  } finally {
    openingCache.value = false
  }
}
// 设置管理
const { settings, saveSettings, setSetting } = useSettingsManager()
const canOpenQuestionSaveFolder = computed(() => settings.value.questionSaveFolderId !== null && settings.value.questionSaveFolderId !== undefined)


const handleSettingChange = (key: keyof import('../../services/settings').AppSettings, value: any) => {
  setSetting(key, value)
}


const showFolderPicker = ref(false)

const selectQuestionSaveDir = () => {
  showFolderPicker.value = true
}

const openQuestionSaveFolder = () => {
  const folderId = settings.value.questionSaveFolderId
  if (folderId === null || folderId === undefined) return
  emit('open-question-folder', folderId)
}

const handleFolderConfirm = async (folderId: number, folderName: string, folderPath: string) => {

  showFolderPicker.value = false
  setSetting('questionSaveDir', folderPath || folderName)
  setSetting('questionSaveFolderId', folderId)
  await saveSettings()
}

const handleNetworkChange = () => {
  settings.value.network.bindAddress = settings.value.network.enableLanAccess ? '0.0.0.0' : '127.0.0.1'
}

const openLanAccessDocs = async () => {
  const url = 'https://docs.zerror.cc/docs/local/LAN'
  if (environmentDetector.isTauriEnvironment) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch (error) {
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank')
  }
}

// 主题管理
const { setTheme } = useTheme()

// 本地设置状态
const localSettings = ref({
  theme: 'auto' as 'light' | 'dark' | 'auto'
})

// 处理主题变更
const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
  localSettings.value.theme = theme
  setSetting('theme', theme)
  await setTheme(theme)
  await saveSettings()
}

// 同步本地设置
const syncLocalSettings = () => {
  localSettings.value = {
    theme: settings.value.theme || 'auto'
  }
}

onMounted(() => {
  syncLocalSettings()
})
</script>

<style scoped>
.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 24px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 24px;
}

.setting-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.setting-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.folder-action-btn {
  --folder-btn-bg: var(--bg-secondary);
  --folder-btn-text: var(--text-primary);
  --folder-btn-border: var(--border-color);
  --folder-btn-hover-bg: var(--hover-bg);
  --folder-btn-hover-border: var(--border-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--folder-btn-border);
  background: var(--folder-btn-bg);
  color: var(--folder-btn-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease !important;
}

.folder-action-btn:hover {
  background: var(--folder-btn-hover-bg);
  border-color: var(--folder-btn-hover-border);
}

.folder-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.open-folder-btn {
  --folder-btn-bg: var(--general-settings-open-folder-btn-bg);
  --folder-btn-text: var(--general-settings-open-folder-btn-text);
  --folder-btn-border: var(--general-settings-open-folder-btn-border);
  --folder-btn-hover-bg: var(--general-settings-open-folder-btn-hover-bg);
  --folder-btn-hover-border: var(--general-settings-open-folder-btn-hover-border);
}

.select-folder-btn {
  --folder-btn-bg: var(--general-settings-select-folder-btn-bg);
  --folder-btn-text: var(--general-settings-select-folder-btn-text);
  --folder-btn-border: var(--general-settings-select-folder-btn-border);
  --folder-btn-hover-bg: var(--general-settings-select-folder-btn-hover-bg);
  --folder-btn-hover-border: var(--general-settings-select-folder-btn-hover-border);
}



/* 按钮阴影扩散动画 */
.btn-ripple {
  position: relative;
  overflow: visible;
  /* 确保动画不受全局 transition 干扰 */
  transition: none !important;
  animation: ripple-spread 0.6s cubic-bezier(0.23, 1, 0.32, 1);
}

@keyframes ripple-spread {
  0% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4);
  }
  100% {
    box-shadow: 0 0 0 15px rgba(102, 126, 234, 0);
  }
}

.network-group {
  background: var(--network-group-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 0 16px;
  margin: 16px 0;
  box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 12px 0 4px 0;
  letter-spacing: 0.03em;
}

.setting-control .toggle-default {
  --toggle-active: #48bb78;
}

.network-group .setting-item:last-child {
  border-bottom: none;
}

.timeout-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.timeout-input {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-primary);
  text-align: center;
  outline: none;
  transition: border-color 0.2s;
}

.timeout-input::-webkit-inner-spin-button,
.timeout-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.timeout-input {
  -moz-appearance: textfield;
}

.timeout-input:focus {
  border-color: var(--color-primary, #667eea);
}

.timeout-unit {
  font-size: 14px;
  color: var(--text-secondary);
}

.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input[type=number] {
  text-align: center;
  -moz-appearance: textfield;
}

.form-input::-webkit-inner-spin-button,
.form-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}


.input-suffix {
  font-size: 14px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.setting-title-with-help {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.setting-title-with-help .setting-title {
  margin: 0;
}

.help-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
}

.help-button:hover {
  color: var(--text-primary);
}

.selected-folder-name {
  color: var(--color-primary);
  font-weight: 500;
}

.selected-folder-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.selected-folder-link:hover {
  text-decoration: underline;
}

.selected-folder-link:disabled {
  opacity: 0.7;
  cursor: default;
  text-decoration: none;
}

.unset-hint {

  color: var(--text-secondary);
  font-style: italic;
}
</style>
