<template>
  <div class="network-settings">
    <h2 class="section-title">网络设置</h2>
    
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">服务器端口</h3>
        <p class="setting-description">设置本地服务器监听的端口号</p>
      </div>
      <div class="setting-control">
        <div class="input-group">
          <input 
            type="number" 
            v-model="localSettings.network.serverPort"
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
          v-model="localSettings.network.enableLanAccess"
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
          {{ localSettings.network.bindAddress }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsManager } from '../composables/useSettingsManager'
import { environmentDetector } from '../services/environmentDetector'
import Toggle from './Toggle.vue'

// 获取设置管理器
const { settings, setSetting } = useSettingsManager()

// 本地设置状态
const localSettings = settings

// 处理网络设置变更
const handleNetworkChange = () => {
  // 自动更新绑定地址
  localSettings.value.network.bindAddress = localSettings.value.network.enableLanAccess ? '0.0.0.0' : '127.0.0.1'
}

// 打开局域网访问文档
const openLanAccessDocs = async () => {
  const url = 'https://docs.zerror.cc/docs/local/LAN'
  
  if (environmentDetector.isTauriEnvironment) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch (error) {
      console.error('Failed to open URL with Tauri opener:', error)
      // 回退到 window.open
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank')
  }
}

// 保存网络设置
const saveNetworkSettings = async () => {
  try {
    // 验证端口号
    const port = localSettings.value.network.serverPort
    if (port < 1 || port > 65535) {
      alert('端口号必须在 1-65535 之间')
      return
    }

    // 保存网络设置
    await setSetting('network', localSettings.value.network)
    
    // 显示成功消息
    alert('网络设置已保存，重启服务器后生效')
  } catch (error) {
    console.error('保存网络设置失败:', error)
    alert('保存网络设置失败，请重试')
  }
}
</script>

<style scoped>
.network-settings {
  /* 继承父组件的样式 */
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 24px 0;
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

.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  width: 120px;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.input-suffix {
  font-size: 14px;
  color: var(--text-secondary);
}

.readonly-value {
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 14px;
  font-family: monospace;
}

.setting-title-with-help {
  display: flex;
  align-items: center;
  gap: 8px;
}

.help-button {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.help-button:hover {
  background: var(--bg-secondary);
  color: var(--primary-color);
}

.help-button svg {
  width: 16px;
  height: 16px;
}
</style>