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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
          <div class="settings-inner-wrapper">
            <div class="settings-content-wrapper">
              <GeneralSettings />
            </div>
          </div>
        </div>

        <!-- 网络设置 -->
        <div v-if="activeCategory === 'network'" class="settings-section">
          <div class="settings-inner-wrapper">
            <div class="settings-content-wrapper">
              <NetworkSettings />
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

        <!-- 题库设置 -->
        <div v-if="activeCategory === 'question'" class="settings-section">
          <div class="settings-inner-wrapper">
            <div class="settings-content-wrapper">
              <QuestionBankSettings />
            </div>
          </div>
        </div>

        <!-- 关于应用 -->
        <div v-if="activeCategory === 'about'" class="settings-section">
          <div class="settings-inner-wrapper">
            <div class="settings-content-wrapper">
              <AboutApp />
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
import GeneralSettings from '../components/GeneralSettings.vue'
import NetworkSettings from '../components/NetworkSettings.vue'
import ModelSettings from '../components/ModelSettings.vue'
import QuestionBankSettings from '../components/QuestionBankSettings.vue'
import AboutApp from '../components/AboutApp.vue'

// 设置管理
const { settings, saveSettings, resetSettings, addSettingsListener, setSetting } = useSettingsManager()

// 主题管理
const { setTheme, getThemeDisplayName, getThemeIcon } = useTheme()

// 当前活跃的设置分类
const activeCategory = ref('general')

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
    id: 'general',
    name: '常规设置',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z'
  },
  {
    id: 'network',
    name: '网络设置',
    icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0'
  },
  {
    id: 'models',
    name: '模型设置',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
  },
  {
    id: 'question',
    name: '题库设置',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
  },
  {
    id: 'about',
    name: '关于应用',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  }
]

// 主题选项
// 处理其他设置变更
const handleSettingChange = async (key: string, value: any) => {
  setSetting(key as any, value)
  await saveSettings()
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

/* 平台列表样式 */
.platform-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.platform-item {
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--platform-item-border);
  background-color: var(--platform-item-bg);
  color: var(--platform-item-text);
}

.platform-item:hover {
  background-color: var(--platform-item-hover-bg);
  border-color: var(--platform-item-hover-border);
  color: var(--platform-item-hover-text);
}

.platform-item.active {
  background-color: var(--platform-item-active-bg);
  border-color: var(--platform-item-active-border);
  color: var(--platform-item-active-text);
}

.platform-item.active .platform-name,
.platform-item.active .platform-status,
.platform-item.active .model-count {
  color: var(--platform-item-active-text);
}

.platform-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0 0 4px 0;
}

/* 平台图标样式 */
.platform-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
}

.icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
}

.icon-emoji {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--bg-secondary, #f7fafc);
  border-radius: 6px;
}

.icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary, #667eea);
  color: white;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.platform-info {
  flex: 1;
  min-width: 0;
}

/* 模型列表样式 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  background-color: var(--model-item-bg);
  padding: 12px;
  border: 1px solid var(--model-item-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--model-item-text);
}

.model-item:hover {
  background: var(--model-item-hover-bg);
  border-color: var(--model-item-hover-border);
  color: var(--model-item-hover-text);
}

.model-item.active {
  background: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
}

.model-info {
  flex: 1;
}

.model-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--model-item-name-text);
  margin: 0px;
}

.model-description {
  display: none;
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin: 0;
}

.model-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.model-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: none;
  color: var(--model-selected-color);
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
  color: var(--text-secondary);
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
  background: var(--bg-secondary);
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

.settings-content-wrapper {
  padding: 24px;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
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