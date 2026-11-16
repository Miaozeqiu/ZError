<template>
  <div class="agent-settings">
    <AgentSkillDetail
      v-if="selectedWebsite"
      class="agent-website-detail"
      :skill-id="selectedWebsite.skillId"
      :site-host="selectedWebsite.siteHost"
      :initial-path="selectedWebsitePath"
      :initial-mode="selectedWebsiteMode"
      @saved="refreshWebsites"
      @back="closeSkillDetail"
    />

    <div v-else class="agent-settings-overview">
      <section aria-labelledby="agent-websites-heading">
        <div class="website-section-header">
          <h2 id="agent-websites-heading" class="agent-section-title">网站</h2>
          <button
            type="button"
            class="import-repository-button icon-action-btn icon-action-btn--add icon-action-btn--sm"
            title="导入 GitHub 仓库"
            aria-label="导入 GitHub 仓库"
            @click="openRepositoryImport"
          >
            <Icon icon="lucide:plus" width="16" height="16" aria-hidden="true" />
          </button>
        </div>
        <div v-if="websiteError" class="install-error" role="alert">{{ websiteError }}</div>
        <div v-if="siteAccountsState.saveError" class="install-error" role="alert">{{ siteAccountsState.saveError }}</div>
        <div v-if="accountNamesError" class="install-error" role="alert">{{ accountNamesError }}</div>
        <div v-if="websites.length" class="network-group">
          <div v-for="site in websites" :key="site.id" class="website-row" :data-website="site.id">
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
                <h3 class="website-name" :title="site.name">{{ site.name }}</h3>
                <span class="website-host" :title="site.host">{{ site.host }}</span>
              </div>
              <div class="website-actions">
                <button
                  v-if="site.repositoryHost" type="button" class="icon-btn" aria-label="编辑本地经验"
                  :title="'本地经验 · ' + (hasLocalExperience(site) ? '已记录' : '尚未记录')"
                  :disabled="!site.files.includes(siteMainPath(site))"
                  @click="openWebsiteFile(site, siteMainPath(site), 'local')"
                >
                  <Icon icon="lucide:notebook-pen" width="16" height="16" aria-hidden="true" />
                </button>
                <button
                  type="button" class="icon-btn"
                  :aria-label="siteAccountsState.rows[site.id] ? '编辑账号密码' : '配置账号密码'"
                  :title="siteAccountsState.rows[site.id] ? '账号密码 · 已配置' : '账号密码 · 未配置'"
                  @click="openAccount(site)"
                >
                  <Icon icon="lucide:key-round" width="16" height="16" aria-hidden="true" />
                </button>
                <button
                  type="button" class="icon-btn"
                  :aria-label="site.repositoryHost ? '查看操作经验' : site.files.includes(siteMainPath(site)) ? '编辑操作经验' : '添加操作经验'"
                  :title="'操作经验 · ' + experienceStatus(site)"
                  :disabled="Boolean(site.repositoryHost) && !site.files.includes(siteMainPath(site))"
                  @click="openWebsiteExperience(site)"
                >
                  <Icon icon="lucide:book-open" width="16" height="16" aria-hidden="true" />
                </button>
                <button
                  type="button" class="icon-btn" aria-label="编辑导航图谱"
                  :title="'导航图谱 · ' + (site.files.includes(siteGraphPath(site)) ? '已生成' : '尚未生成')"
                  :disabled="!site.files.includes(siteGraphPath(site))"
                  @click="openWebsiteFile(site, siteGraphPath(site))"
                >
                  <Icon icon="lucide:workflow" width="16" height="16" aria-hidden="true" />
                </button>
                <button type="button" class="icon-btn" aria-label="网站设置" title="网站设置" @click="editWebsite(site)">
                  <Icon icon="lucide:settings-2" width="16" height="16" aria-hidden="true" />
                </button>
              </div>
            </header>
            <p class="website-sync-status" role="status">{{ repositoryState(site)?.error }}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="agent-behavior-heading">
        <h2 id="agent-behavior-heading" class="agent-section-title">行为与权限</h2>
        <AgentBehaviorSettings />
      </section>
    </div>

    <Teleport to="body">
      <div v-if="repositoryImportOpen" class="dialog-overlay settings-popup" @click="closeRepositoryImport">
        <form class="dialog-panel account-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-import-title" @click.stop @submit.prevent="repositoryCandidates.length ? confirmRepositoryImport() : inspectRepository()" @keydown.escape.prevent="closeRepositoryImport">
          <div class="dialog-header"><h3 id="repository-import-title" class="dialog-title">导入 GitHub 网站仓库</h3></div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label" for="repository-import-url">仓库链接</label>
              <input id="repository-import-url" v-model="repositoryImportUrl" class="form-input" placeholder="https://github.com/用户名/网站仓库" :disabled="repositoryImportBusy" autocomplete="off" spellcheck="false" required>
            </div>
            <div v-if="repositoryCandidates.length" class="repository-candidates" role="radiogroup" aria-label="选择要导入的网站">
              <label v-for="(candidate, index) in repositoryCandidates" :key="candidate.website.host" class="repository-candidate">
                <input v-model="repositoryCandidateIndex" type="radio" :value="index" :disabled="repositoryImportBusy">
                <img :src="candidate.icon.dataUrl" alt="" width="28" height="28">
                <span><strong>{{ candidate.website.name }}</strong><span>{{ candidate.website.host }}</span></span>
              </label>
              <p class="group-hint">Agent 将参考所选网站的操作经验；修改只保存在本机。</p>
            </div>
            <p v-if="repositoryImportError" class="install-error" role="alert">{{ repositoryImportError }}</p>
            <div class="account-dialog-footer">
              <button type="button" class="account-dialog-cancel" :disabled="repositoryImportBusy" @click="closeRepositoryImport">取消</button>
              <button type="submit" class="btn-confirm" :disabled="repositoryImportBusy || !repositoryImportUrl.trim()">{{ repositoryImportBusy ? '处理中…' : repositoryCandidates.length ? '确认导入' : '读取仓库' }}</button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="websiteDialogOpen" class="dialog-overlay settings-popup" @click="closeWebsiteDialog">
        <form class="dialog-panel account-dialog" role="dialog" aria-modal="true" aria-labelledby="website-dialog-title" @click.stop @submit.prevent="submitWebsite" @keydown.escape.prevent="closeWebsiteDialog">
          <div class="dialog-header">
            <button type="button" class="btn-back" aria-label="返回" title="返回" :disabled="savingWebsite" @click="closeWebsiteDialog">
              <Icon icon="lucide:chevron-left" width="18" height="18" aria-hidden="true" />
            </button>
            <h3 id="website-dialog-title" class="dialog-title">网站设置</h3>
            <button type="submit" class="btn-confirm" :disabled="savingWebsite || !websiteForm.host.trim()">{{ savingWebsite ? '保存中…' : '保存' }}</button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label" for="website-host">网站网址</label>
              <input id="website-host" v-model="websiteForm.host" class="form-input" placeholder="例如 example.com" autocomplete="url" required disabled>
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
            <div class="form-group">
              <label class="form-label" for="website-experience-url">网站经验 HTTP 地址</label>
              <div class="website-source-input">
                <input id="website-experience-url" v-model="websiteForm.customUrl" type="url" class="form-input" placeholder="http://127.0.0.1:8817/experience.json" :disabled="savingWebsite" autocomplete="off" spellcheck="false" aria-describedby="website-experience-url-help" @input="websiteForm.scriptsEnabled = false">
                <button v-if="websiteForm.customUrl" type="button" class="account-dialog-cancel" :disabled="savingWebsite" @click="websiteForm.customUrl = ''; websiteForm.scriptsEnabled = false">恢复默认</button>
              </div>
              <p id="website-experience-url-help" class="group-hint">填写返回网站经验 JSON 的完整 HTTP 或 HTTPS 地址。留空{{ websiteForm.defaultSource }}。</p>
              <label v-if="websiteForm.customUrl.trim()" class="website-script-option">
                <input v-model="websiteForm.scriptsEnabled" type="checkbox" :disabled="savingWebsite">
                启用此来源的网站脚本
              </label>
            </div>
            <p v-if="websiteSaveError" class="install-error" role="alert">{{ websiteSaveError }}</p>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="dialogOpen" class="dialog-overlay settings-popup" @click="closeDialog">
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
              <button v-if="accountSite && siteAccountsState.rows[accountSite.id]" type="button" class="text-btn danger account-delete" @click="clearAccount">
                清除账号密码
              </button>
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
import { websiteRepositoryStates, repositoryRegistryState, previewWebsiteRepository, importWebsiteRepository, setWebsiteExperienceUrl, repositorySourceFor, type WebsiteRepositoryCandidate } from '../../services/agent/websiteRepository'

