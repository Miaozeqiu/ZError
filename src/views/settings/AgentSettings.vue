<template>
  <div class="agent-settings">
    <AgentSkillDetail
      v-if="selectedWebsite"
      class="agent-website-detail"
      :skill-id="selectedWebsite.skillId"
      :site-host="selectedWebsite.siteHost"
      :initial-path="siteMainPath(selectedWebsite)"
      @saved="refreshWebsites"
      @back="closeSkillDetail"
    />

    <AgentImportTemplateManager v-else-if="importTemplatesOpen" @back="importTemplatesOpen = false" />

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
          <div v-for="site in websites" :key="site.id" class="website-row" :data-website="site.id"
            tabindex="0" aria-haspopup="menu" :aria-expanded="menu.siteId === site.id"
            @contextmenu.stop.prevent="openWebsiteMenu(site, $event)"
            @keydown.shift.f10.prevent="openWebsiteMenu(site, $event)"
            @keydown.enter.self.prevent="openWebsiteMenu(site, $event)"
          >
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
                <span class="website-host" :title="site.domains.join(', ')">{{ site.domains.join(', ') }}</span>
              </div>
            </header>
            <p class="website-sync-status" role="status">{{ repositoryState(site)?.error }}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="agent-behavior-heading">
        <h2 id="agent-behavior-heading" class="agent-section-title">行为与权限</h2>
        <AgentBehaviorSettings @manage-import-templates="importTemplatesOpen = true" />
      </section>
    </div>

    <UnifiedContextMenu :visible="Boolean(menuSite)" :x="menu.x" :y="menu.y" :menu-items="websiteMenuItems"
      exclusive-key="website-settings-menu" menu-class="website-context-menu settings-popup"
      @close="menu.siteId = ''" @item-click="selectWebsiteAction" />

    <Teleport to="body">
      <div v-if="deletionTarget" class="dialog-overlay settings-popup" @click.self="cancelDeletion">
        <div class="dialog-panel account-dialog" role="alertdialog" aria-modal="true" aria-labelledby="website-delete-title"
          aria-describedby="website-delete-description" @keydown.esc.prevent="cancelDeletion">
          <div class="dialog-header"><h3 id="website-delete-title" class="dialog-title">删除「{{ deletionTarget.name }}」？</h3></div>
          <div class="dialog-body">
            <p id="website-delete-description">将永久清除 {{ deletionTarget.host }} 的本地配置、已保存的账号密码和本地经验（含导航图谱）。</p>
            <p v-if="deletionError" class="install-error" role="alert">{{ deletionError }}</p>
            <div class="account-dialog-footer">
              <button ref="deleteCancel" type="button" class="account-dialog-cancel" :disabled="deleting" @click="cancelDeletion">取消</button>
              <button type="button" class="btn-confirm website-delete-confirm" :disabled="deleting" @click="confirmDeletion">{{ deleting ? '删除中…' : '删除' }}</button>
            </div>
          </div>
        </div>
      </div>
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
        <form class="dialog-panel account-dialog website-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="website-dialog-title" @click.stop @submit.prevent="submitWebsite" @keydown.escape.prevent="closeWebsiteDialog">
          <div class="dialog-header">
            <h3 id="website-dialog-title" class="dialog-title">网站设置</h3>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label" for="website-domains">网站域名</label>
              <div v-if="websiteForm.domains.length" class="website-domains">
                <span v-for="domain in websiteForm.domains" :key="domain" class="website-domain">
                  {{ domain }}
                  <button v-if="!identityLocked" type="button" :aria-label="'移除 ' + domain" :disabled="savingWebsite" @click="websiteForm.domains = websiteForm.domains.filter(item => item !== domain)">
                    <Icon icon="lucide:x" width="12" height="12" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <div v-if="!identityLocked" class="website-domain-entry">
                <input id="website-domains" v-model="domainInput" class="form-input" placeholder="例如 example.com" autocomplete="off" spellcheck="false" :disabled="savingWebsite" @keydown.enter.prevent="addDomains">
                <button type="button" class="account-dialog-cancel" :disabled="savingWebsite || !domainInput.trim()" @click="addDomains">添加</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="website-name">网站名称</label>
              <input id="website-name" v-model="websiteForm.name" class="form-input" placeholder="可选，默认使用域名" :disabled="savingWebsite || identityLocked">
            </div>
            <div class="form-group">
              <label class="form-label" for="website-experience-url">网站经验 HTTP 地址</label>
              <input id="website-experience-url" v-model="websiteForm.customUrl" type="url" class="form-input" placeholder="http://127.0.0.1:8817/experience.json" :disabled="savingWebsite" autocomplete="off" spellcheck="false">
            </div>
            <p v-if="websiteSaveError" class="install-error" role="alert">{{ websiteSaveError }}</p>
          </div>
          <footer class="account-dialog-footer">
            <button type="button" class="account-dialog-cancel" :disabled="savingWebsite" @click="closeWebsiteDialog">取消</button>
            <button type="submit" class="btn-confirm" :disabled="savingWebsite || !websiteForm.host.trim()">{{ savingWebsite ? '保存中…' : '保存' }}</button>
          </footer>
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
import { defineAsyncComponent, computed, nextTick, reactive, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import UnifiedContextMenu, { type MenuItem } from '../../components/ui/UnifiedContextMenu.vue'
import AgentBehaviorSettings from './AgentBehaviorSettings.vue'
import { agentSkillsState } from '../../services/agent/agentSkills'
import SecureSecretInput from '../../components/ui/SecureSecretInput.vue'
import { isNativeSecureStore, isSecretReference } from '../../services/security/secureStore'
import { forgetSiteAccount, rememberSiteAccount, siteAccountsState, refreshSiteAccounts } from '../../services/agent/siteAccounts'
import { addWebsiteSettings, listWebsiteSettings, deleteWebsiteSettings, type WebsiteSettingsItem } from '../../services/agent/websiteSettings'
import { normalizeWebsiteHost, websiteIdentityState } from '../../services/agent/websiteIdentity'
import {
  isRequiredWebsiteRepository,
  websiteIdentityLocked,
  websiteRepositoryStates,
  repositoryRegistryState,
  previewWebsiteRepository,
  importWebsiteRepository,
  setWebsiteExperienceUrl,
  type WebsiteRepositoryCandidate,
} from '../../services/agent/websiteRepository'

const AgentSkillDetail = defineAsyncComponent(() => import('./AgentSkillDetail.vue').then(module => module.default))
const AgentImportTemplateManager = defineAsyncComponent(() => import('./AgentImportTemplateManager.vue'))

const emit = defineEmits<{ 'skill-detail-change': [open: boolean] }>()
const websites = ref<WebsiteSettingsItem[]>([])
const websiteIconStatus = ref(new Map<string, 'loaded' | 'failed'>())
const websiteIconSource = (site: WebsiteSettingsItem) => site.iconUrl || `https://${site.host}/favicon.ico`
const websiteError = ref('')
const repositoryState = (site: WebsiteSettingsItem) => site.repositoryHost ? websiteRepositoryStates[site.repositoryHost] : undefined
const experienceStatus = (site: WebsiteSettingsItem) => {
  if (!site.repositoryHost) return site.files.includes(siteMainPath(site)) ? '已记录' : '尚未记录'
  const state = repositoryState(site)
  if (state?.customUrl) return '自定义 HTTP'
  if (state?.refreshing) return '同步中…'
  return state?.source === 'repository' ? '已同步' : '离线资料'
}
const menu = reactive({ siteId: '', x: 0, y: 0 })
const menuSite = computed(() => websites.value.find(site => site.id === menu.siteId))
const websiteMenuItems = computed<MenuItem[]>(() => {
  const site = menuSite.value
  if (!site) return []
  const main = site.files.includes(siteMainPath(site))
  const required = isRequiredWebsiteRepository(site.host)
  return [
    { action: 'account', icon: 'lucide:key-round', label: '账号密码' },
    { action: 'experience', icon: 'lucide:book-open', label: '操作经验', title: '操作经验 · ' + experienceStatus(site), disabled: Boolean(site.repositoryHost) && !main },
    { action: 'settings', icon: 'lucide:settings-2', label: '网站设置' },
    { id: 'separator', type: 'divider' },
    { id: 'delete', action: 'delete', icon: 'lucide:trash', label: '删除', ariaLabel: '删除网站', danger: true, disabled: required, title: required ? '学习通是默认仓库，不能删除' : undefined },
  ]
})
const openWebsiteMenu = async (site: WebsiteSettingsItem, event: MouseEvent | KeyboardEvent) => {
  const row = event.currentTarget as HTMLElement
  const keyboard = event instanceof KeyboardEvent || (!event.clientX && !event.clientY)
  const rect = row.getBoundingClientRect()
  Object.assign(menu, { siteId: site.id, x: keyboard ? rect.left : event.clientX, y: keyboard ? rect.bottom : event.clientY })
  if (keyboard) {
    await nextTick()
    document.querySelector<HTMLElement>('.website-context-menu [role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }
}
const deletionTarget = ref<WebsiteSettingsItem | null>(null)
const deleting = ref(false)
const deletionError = ref('')
const deleteCancel = ref<HTMLButtonElement | null>(null)
const selectWebsiteAction = async (item: MenuItem) => {
  const site = menuSite.value
  if (!site || item.disabled) return
  menu.siteId = ''
  switch (item.action) {
    case 'account': return openAccount(site)
    case 'experience': return openWebsiteExperience(site)
    case 'settings': return editWebsite(site)
    case 'delete':
      deletionError.value = ''
      deletionTarget.value = site
      await nextTick()
      deleteCancel.value?.focus()
  }
}
const cancelDeletion = () => { if (!deleting.value) deletionTarget.value = null }
const confirmDeletion = async () => {
  if (!deletionTarget.value || deleting.value) return
  deleting.value = true
  deletionError.value = ''
  try {
    await deleteWebsiteSettings(deletionTarget.value.host)
    await refreshWebsites()
    deletionTarget.value = null
  } catch (error) {
    deletionError.value = error instanceof Error ? error.message : String(error)
  } finally { deleting.value = false }
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
const importTemplatesOpen = ref(false)
watch(() => Boolean(selectedWebsite.value) || importTemplatesOpen.value, open => emit('skill-detail-change', open))
const siteMainPath = (site: WebsiteSettingsItem) => site.siteHost ? `sites/${site.siteHost}/SKILL.md` : 'SKILL.md'
const openWebsiteExperience = async (site: WebsiteSettingsItem) => {
  if (site.files.includes(siteMainPath(site))) {
    selectedWebsite.value = site
    return
  }
  try {
    await addWebsiteSettings(site.host, site.name)
    await refreshWebsites()
    const updated = websites.value.find(row => row.id === site.id)
    if (updated && updated.files.includes(siteMainPath(updated))) selectedWebsite.value = updated
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
const websiteForm = reactive({ host: '', name: '', domains: [] as string[], customUrl: '' })
const websiteSaveError = ref('')
const domainInput = ref('')
const identityLocked = computed(() => websiteIdentityLocked(websiteForm.host, websiteForm.customUrl))
watch(identityLocked, locked => {
  if (!locked) return
  const site = websites.value.find(row => row.host === websiteForm.host)
  if (site) {
    websiteForm.name = site.name
    websiteForm.domains = [...site.domains]
  }
  domainInput.value = ''
  websiteSaveError.value = ''
})
const addDomains = () => {
  const domains = domainInput.value.split(/[\s,，;；]+/).filter(Boolean)
  const normalized: string[] = []
  for (const value of domains) {
    const host = normalizeWebsiteHost(value)
    if (!host) {
      websiteSaveError.value = `域名无效：${value}`
      return false
    }
    normalized.push(host)
  }
  websiteForm.domains = [...new Set([...websiteForm.domains, ...normalized])]
  domainInput.value = ''
  websiteSaveError.value = ''
  return true
}
const editWebsite = (site: WebsiteSettingsItem) => {
  Object.assign(websiteForm, { host: site.host, name: site.name, domains: [...site.domains],
    customUrl: repositoryState(site)?.customUrl ?? '' })
  websiteSaveError.value = ''
  domainInput.value = ''
  websiteDialogOpen.value = true
}
const closeWebsiteDialog = () => { if (!savingWebsite.value) websiteDialogOpen.value = false }
const submitWebsite = async () => {
  if (savingWebsite.value || !websiteForm.host || (!identityLocked.value && !addDomains())) return
  savingWebsite.value = true
  websiteSaveError.value = ''
  try {
    const site = websites.value.find(row => row.host === websiteForm.host)
    const source = websiteRepositoryStates[websiteForm.host]
    if (websiteForm.customUrl.trim() !== (source?.customUrl ?? '')) {
      await setWebsiteExperienceUrl(websiteForm.host, websiteForm.customUrl)
    }
    if (!identityLocked.value && (websiteForm.name.trim() !== site?.name || websiteForm.domains.join(',') !== site?.domains.join(','))) {
      await addWebsiteSettings(websiteForm.host, websiteForm.name, websiteForm.domains, true)
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

.website-settings-dialog { display: flex; flex-direction: column; }
.website-settings-dialog > .dialog-header { flex: none; justify-content: center; }
.website-settings-dialog > .dialog-body { min-height: 0; padding-bottom: 16px; }
.website-settings-dialog .form-group:last-of-type { margin-bottom: 0; }
.website-settings-dialog > .account-dialog-footer { flex: none; padding: 0 24px 18px; }
.website-domains { display: flex; flex-wrap: wrap; gap: 6px; }
.website-domain { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 8px; border-radius: 6px; background: var(--form-input-bg, #f7f7f7); color: var(--text-secondary); font-size: 13px; overflow-wrap: anywhere; }
.website-domain button { display: inline-flex; padding: 2px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.website-domain-entry { display: flex; align-items: stretch; gap: 8px; }
.website-domains + .website-domain-entry { margin-top: 8px; }
.website-domain-entry .form-input { flex: 1; min-width: 0; }
.website-domain-entry button { flex: none; border-radius: 8px; }
.website-domain-entry button:disabled { opacity: .45; cursor: default; }

.agent-section-title { margin: 0 0 8px; color: var(--text-primary); font-size: 14px; font-weight: 600; }
.website-section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.website-section-header .agent-section-title { margin: 0; }
.repository-candidates { display: flex; flex-direction: column; gap: 10px; }
.repository-candidate { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; }
.repository-candidate img { flex-shrink: 0; object-fit: contain; }
.repository-candidate > span { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.repository-candidate > span > span { color: var(--text-secondary); font-size: 12px; }
.group-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
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
.website-row:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: 6px; }
.website-delete-confirm { background: var(--color-error, #be3030); }
.website-sync-status { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); }
.account-site-label { margin-bottom: 16px; }
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
