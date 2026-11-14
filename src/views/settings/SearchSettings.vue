<template>
  <div class="search-settings">
    <h3 class="search-title">联网搜索</h3>
    <div class="provider-list">
      <div
        v-for="provider in SEARCH_PROVIDERS" :key="provider.id"
        class="provider-item" :class="{ active: isSelected(provider.id) }"
        @contextmenu.prevent="openMenu($event, provider)"
      >
        <button type="button" class="provider-select" :aria-pressed="isSelected(provider.id)"
          @click="selectProvider(provider.id)">
          <span v-if="provider.id === 'exa'" class="provider-icon" v-html="exaIcon" aria-hidden="true"></span>
          <img v-else :src="providerIcons[provider.id]" class="provider-icon" alt="" />
          <span class="provider-name">{{ provider.name }}</span>
          <span class="provider-selection"><span v-if="isSelected(provider.id)" class="provider-dot"></span></span>
        </button>
        <div class="provider-actions">
          <a class="provider-action" :href="provider.website" target="_blank" rel="noopener noreferrer"
            :aria-label="`${provider.name} 官网`" :title="`打开 ${provider.name} 官网`"
            @click="openProviderWebsite($event, provider.website)">
            <Icon icon="lucide:external-link" width="15" height="15" aria-hidden="true" />
          </a>
          <button class="provider-action" type="button"
            :aria-label="`${getProviderKey(provider) ? '修改' : '填写'} ${provider.name} API 密钥`"
            :title="`${getProviderKey(provider) ? '修改' : '填写'} API 密钥`"
            @click="openDialog(provider, 'key')">
            <Icon icon="lucide:key-round" width="15" height="15" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
    <UnifiedContextMenu
      :visible="menu.visible" :x="menu.x" :y="menu.y" :menu-items="menuItems"
      exclusive-key="search-provider-menu" menu-class="settings-popup" @close="menu.visible = false" @item-click="onMenuItem"
    />
    <Teleport to="body">
      <div v-if="dialog && dialogProvider" class="dialog-overlay settings-popup" @click.self="closeDialog" @keydown.esc.stop.prevent="closeDialog">
        <form v-if="dialog === 'key'" class="dialog-panel account-dialog" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" @submit.prevent="saveKey">
          <div class="dialog-header">
            <h3 id="search-dialog-title" class="dialog-title">配置 {{ dialogProvider.name }}</h3>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label" for="search-key">API Key</label>
              <SecureSecretInput :key="dialogProvider.id" id="search-key" ref="keyInput" v-model="keyDraft" kind="api" label="API Key" :placeholder="`填写你的 ${dialogProvider.name} API Key`" />
              <p v-if="dialogProvider.id === 'exa'" class="dialog-description">可选，留空使用免密钥搜索。</p>
            </div>
            <div class="account-dialog-footer">
              <button type="button" class="account-dialog-cancel" @click="closeDialog">取消</button>
              <button type="submit" class="btn-confirm">保存</button>
            </div>
          </div>
        </form>
        <div v-else ref="dialogPanel" class="dialog-panel search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" tabindex="-1">
          <div class="dialog-header">
            <button class="btn-back" type="button" title="关闭" @click="closeDialog"><Icon icon="lucide:chevron-left" width="18" height="18" /></button>
            <h3 id="search-dialog-title" class="dialog-title">测试连接：{{ dialogProvider.name }}</h3>
            <button class="btn-confirm" type="button" @click="closeDialog">{{ testing ? '停止' : '关闭' }}</button>
          </div>
          <div class="dialog-body">
            <p v-if="testing" class="test-status" role="status">正在搜索，请稍候…</p>
            <p v-else-if="testError" class="test-status is-error" role="alert">{{ testError }}</p>
            <p v-else-if="testMessage" class="test-status is-success" role="status">{{ testMessage }}</p>
            <div v-if="testResults.length" class="test-results">
              <a v-for="(result, index) in testResults" :key="`${index}-${result.url}`" class="test-result" :href="safeResultUrl(result.url)" target="_blank" rel="noopener noreferrer">
                <span class="test-result-heading">
                  <span class="test-result-icon" aria-hidden="true">
                    <Icon icon="lucide:globe" width="14" height="14" />
                    <img :src="resultIconUrl(result)" alt="" loading="lazy" @error="hideBrokenIcon" />
                  </span>
                  <span class="test-result-title">{{ result.title }}</span>
                </span>
                <span v-if="result.snippet" class="test-result-snippet">{{ result.snippet }}</span>
                <span class="test-result-url">{{ result.url }}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { isNativeSecureStore, isSecretReference } from '../../services/security/secureStore'