const emit = defineEmits<{ 'skill-detail-change': [open: boolean] }>()
const websites = ref<WebsiteSettingsItem[]>([])
const websiteIconStatus = ref(new Map<string, 'loaded' | 'failed'>())
const websiteIconSource = (site: WebsiteSettingsItem) => site.iconUrl || `https://${site.host}/favicon.ico`
const websiteError = ref('')
const repositoryState = (site: WebsiteSettingsItem) => site.repositoryHost ? websiteRepositoryStates[site.repositoryHost] : undefined
const hasLocalExperience = (site: WebsiteSettingsItem) => repositoryState(site)?.changedPaths.includes('SKILL.md') ?? false
const experienceStatus = (site: WebsiteSettingsItem) => {
  if (!site.repositoryHost) return site.files.includes(siteMainPath(site)) ? '已记录' : '尚未记录'
  const state = repositoryState(site)
  if (state?.customUrl) return '自定义 HTTP'
  if (state?.refreshing) return '同步中…'
  return state?.source === 'repository' ? '已同步' : '离线资料'
}
const repositoryImportOpen = ref(false), repositoryImportBusy = ref(false), repositoryImportUrl = ref(''), repositoryImportError = ref('')
const repositoryCandidates = ref<WebsiteRepositoryCandidate[]>([]), repositoryCandidateIndex = ref(0)
const openRepositoryImport = () => { repositoryImportUrl.value = ''; repositoryImportError.value = ''; repositoryCandidates.value = []; repositoryImportOpen.value = true }
const closeRepositoryImport = () => { if (!repositoryImportBusy.value) repositoryImportOpen.value = false }
watch(repositoryImportUrl, () => { repositoryCandidates.value = []; repositoryCandidateIndex.value = 0; repositoryImportError.value = '' })
const inspectRepository = async () => {
  repositoryImportBusy.value = true; repositoryImportError.value = ''
  try { repositoryCandidates.value = await previewWebsiteRepository(repositoryImportUrl.value) }
  catch (error) { repositoryImportError.value = error instanceof Error ? error.message : '读取仓库失败' }
  finally { repositoryImportBusy.value = false }
}
const confirmRepositoryImport = async () => {
  const candidate = repositoryCandidates.value[repositoryCandidateIndex.value]
  if (!candidate) return
  repositoryImportBusy.value = true; repositoryImportError.value = ''
  try { await importWebsiteRepository(candidate); await refreshWebsites(); repositoryImportOpen.value = false }
  catch (error) { repositoryImportError.value = error instanceof Error ? error.message : '导入失败，已有资料保持不变' }
  finally { repositoryImportBusy.value = false }
}
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
watch(() => repositoryRegistryState.revision, refreshWebsites)
watch(() => Object.entries(websiteRepositoryStates).map(([host, state]) => [host, state.version, state.iconUrl]), refreshWebsites)

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

