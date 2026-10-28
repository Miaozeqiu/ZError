<template>
  <div class="search-settings">
    <h3 class="search-title">联网搜索</h3>
    <div class="provider-list">
      <button
        v-for="provider in providers" :key="provider.id" type="button"
        class="provider-item" :class="{ active: isSelected(provider.id) }"
        :aria-pressed="isSelected(provider.id)"
        @click="selectProvider(provider.id)" @contextmenu.prevent="openMenu($event, provider)"
      >
        <img v-if="provider.id === 'deepseek'" :src="deepseekIcon" class="provider-icon" alt="" />
        <span v-else class="provider-icon" v-html="exaIcon" aria-hidden="true"></span>
        <span class="provider-name">{{ provider.name }}</span>
        <span class="provider-selection"><span v-if="isSelected(provider.id)" class="provider-dot"></span></span>
      </button>
    </div>
    <UnifiedContextMenu
      :visible="menu.visible" :x="menu.x" :y="menu.y" :menu-items="menuItems"
      exclusive-key="search-provider-menu" @close="menu.visible = false" @item-click="onMenuItem"
    />
    <Teleport to="body">
      <div v-if="dialog && dialogProvider" class="dialog-overlay" @click.self="closeDialog" @keydown.esc.stop.prevent="closeDialog">
        <div ref="dialogPanel" class="dialog-panel search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" tabindex="-1">
          <div class="dialog-header">
            <button class="btn-back" type="button" title="关闭" @click="closeDialog"><Icon icon="lucide:chevron-left" width="18" height="18" /></button>
            <h3 id="search-dialog-title" class="dialog-title">{{ dialog === 'key' ? '配置' : '测试连接：' }}{{ dialogProvider.name }}</h3>
            <button class="btn-confirm" type="button" @click="dialog === 'key' ? saveKey() : closeDialog()">{{ dialog === 'key' ? '保存' : testing ? '停止' : '关闭' }}</button>
          </div>
          <div class="dialog-body">
            <template v-if="dialog === 'key'">
              <label class="form-label" for="search-key">API Key</label>
              <SecureSecretInput :key="dialogProvider.id" id="search-key" ref="keyInput" v-model="keyDraft" kind="api" label="API Key" :placeholder="`填写你的 ${dialogProvider.name} API Key`" @keydown.enter="saveKeyFromInput" />
              <button v-if="isSecretReference(search[dialogProvider.key])" type="button" class="clear-saved-key" @click="clearSavedKey">清除已保存的 API Key</button>
              <p class="dialog-description">{{ dialogProvider.id === 'deepseek' ? '使用 DeepSeek 开放平台的 API Key。' : '可选，留空使用免费限流搜索。' }}</p>
            </template>
            <template v-else>
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
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { isSecretReference } from '../../services/security/secureStore'
import SecureSecretInput from '../../components/ui/SecureSecretInput.vue'
import { nextTick, reactive, ref, toRef, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import UnifiedContextMenu, { type MenuItem } from '../../components/ui/UnifiedContextMenu.vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { DEFAULT_SEARCH_SETTINGS } from '../../services/app/settings'
import { performWebSearch, type SearchResultItem } from '../../services/searchService'
import deepseekIcon from '../../assets/search/deepseek.svg'
import exaIcon from '../../assets/search/exa.svg?raw'

type ProviderId = 'exa' | 'deepseek'
const providers = [
  { id: 'exa', name: 'Exa', key: 'apiKey' },
  { id: 'deepseek', name: 'DeepSeek', key: 'deepseekApiKey' },
] as const
type Provider = typeof providers[number]
const { settings, setSetting } = useSettingsManager()
if (!settings.value.search) setSetting('search', { ...DEFAULT_SEARCH_SETTINGS })
const search = toRef(settings.value, 'search')
if (!search.value.provider) search.value.provider = 'exa'
const isSelected = (id: ProviderId) => search.value.enabled && search.value.provider === id
const selectProvider = (id: ProviderId) => {
  const selected = isSelected(id)
  search.value.provider = id
  search.value.enabled = !selected
}
const menu = reactive({ visible: false, x: 0, y: 0 })
const menuProvider = ref<Provider>(providers[0])
const menuItems: MenuItem[] = [
  { id: 'key', label: '配置 API Key', action: 'key' },
  { id: 'test', label: '开始测试', action: 'test' },
]
const openMenu = (event: MouseEvent, provider: Provider) => {
  menuProvider.value = provider
  Object.assign(menu, { visible: true, x: event.clientX, y: event.clientY })
}
const dialog = ref<'key' | 'test' | null>(null)
const dialogProvider = ref<Provider | null>(null)
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
const onMenuItem = async (item: MenuItem) => {
  menu.visible = false
  if (item.action !== 'key' && item.action !== 'test') return
  dialogProvider.value = menuProvider.value
  keyDraft.value = search.value[menuProvider.value.key] || ''
  testError.value = ''
  testMessage.value = ''
  testResults.value = []
  dialog.value = item.action
  await nextTick()
  const focusTarget = dialog.value === 'key' ? keyInput.value : dialogPanel.value
  focusTarget?.focus()
  if (dialog.value === 'test') void runTest()
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
  if (keyDraft.value.trim() || !isSecretReference(search.value[dialogProvider.value.key])) search.value[dialogProvider.value.key] = keyDraft.value.trim()
  closeDialog()
}
const saveKeyFromInput = (event: KeyboardEvent) => {
  if (!(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  saveKey()
}
const clearSavedKey = () => {
  if (dialogProvider.value) search.value[dialogProvider.value.key] = ''
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
    const outcome = await performWebSearch('人工智能 最新进展 中文', { ...search.value, provider: provider.id, enabled: true }, { force: true, signal: request.signal })
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
.clear-saved-key { margin-top: 10px; padding: 0; border: 0; background: transparent; color: var(--danger-color, #c43b36); cursor: pointer; font: inherit; font-size: 13px; }
.search-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.provider-list { display: flex; flex-direction: column; gap: 8px; }
.provider-item { display: flex; align-items: center; gap: 12px; padding: 7px 10px; width: 100%; border: 1px solid var(--model-item-border); border-radius: 10px; background: var(--model-item-bg); color: var(--model-item-text); cursor: pointer; text-align: left; font: inherit; transition: background .2s ease, border-color .2s ease, box-shadow .2s ease; }
.provider-item:hover { background: var(--model-item-hover-bg); border-color: var(--model-item-hover-border); color: var(--model-item-hover-text); }
.provider-item.active { background: var(--model-item-active-bg); border-color: var(--model-item-active-border); color: var(--model-item-active-text); box-shadow: var(--model-item-active-shadow); }
.provider-icon { flex: 0 0 22px; display: flex; align-items: center; width: 22px; height: 22px; object-fit: contain; }
.provider-icon :deep(svg) { width: 100%; height: 100%; }
.provider-name { flex: 1; font-size: 14px; font-weight: 500; color: var(--model-item-name-text); }
.provider-selection { display: flex; align-items: center; justify-content: center; width: 8px; height: 8px; flex-shrink: 0; }
.provider-dot { width: 8px; height: 8px; border-radius: 50%; background: #f8bd40; }
.search-dialog { width: min(440px, 90vw); }
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