import SecureSecretInput from '../../components/ui/SecureSecretInput.vue'
import { nextTick, reactive, ref, toRef, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import UnifiedContextMenu, { type MenuItem } from '../../components/ui/UnifiedContextMenu.vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { DEFAULT_SEARCH_SETTINGS, SEARCH_PROVIDERS, type SearchProvider, type SearchProviderId } from '../../services/searchProviders'
import { performWebSearch, type SearchResultItem } from '../../services/searchService'
import { modelConfigManager, withConfiguredDeepSeekKey } from '../../services/model/configManager'
import deepseekIcon from '../../assets/search/deepseek.svg'
import exaIcon from '../../assets/search/exa.svg?raw'
import tavilyIcon from '../../assets/search/tavily.svg'
import braveIcon from '../../assets/search/brave.svg'
import youIcon from '../../assets/search/you.svg'

const providerIcons = { deepseek: deepseekIcon, tavily: tavilyIcon, brave: braveIcon, you: youIcon }

const { settings, setSetting, saveSettings } = useSettingsManager()
if (!settings.value.search) setSetting('search', { ...DEFAULT_SEARCH_SETTINGS })
const search = toRef(settings.value, 'search')
if (!search.value.provider) search.value.provider = 'exa'
const getProviderKey = (provider: SearchProvider) => (provider.id === 'deepseek'
  ? modelConfigManager.getSettings().deepseekApiKey
  : search.value[provider.key]) || ''
const setProviderKey = (provider: SearchProvider, key: string) => {
  if (provider.id === 'deepseek') {
    modelConfigManager.setDeepSeekApiKey(key)
    return
  }
  search.value[provider.key] = key
  if (!settings.value.autoSave) void saveSettings()
}
const isSelected = (id: SearchProviderId) => search.value.enabled && search.value.provider === id
const selectProvider = (id: SearchProviderId) => {
  const selected = isSelected(id)
  search.value.provider = id
  search.value.enabled = !selected
}
const openProviderWebsite = (event: MouseEvent, url: string) => {
  if (!isNativeSecureStore()) return
  event.preventDefault()
  void import('@tauri-apps/plugin-opener')
    .then(({ openUrl }) => openUrl(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}
const menu = reactive({ visible: false, x: 0, y: 0 })
const menuProvider = ref<SearchProvider>(SEARCH_PROVIDERS[0])
const menuItems: MenuItem[] = [
  { id: 'key', label: '配置 API Key', action: 'key' },
  { id: 'test', label: '开始测试', action: 'test' },
]
const openMenu = (event: MouseEvent, provider: SearchProvider) => {
  menuProvider.value = provider
  Object.assign(menu, { visible: true, x: event.clientX, y: event.clientY })
}
const dialog = ref<'key' | 'test' | null>(null)
const dialogProvider = ref<SearchProvider | null>(null)
const keyDraft = ref('')
const keyInput = ref<InstanceType<typeof SecureSecretInput> | null>(null)
const dialogPanel = ref<HTMLElement | null>(null)
const testing = ref(false)
const testError = ref('')
const testMessage = ref('')
const testResults = ref<SearchResultItem[]>([])
const safeResultUrl = (url: string) => /^https?:\/\//i.test(url) ? url : undefined
const resultIconUrl = (result: SearchResultItem) => {
  if (result.siteIcon && safeResultUrl(result.siteIcon)) return result.siteIcon
  try {
    return safeResultUrl(result.url) ? `${new URL(result.url).origin}/favicon.ico` : undefined
  } catch {
    return undefined
  }
}
const hideBrokenIcon = (event: Event) => {
  (event.currentTarget as HTMLImageElement).style.display = 'none'
}
let controller: AbortController | null = null
const openDialog = async (provider: SearchProvider, action: 'key' | 'test') => {
  menu.visible = false
  if (provider.id === 'deepseek') await modelConfigManager.ready
  dialogProvider.value = provider
  keyDraft.value = getProviderKey(provider)
  testError.value = ''
  testMessage.value = ''
  testResults.value = []
  dialog.value = action
  await nextTick()
  const focusTarget = dialog.value === 'key' ? keyInput.value : dialogPanel.value
  focusTarget?.focus()
  if (dialog.value === 'test') void runTest()
}
const onMenuItem = (item: MenuItem) => {
  if (item.action === 'key' || item.action === 'test') void openDialog(menuProvider.value, item.action)
}
const closeDialog = () => {
  controller?.abort()
  controller = null
  testing.value = false
  dialog.value = null
  keyDraft.value = ''
}
const saveKey = () => {
  if (!dialogProvider.value) return
  const provider = dialogProvider.value
  const key = keyDraft.value.trim()
  if (key || !isSecretReference(getProviderKey(provider))) {
    setProviderKey(provider, key)
  }
  closeDialog()
}
const runTest = async () => {
  if (testing.value || !dialogProvider.value) return
  const provider = dialogProvider.value
  const request = new AbortController()
  controller = request
  testing.value = true
  testError.value = ''
  testMessage.value = ''
  try {
    const config = withConfiguredDeepSeekKey({ ...search.value, provider: provider.id, enabled: true })
    const outcome = await performWebSearch('人工智能 最新进展 中文', config, { force: true, signal: request.signal })
    if (controller === request) {
      testMessage.value = `连接成功，耗时 ${outcome.durationMs}ms，返回 ${outcome.results.length} 条结果`
      testResults.value = outcome.results
    }
  } catch (error) {
    if (controller === request && !request.signal.aborted) testError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (controller === request) { controller = null; testing.value = false }
  }
}
onUnmounted(() => controller?.abort())
</script>

<style>
@import '../../styles/dialog.css';
</style>
<style scoped>
.search-settings { padding: 16px 0 8px; }
.search-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.provider-list { display: flex; flex-direction: column; gap: 8px; }
.provider-item { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 4px; border: 1px solid var(--model-item-border); border-radius: 10px; background: var(--model-item-bg); color: var(--model-item-text); }
.provider-item:hover { background: var(--model-item-hover-bg); border-color: var(--model-item-hover-border); color: var(--model-item-hover-text); }
.provider-item.active { background: var(--model-item-active-bg); border-color: var(--model-item-active-border); color: var(--model-item-active-text); box-shadow: var(--model-item-active-shadow); }
.provider-select { display: flex; flex: 1 1 145px; min-width: 0; align-items: center; gap: 10px; padding: 5px 7px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; text-align: left; font: inherit; }
.provider-actions { display: flex; align-items: center; gap: 4px; margin-inline: auto 3px; }
.provider-action { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text-tertiary, #6e6e73); text-decoration: none; cursor: pointer; }
.provider-action:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.provider-select:focus-visible,
.provider-action:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.provider-icon { flex: 0 0 22px; display: flex; align-items: center; width: 22px; height: 22px; object-fit: contain; }
.provider-icon :deep(svg) { width: 100%; height: 100%; }
.provider-name { flex: 1; font-size: 14px; font-weight: 500; color: var(--model-item-name-text); }
.provider-selection { display: flex; align-items: center; justify-content: center; width: 8px; height: 8px; flex-shrink: 0; }
.provider-dot { width: 8px; height: 8px; border-radius: 50%; background: #f8bd40; }
.search-dialog { width: min(440px, 90vw); }
.search-dialog:focus { outline: none; }
.secret-input-row { position: relative; display: flex; align-items: center; }
.secret-input-row .form-input { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 40px 9px 11px; border: 1px solid transparent; border-radius: 8px; font-size: 13px; color: var(--text-primary); background: var(--form-input-bg, #F7F7F7); transition: border-color .2s ease, background-color .2s ease; }
.secret-input-row .form-input:hover { background: var(--form-input-hover-bg, #f0f0f0); border-color: var(--form-input-hover-border, transparent); }
.secret-input-row .form-input:focus { outline: none; border-color: var(--form-input-focus-border, #e3e3e3); box-shadow: none; }
.secret-input-row .form-input::-ms-reveal { display: none; }
.key-visibility { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; padding: 4px; line-height: 1; border: none; background: none; color: var(--text-secondary, #718096); cursor: pointer; transition: color .2s ease; }
.key-visibility:hover { color: var(--text-primary, #2d3748); }
.dialog-description { margin: 10px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.test-status { margin: 20px 0; color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
.test-status.is-error { color: var(--color-danger, #d14b4b); }
.test-status.is-success { color: var(--color-success, #2b8a57); }
.test-results { display: grid; gap: 10px; }
.test-result { display: grid; gap: 5px; min-width: 0; padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); text-decoration: none; transition: box-shadow .15s ease; }
.test-result:hover { box-shadow: 0 2px 6px color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent); }
.test-result-heading { display: flex; align-items: center; gap: 6px; min-width: 0; }
.test-result-icon { position: relative; display: flex; align-items: center; justify-content: center; flex: 0 0 14px; width: 14px; height: 14px; color: var(--text-secondary); }
.test-result-icon img { position: absolute; width: 14px; height: 14px; object-fit: contain; border-radius: 3px; background: var(--bg-secondary); }
.test-result-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 13px; font-weight: 500; }
.test-result-snippet { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--text-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.test-result-url { color: var(--color-primary, #667eea); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
