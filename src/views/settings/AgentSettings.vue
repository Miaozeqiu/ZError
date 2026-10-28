<template>
  <div class="agent-settings">
    <AgentSkillDetail
      v-if="selectedWebsite"
      :skill-id="selectedWebsite.skillId"
      :site-host="selectedWebsite.siteHost"
      :initial-path="selectedWebsitePath"
      @saved="refreshWebsites"
      @back="closeSkillDetail"
    />

    <template v-else>
    <nav class="agent-pane-nav" role="tablist" aria-label="Agent 设置">
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'websites'"
        :class="{ active: activePane === 'websites' }"
        @click="activePane = 'websites'"
      >
        网站
      </button>
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'behavior'"
        :class="{ active: activePane === 'behavior' }"
        @click="activePane = 'behavior'"
      >
        行为与权限
      </button>
    </nav>

    <template v-if="activePane === 'websites'">
      <div class="pane-intro">
        <p class="group-hint">按网站管理账号密码、操作经验和导航图谱。</p>
      </div>
      <div v-if="websiteError" class="install-error" role="alert">{{ websiteError }}</div>
      <div v-if="siteAccountsState.saveError" class="install-error" role="alert">{{ siteAccountsState.saveError }}</div>
      <div v-if="accountNamesError" class="install-error" role="alert">{{ accountNamesError }}</div>
      <div v-for="site in websites" :key="site.id" class="network-group website-card" :data-website="site.id">
        <header class="website-card-head">
          <div class="website-heading">
            <span class="website-icon" aria-hidden="true">
              <Icon v-if="websiteIconStatus.get(websiteIconSource(site)) !== 'loaded'" icon="lucide:globe" width="20" height="20" />
              <img
                v-if="websiteIconStatus.get(websiteIconSource(site)) !== 'failed'"
                :key="websiteIconSource(site)"
                :src="websiteIconSource(site)"
                :class="{ 'is-loaded': websiteIconStatus.get(websiteIconSource(site)) === 'loaded' }"
                alt="" loading="lazy" referrerpolicy="no-referrer"
                @load="websiteIconStatus.set(websiteIconSource(site), 'loaded')"
                @error="websiteIconStatus.set(websiteIconSource(site), 'failed')"
              >
            </span>
            <h3 class="website-name">{{ site.name }}</h3>
            <span class="website-host">{{ site.host }}</span>
          </div>
          <div class="account-actions">
            <span v-if="site.builtin" class="skill-badge builtin">内置</span>
            <button type="button" class="icon-btn" aria-label="网站设置" title="网站设置" @click="editWebsite(site)"><Icon icon="lucide:settings-2" width="16" height="16" aria-hidden="true" /></button>
          </div>
        </header>
        <div class="website-info-row">
          <div class="website-info-main">
            <span class="website-info-label">账号密码</span>
            <span class="website-info-value">{{ displayAccount(site.id) }}<span v-if="siteAccountsState.rows[site.id]?.password"> · ••••••</span></span>
            <span v-if="siteAccountsState.rows[site.id]?.note" class="website-note">{{ siteAccountsState.rows[site.id]?.note }}</span>
          </div>
          <div class="account-actions">
            <button type="button" class="icon-btn" :aria-label="siteAccountsState.rows[site.id] ? '编辑账号密码' : '配置账号密码'" :title="siteAccountsState.rows[site.id] ? '编辑账号密码' : '配置账号密码'" @click="openAccount(site)"><Icon :icon="siteAccountsState.rows[site.id] ? 'lucide:square-pen' : 'lucide:key-round'" width="16" height="16" aria-hidden="true" /></button>
            <button v-if="siteAccountsState.rows[site.id]" type="button" class="icon-btn danger" aria-label="清除账号密码" title="清除账号密码" @click="clearRow(site.id)"><Icon icon="lucide:trash" width="16" height="16" aria-hidden="true" /></button>
          </div>
        </div>
        <div class="website-info-row">
          <div class="website-info-main">
            <span class="website-info-label">操作经验</span>
            <span class="website-info-value">{{ site.files.includes(siteMainPath(site)) ? '已记录' : '尚未记录' }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="site.files.includes(siteMainPath(site)) ? '编辑操作经验' : '添加操作经验'" :title="site.files.includes(siteMainPath(site)) ? '编辑操作经验' : '添加操作经验'" @click="openWebsiteExperience(site)"><Icon :icon="site.files.includes(siteMainPath(site)) ? 'lucide:square-pen' : 'lucide:plus'" width="16" height="16" aria-hidden="true" /></button>
        </div>
        <div class="website-info-row">
          <div class="website-info-main">
            <span class="website-info-label">导航图谱</span>
            <span class="website-info-value">{{ site.files.includes(siteGraphPath(site)) ? '已生成' : '尚未生成' }}</span>
          </div>
          <button type="button" class="icon-btn" aria-label="编辑导航图谱" title="编辑导航图谱" :disabled="!site.files.includes(siteGraphPath(site))" @click="openWebsiteFile(site, siteGraphPath(site))"><Icon icon="lucide:square-pen" width="16" height="16" aria-hidden="true" /></button>
        </div>
      </div>
    </template>

    <AgentBehaviorSettings v-else />
    </template>

    <Teleport to="body">
      <div v-if="websiteDialogOpen" class="dialog-overlay" @click="closeWebsiteDialog">
        <form class="dialog-panel account-dialog" @click.stop @submit.prevent="submitWebsite">
          <div class="dialog-header">
            <button type="button" class="btn-back" :disabled="savingWebsite" @click="closeWebsiteDialog">取消</button>
            <h3 class="dialog-title">网站设置</h3>
            <button type="submit" class="btn-confirm" :disabled="savingWebsite || !websiteForm.host.trim()">{{ savingWebsite ? '保存中…' : '保存' }}</button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label" for="website-host">网站网址</label>
              <input id="website-host" v-model="websiteForm.host" class="form-input" placeholder="例如 example.com" autocomplete="url" required disabled @keydown.escape.prevent="closeWebsiteDialog">
            </div>
            <div class="form-group">
              <label class="form-label" for="website-name">网站名称</label>
              <input id="website-name" v-model="websiteForm.name" class="form-input" placeholder="可选，默认使用域名" :disabled="savingWebsite">
            </div>
            <div class="form-group">
              <label class="form-label" for="website-login-hosts">关联登录域名</label>
              <input id="website-login-hosts" v-model="websiteForm.loginHosts" class="form-input" placeholder="可选，多个域名用逗号分隔" :disabled="savingWebsite">
              <p class="group-hint">仅填写这个网站使用的登录域名，账号和操作经验会统一归到本站。</p>
            </div>
            <p v-if="websiteSaveError" class="install-error" role="alert">{{ websiteSaveError }}</p>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="dialogOpen" class="dialog-overlay" @click="closeDialog">
        <div class="dialog-panel account-dialog account-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" @click.stop @keydown.escape.prevent="closeDialog">
          <div class="dialog-header">
            <h3 id="account-dialog-title" class="dialog-title">{{ dialogMode === 'add' ? '添加账号' : '编辑账号' }}</h3>
          </div>
          <form class="dialog-body" @submit.prevent="submitDialog">
            <div v-if="pendingAccounts.length" class="pending-accounts">
              <p class="group-hint">选择一组待关联账号用于此网站</p>
              <button v-for="(pending, index) in pendingAccounts" :key="pending" type="button" class="text-btn" @click="bindPending(pending)">关联待保存账号 {{ index + 1 }}</button>
            </div>
            <p class="group-hint account-site-label">{{ accountSite?.name }} · {{ accountSite?.host }}</p>
            <div class="form-group">
              <label class="form-label" for="agent-acc-account">账号</label>
              <input id="agent-acc-account" ref="accountInputRef" v-model="form.account" class="form-input" type="text" autocomplete="off" spellcheck="false" placeholder="手机号 / 学号" :required="!siteAccountsState.rows[accountSite?.id || '']?.account" @keydown.escape.prevent="closeDialog" />
            </div>
            <div class="form-group">
              <label class="form-label" for="agent-acc-password">密码</label>
              <SecureSecretInput :key="`password-${accountSite?.id}`" id="agent-acc-password" v-model="form.password" label="密码" placeholder="登录密码" required @keydown.escape.prevent="closeDialog" />
            </div>
            <div class="account-dialog-footer">
              <button type="button" class="account-dialog-cancel" @click="closeDialog">取消</button>
              <button type="submit" class="btn-confirm" :disabled="!canSubmit()">{{ dialogMode === 'add' ? '添加' : '保存' }}</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import AgentSkillDetail from './AgentSkillDetail.vue'
import AgentBehaviorSettings from './AgentBehaviorSettings.vue'
import { agentSkillsState } from '../../services/agent/agentSkills'
import SecureSecretInput from '../../components/ui/SecureSecretInput.vue'
import { isNativeSecureStore, isSecretReference } from '../../services/security/secureStore'
import { forgetSiteAccount, rememberSiteAccount, siteAccountsState, refreshSiteAccounts } from '../../services/agent/siteAccounts'
import { addWebsiteSettings, listWebsiteSettings, type WebsiteSettingsItem } from '../../services/agent/websiteSettings'
import { websiteIdentityState } from '../../services/agent/websiteIdentity'

const emit = defineEmits<{ 'skill-detail-change': [open: boolean] }>()
const activePane = ref<'websites' | 'behavior'>('websites')
const websites = ref<WebsiteSettingsItem[]>([])
const websiteIconStatus = ref(new Map<string, 'loaded' | 'failed'>())
const websiteIconSource = (site: WebsiteSettingsItem) => site.iconUrl || `https://${site.host}/favicon.ico`
const websiteError = ref('')
let websiteRevision = 0
const refreshWebsites = async () => {
  const revision = ++websiteRevision
  try {
    const rows = await listWebsiteSettings()
    if (revision !== websiteRevision) return
    websites.value = rows
    websiteError.value = ''
  } catch (error) {
    if (revision === websiteRevision) websiteError.value = error instanceof Error ? error.message : '读取网站信息失败'
  }
}
watch(() => agentSkillsState.items, refreshWebsites, { immediate: true })
watch(() => Object.keys(siteAccountsState.rows).join('|'), refreshWebsites)
watch(() => websiteIdentityState.profiles, refreshWebsites)

// Usernames belong to this settings view only; shared Agent state keeps opaque references.
const accountNames = ref<Record<string, string>>({})
const accountNamesError = ref('')
let accountNamesRevision = 0
const refreshAccountNames = async () => {
  const revision = ++accountNamesRevision
  try {
    const hasSavedNames = Object.values(siteAccountsState.rows).some(row => isSecretReference(row?.account))
    const names = hasSavedNames && isNativeSecureStore() ? await invoke<Record<string, string>>('secure_site_account_names') : {}
    if (revision !== accountNamesRevision) return
    accountNames.value = names
    accountNamesError.value = ''
  } catch {
    if (revision === accountNamesRevision) accountNamesError.value = '读取用户名失败，请重新打开网站设置。'
  }
}
watch(() => Object.entries(siteAccountsState.rows).map(([id, row]) => [id, row?.account, row?.updatedAt]), () => { void refreshAccountNames() }, { immediate: true })
const accountName = (id: string) => {
  const reference = siteAccountsState.rows[id]?.account
  if (!reference) return ''
  return isSecretReference(reference) ? accountNames.value[id] || '' : reference
}
const displayAccount = (id: string) => accountName(id) || (siteAccountsState.rows[id]?.account ? '已保存账号' : '未配置')

const selectedWebsite = ref<WebsiteSettingsItem | null>(null)
const selectedWebsitePath = ref('')
watch(selectedWebsite, site => emit('skill-detail-change', Boolean(site)))
const siteMainPath = (site: WebsiteSettingsItem) => site.siteHost ? `sites/${site.siteHost}/SKILL.md` : 'SKILL.md'
const siteGraphPath = (site: WebsiteSettingsItem) => site.siteHost ? `sites/${site.siteHost}/site-graph.json` : 'site-graph.json'
const openWebsiteFile = (site: WebsiteSettingsItem, path: string) => {
  if (!site.files.includes(path)) return
  selectedWebsitePath.value = path
  selectedWebsite.value = site
}
const openWebsiteExperience = async (site: WebsiteSettingsItem) => {
  if (site.files.includes(siteMainPath(site))) return openWebsiteFile(site, siteMainPath(site))
  try {
    await addWebsiteSettings(site.host, site.name)
    await refreshWebsites()
    const updated = websites.value.find(row => row.id === site.id)
    if (updated) openWebsiteFile(updated, siteMainPath(updated))
  } catch (error) {
    websiteError.value = error instanceof Error ? error.message : '添加经验失败'
  }
}
const closeSkillDetail = () => { selectedWebsite.value = null; void refreshWebsites() }

const accountSite = ref<WebsiteSettingsItem | null>(null)
const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const accountInputRef = ref<HTMLInputElement | null>(null)
const pendingAccounts = computed(() => Object.keys(siteAccountsState.rows).filter(id => id.startsWith('pending-')))
const bindPending = async (pending: string) => {
  if (!accountSite.value) return
  try {
    await invoke('secure_bind_pending', { pending, site: accountSite.value.id })
    await refreshSiteAccounts()
    dialogOpen.value = false
  } catch { siteAccountsState.saveError = '账号关联失败，请解锁安全存储后重试。' }
}
const form = reactive({ account: '', password: '', note: '' })
const openAccount = async (site: WebsiteSettingsItem) => {
  accountSite.value = site
  const row = siteAccountsState.rows[site.id]
  dialogMode.value = row ? 'edit' : 'add'
  if (row?.account && isSecretReference(row.account) && !accountName(site.id)) await refreshAccountNames()
  Object.assign(form, { account: accountName(site.id), password: row?.password || '', note: row?.note || '' })
  dialogOpen.value = true
  await nextTick()
  accountInputRef.value?.focus()
}
const canSubmit = () => Boolean(accountSite.value && (form.account.trim() || siteAccountsState.rows[accountSite.value.id]?.account) && (form.password || siteAccountsState.rows[accountSite.value.id]?.password))
const closeDialog = () => { dialogOpen.value = false; Object.assign(form, { account: '', password: '', note: '' }) }
const submitDialog = () => {
  if (!canSubmit() || !accountSite.value) return
  rememberSiteAccount(accountSite.value.id, { account: form.account.trim() || siteAccountsState.rows[accountSite.value.id]?.account || '', password: form.password || siteAccountsState.rows[accountSite.value.id]?.password || '', note: form.note.trim() })
  closeDialog()
}
const clearRow = (id: string) => { forgetSiteAccount(id) }

const websiteDialogOpen = ref(false)
const savingWebsite = ref(false)
const websiteForm = reactive({ host: '', name: '', loginHosts: '' })
const websiteSaveError = ref('')
const editWebsite = (site: WebsiteSettingsItem) => {
  Object.assign(websiteForm, { host: site.host, name: site.name, loginHosts: (site.loginHosts || []).join(', ') })
  websiteSaveError.value = ''
  websiteDialogOpen.value = true
}
const closeWebsiteDialog = () => { if (!savingWebsite.value) websiteDialogOpen.value = false }
const submitWebsite = async () => {
  if (savingWebsite.value || !websiteForm.host.trim()) return
  savingWebsite.value = true
  websiteSaveError.value = ''
  try {
    await addWebsiteSettings(websiteForm.host, websiteForm.name,
      websiteForm.loginHosts.split(/[\s,，;；]+/).filter(Boolean), true)
    await refreshWebsites()
    websiteDialogOpen.value = false
  } catch (error) {
    websiteSaveError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    savingWebsite.value = false
  }
}
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.agent-pane-nav { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; padding: 12px 0 4px; }
.agent-pane-tab { border: none; background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 500; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.agent-pane-tab:hover, .agent-pane-tab.active { color: var(--text-primary); }
.pane-intro { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.group-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
.network-group { background: var(--network-group-bg); border: 1px solid var(--border-color); border-radius: 14px; padding: 0 16px; margin: 12px 0; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05); }
.website-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0 12px; }
.website-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.website-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 24px; color: var(--text-secondary); }
.website-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 5px; opacity: 0; }
.website-icon img.is-loaded { opacity: 1; }
.website-name { margin: 0; font-size: 14px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
.website-host { color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.skill-badge { font-size: 10px; line-height: 1; padding: 3px 6px; border-radius: 999px; background: var(--hover-bg, rgba(0, 0, 0, 0.05)); color: var(--text-secondary); flex-shrink: 0; }
.website-info-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-inline-start: 32px; padding: 12px 0; border-top: 1px solid var(--border-color); }
.website-info-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; min-width: 0; font-size: 12px; }
.website-info-label { color: var(--text-primary); font-weight: 500; }
.website-info-value { color: var(--text-secondary); overflow-wrap: anywhere; }
.website-note { flex-basis: 100%; color: var(--text-secondary); line-height: 1.5; overflow-wrap: anywhere; }
.account-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.account-site-label { margin-bottom: 16px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; flex-shrink: 0; transition: background-color 120ms ease, color 120ms ease, transform 120ms ease-out; }
.icon-btn:focus-visible { outline: 2px solid var(--color-primary, #3b82f6); outline-offset: 2px; transition: none; }
.icon-btn:active:not(:disabled):not(:focus-visible) { transform: scale(.97); }
.icon-btn:disabled { opacity: .45; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) {
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--hover-bg, rgba(0, 0, 0, .04)); }
  .icon-btn.danger:hover:not(:disabled) { color: var(--color-error, #c2410c); }
}
@media (prefers-reduced-motion: reduce) {
  .icon-btn { transition: none; }
  .icon-btn:active:not(:disabled):not(:focus-visible) { transform: none; }
}
.text-btn { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; padding: 4px 6px; border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.text-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--hover-bg, rgba(0, 0, 0, 0.04)); }
.text-btn.danger:hover { color: #c2410c; }
.text-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.install-error { margin: 8px 0; font-size: 12px; color: var(--color-error, #c2410c); overflow-wrap: anywhere; }
.account-dialog { width: 440px; max-width: calc(100vw - 32px); }
.account-editor-dialog { --account-corner: 24px; position: relative; border-radius: var(--account-corner); }
.account-editor-dialog .dialog-header { box-sizing: border-box; min-height: 48px; justify-content: center; padding: 12px 76px; }
.account-editor-dialog .dialog-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.account-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.account-dialog-cancel { border: none; border-radius: 999px; padding: 6px 14px; font-size: 14px; font-weight: 500; background: color-mix(in srgb, var(--text-primary) 10%, var(--platform-config-dialog-bg)); color: var(--text-primary); cursor: pointer; transition: background-color 150ms ease; }
.account-dialog-cancel:focus-visible { outline: 2px solid var(--color-primary, #3b82f6); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) {
  .account-dialog-cancel:hover { background: color-mix(in srgb, var(--text-primary) 15%, var(--platform-config-dialog-bg)); }
}
@media (prefers-reduced-motion: reduce) {
  .account-dialog-cancel { transition: none; }
}
.pwd-wrap { position: relative; display: flex; align-items: center; }
.pwd-wrap .form-input { padding-right: 56px; }
.pwd-toggle { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
</style>
