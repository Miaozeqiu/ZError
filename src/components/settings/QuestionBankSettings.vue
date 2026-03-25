<template>
  <div class="question-bank-settings">
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">自动将AI返回的题目添加到本地题库</h3>
        <p class="setting-description">(该设置暂时无效，ai返回的答案总是会保存)</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="localSettings.autoAddToQuestionBank" variant="default" size="medium"
          @change="handleSettingChange('autoAddToQuestionBank', $event)" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">开启分析（非思考模型）</h3>
        <p class="setting-description">开启后非思考模型会先进行一段分析，最后给出答案，可提高正确率，但会增加增加回答时间</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="localSettings.enableNonThinkingModelAnalysis" variant="default" size="medium"
          @change="handleSettingChange('enableNonThinkingModelAnalysis', $event)" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">文本模型最长响应时间</h3>
        <p class="setting-description">AI 模型单次响应的超时限制（秒）。超过此时间将停止等待并返回已生成的内容。默认 40 秒。</p>
      </div>
      <div class="setting-control timeout-control">
        <input
          type="number"
          class="timeout-input"
          :value="localSettings.modelResponseTimeout ?? 40"
          min="5"
          max="600"
          step="5"
          @change="handleSettingChange('modelResponseTimeout', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="timeout-unit">秒</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import Toggle from '../Toggle.vue'

const { settings, setSetting, updateSettings } = useSettingsManager()

const localSettings = computed({
  get: () => settings.value,
  set: (val) => { updateSettings(val) }
})

const handleSettingChange = async (key: keyof import('../../services/settings').AppSettings, value: any) => {
  setSetting(key, value)

  if (key === 'enableNonThinkingModelAnalysis') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_non_thinking_analysis_enabled', { enabled: value })
    } catch (err) {
      console.warn('无法调用后端命令或非 Tauri 环境：', err)
    }
  }
}
</script>

<style scoped>
.question-bank-settings {
  /* 继承父组件的样式 */
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

.timeout-input:focus {
  border-color: var(--color-primary, #667eea);
}

.timeout-unit {
  font-size: 14px;
  color: var(--text-secondary);
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
  font-weight: 500;
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
