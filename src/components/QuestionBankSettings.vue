<template>
  <div class="question-bank-settings">
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">自动将AI返回的题目添加到本地题库</h3>
        <p class="setting-description">(该设置暂时无效，ai返回的答案总是会保存)</p>
      </div>
      <div class="setting-control">
        <Toggle
          v-model="localSettings.autoAddToQuestionBank"
          variant="default"
          size="medium"
          @change="handleSettingChange('autoAddToQuestionBank', $event)"
        />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">开启分析（非思考模型）</h3>
        <p class="setting-description">开启后非思考模型会先进行一段分析，最后给出答案，可提高正确率，但会增加增加回答时间</p>
      </div>
      <div class="setting-control">
        <Toggle
          v-model="localSettings.enableNonThinkingModelAnalysis"
          variant="default"
          size="medium"
          @change="handleSettingChange('enableNonThinkingModelAnalysis', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsManager } from '../composables/useSettingsManager'
import Toggle from './Toggle.vue'

// 获取设置管理器
const { settings, setSetting } = useSettingsManager()

// 本地设置状态
const localSettings = settings

// 处理设置变更
const handleSettingChange = async (key: string, value: any) => {
  setSetting(key, value)

  // 同步到后端（仅在 Tauri 环境中有效）
  if (key === 'enableNonThinkingModelAnalysis') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_non_thinking_analysis_enabled', { enabled: value })
    } catch (err) {
      // 非 Tauri 环境或调用失败时忽略，并在控制台提示
      console.warn('无法调用后端命令或非 Tauri 环境：', err)
    }
  }
}
</script>

<style scoped>
.question-bank-settings {
  /* 继承父组件的样式 */
}

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
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.setting-description {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}
</style>