const selectedWebsite = ref<WebsiteSettingsItem | null>(null)
const selectedWebsitePath = ref('')
const selectedWebsiteMode = ref<'view' | 'local'>('view')
watch(selectedWebsite, site => emit('skill-detail-change', Boolean(site)))
const siteMainPath = (site: WebsiteSettingsItem) => site.siteHost ? `sites/${site.siteHost}/SKILL.md` : 'SKILL.md'
const siteGraphPath = (site: WebsiteSettingsItem) => site.siteHost ? `sites/${site.siteHost}/site-graph.json` : 'site-graph.json'
const openWebsiteFile = (site: WebsiteSettingsItem, path: string, mode: 'view' | 'local' = 'view') => {
  if (!site.files.includes(path)) return
  selectedWebsitePath.value = path
  selectedWebsiteMode.value = mode
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
const clearAccount = () => {
  if (!accountSite.value || !siteAccountsState.rows[accountSite.value.id]) return
  forgetSiteAccount(accountSite.value.id)
  closeDialog()
}

const websiteDialogOpen = ref(false)
const savingWebsite = ref(false)
const websiteForm = reactive({ host: '', name: '', loginHosts: '', customUrl: '', defaultSource: '', scriptsEnabled: false })
const websiteSaveError = ref('')
const editWebsite = (site: WebsiteSettingsItem) => {
  Object.assign(websiteForm, { host: site.host, name: site.name, loginHosts: (site.loginHosts || []).join(', '),
    customUrl: repositoryState(site)?.customUrl ?? '', scriptsEnabled: repositoryState(site)?.scriptsEnabled === true,
    defaultSource: repositorySourceFor(site.host) ? '恢复默认仓库' : '使用应用中的网站经验' })
  websiteSaveError.value = ''
  websiteDialogOpen.value = true
}
const closeWebsiteDialog = () => { if (!savingWebsite.value) websiteDialogOpen.value = false }
const submitWebsite = async () => {
  if (savingWebsite.value || !websiteForm.host.trim()) return
  savingWebsite.value = true
  websiteSaveError.value = ''
  try {
    const site = websites.value.find(row => row.host === websiteForm.host)
    const loginHosts = websiteForm.loginHosts.split(/[\s,，;；]+/).filter(Boolean)
    const source = websiteRepositoryStates[websiteForm.host]
    if (websiteForm.customUrl.trim() !== (source?.customUrl ?? '') || websiteForm.scriptsEnabled !== Boolean(source?.scriptsEnabled)) {
      if (websiteForm.scriptsEnabled) await setWebsiteExperienceUrl(websiteForm.host, websiteForm.customUrl, true)
      else await setWebsiteExperienceUrl(websiteForm.host, websiteForm.customUrl)
    }
    if (websiteForm.name.trim() !== site?.name || loginHosts.join(',') !== (site?.loginHosts ?? []).join(',')) {
      await addWebsiteSettings(websiteForm.host, websiteForm.name, loginHosts, true)
    }
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

<style scoped src="../../styles/icon-action-button.css"></style>

<style scoped>
.agent-settings-overview { display: flex; flex-direction: column; gap: 20px; padding-top: 12px; }

.agent-section-title { margin: 0 0 8px; color: var(--text-primary); font-size: 14px; font-weight: 600; }
.website-section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.website-section-header .agent-section-title { margin: 0; }
.repository-candidates { display: flex; flex-direction: column; gap: 10px; }
.repository-candidate { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; }
.repository-candidate img { flex-shrink: 0; object-fit: contain; }
.repository-candidate > span { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.repository-candidate > span > span { color: var(--text-secondary); font-size: 12px; }
.group-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
.website-source-input { display: flex; align-items: center; gap: 6px; }
.website-source-input .form-input { flex: 1; min-width: 0; }
.website-source-input button { flex-shrink: 0; white-space: nowrap; }
.website-script-option { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.network-group { position: relative; background: var(--network-group-bg); border: 1px solid var(--border-color); border-radius: 14px; padding: 0 12px; margin: 8px 0; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05); }
.website-row { position: relative; }
.website-row + .website-row { border-top: 1px solid var(--border-color); }
.website-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; }
.website-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.website-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 24px; color: var(--text-secondary); }
.website-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 5px; opacity: 0; }
.website-icon img.is-loaded { opacity: 1; }
.website-name, .website-host { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.website-name { flex: 0 1 auto; margin: 0; font-size: 14px; font-weight: 500; color: var(--text-primary); }
.website-host { flex: 0 2 auto; color: var(--text-secondary); font-size: 12px; }
.website-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.website-sync-status { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); }
.account-site-label { margin-bottom: 16px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; flex-shrink: 0; transition: background-color 120ms ease, color 120ms ease, transform 120ms ease-out; }
.icon-btn:focus-visible { outline: 2px solid var(--color-primary, #3b82f6); outline-offset: 2px; transition: none; }
.icon-btn:active:not(:disabled):not(:focus-visible) { transform: scale(.97); }
.icon-btn:disabled { opacity: .45; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) {
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--hover-bg, rgba(0, 0, 0, .04)); }
}
@media (prefers-reduced-motion: reduce) {
  .icon-btn { transition: none; }
  .icon-btn:active:not(:disabled):not(:focus-visible) { transform: none; }
}
.text-btn { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; padding: 4px 6px; border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.text-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--hover-bg, rgba(0, 0, 0, 0.04)); }
.account-delete { margin-inline-end: auto; color: var(--color-error, #c2410c); }
.account-delete:hover:not(:disabled) { color: var(--color-error, #c2410c); }
.text-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.install-error { margin: 8px 0; font-size: 12px; color: var(--color-error, #c2410c); overflow-wrap: anywhere; }
.account-editor-dialog { --account-corner: 24px; position: relative; border-radius: var(--account-corner); }
.account-editor-dialog .dialog-header { box-sizing: border-box; min-height: 48px; justify-content: center; padding: 12px 76px; }
.account-editor-dialog .dialog-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.pwd-wrap { position: relative; display: flex; align-items: center; }
.pwd-wrap .form-input { padding-right: 56px; }
.pwd-toggle { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
</style>
