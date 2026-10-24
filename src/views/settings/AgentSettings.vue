<template>
  <div class="agent-settings">
    <AgentSkillDetail
      v-if="selectedSkillId"
      :skill-id="selectedSkillId"
      :initial-mode="selectedSkillMode"
      @back="closeSkillDetail"
    />

    <template v-else>
    <nav class="agent-pane-nav" role="tablist" aria-label="Agent 设置">
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'accounts'"
        :class="{ active: activePane === 'accounts' }"
        @click="activePane = 'accounts'"
      >
        账号密码
      </button>
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'skills'"
        :class="{ active: activePane === 'skills' }"
        @click="activePane = 'skills'"
      >
        Skills
      </button>
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'policy'"
        :class="{ active: activePane === 'policy' }"
        @click="activePane = 'policy'"
      >
        权限
      </button>
      <button
        type="button"
        class="agent-pane-tab"
        role="tab"
        :aria-selected="activePane === 'agents'"
        :class="{ active: activePane === 'agents' }"
        @click="activePane = 'agents'"
      >
        Agents
      </button>
    </nav>

    <template v-if="activePane === 'accounts'">
    <div class="pane-intro">
      <p class="group-hint">Agent 登录学习通、智慧树、在浙学时会用这里的账号。也可在对话里说出账号密码自动记住；只说「密码是 xxx」时按当前网页站点更新。</p>
      <button
        type="button"
        class="add-btn"
        :disabled="!canAdd"
        :title="canAdd ? '添加账号' : '已添加全部平台账号'"
        @click="openAdd"
      >
        添加账号
      </button>
    </div>
    <div class="network-group">
      <div v-if="savedRows.length" class="account-list">
        <div
          v-for="row in savedRows"
          :key="row.id"
          class="account-row"
          role="button"
          tabindex="0"
          @click="openEdit(row.id)"
          @keydown.enter.prevent="openEdit(row.id)"
        >
          <div class="account-main">
            <div class="account-title">
              <span class="platform">{{ labels[row.id] }}</span>
              <span class="account">{{ row.account || '（未填账号）' }}</span>
            </div>
            <p v-if="row.note" class="account-meta">
              <span class="note">{{ row.note }}</span>
            </p>
          </div>
          <div class="account-actions" @click.stop>
            <button type="button" class="text-btn" @click="openEdit(row.id)">编辑</button>
            <button type="button" class="text-btn danger" @click="clearRow(row.id)">删除</button>
          </div>
        </div>
      </div>
      <div v-else class="empty-accounts">
        暂无账号，点击右上角「添加账号」录入。
      </div>
    </div>
    </template>

    <template v-else-if="activePane === 'skills'">
    <div class="pane-intro">
      <p class="group-hint">启用后，对应范围的 Agent 能看到这条 Skill 索引。执行前 Agent 会自己 read_agent_skill。点击进入详情查看与编辑文件。</p>
      <button type="button" class="add-btn" @click="openSkillInstall">安装</button>
    </div>
    <div class="network-group">
      <div v-if="skillRows.length" class="skill-list">
        <div
          v-for="skill in skillRows"
          :key="skill.id"
          class="skill-row"
          role="button"
          tabindex="0"
          @click="openSkillView(skill.id)"
          @keydown.enter.prevent="openSkillView(skill.id)"
        >
          <div class="skill-main">
            <div class="skill-title">
              <span class="skill-name">{{ skill.name }}</span>
              <span class="skill-badge" :class="skill.builtin ? 'builtin' : 'installed'">
                {{ skill.builtin ? '内置' : '已安装' }}
              </span>
              <span v-if="skill.customized" class="skill-badge customized">已修改</span>
              <span class="skill-badge scope">{{ scopeLabel(skill.scope) }}</span>
            </div>
            <p class="skill-desc">{{ skill.description || skill.id }}</p>
            <p v-if="skill.source" class="skill-source">{{ skill.source }}<span v-if="skill.sourcePath"> · {{ skill.sourcePath }}</span></p>
          </div>
          <div class="skill-actions" @click.stop>
            <Toggle
              :model-value="skill.enabled"
              size="small"
              @change="toggleSkill(skill.id, $event)"
            />
            <button type="button" class="text-btn" @click.stop="openSkillEdit(skill.id)">编辑</button>
            <button
              v-if="!skill.builtin"
              type="button"
              class="text-btn danger"
              @click="removeSkill(skill.id)"
            >
              卸载
            </button>
          </div>
        </div>
      </div>
      <div v-else class="empty-skills">
        暂无 Skill。可安装 GitHub 仓库里的 `.agents/skills/`。
      </div>
      <p v-if="agentSkillsState.installError" class="install-error">{{ agentSkillsState.installError }}</p>
    </div>
    </template>

    <template v-else-if="activePane === 'policy'">
      <p class="group-hint pane-intro-hint">低风险看页默认开。严格模式会拦作业页直接点填、以及顶层打开 iframe 地址。提交作业和写 Skill 默认先确认。</p>
      <div class="network-group policy-list">
        <label class="policy-row">
          <span class="policy-label">浏览器权限</span>
          <select class="form-input form-select" :value="agentPolicyState.permissionMode" @change="setAgentPolicy({ permissionMode: ($event.target as HTMLSelectElement).value as 'explore' | 'strict' })">
            <option value="explore">探索（默认，可看页、可探路）</option>
            <option value="strict">严格（作业页锁定填写）</option>
          </select>
        </label>
        <label class="policy-row">
          <span class="policy-label">写 Skill</span>
          <select class="form-input form-select" :value="agentPolicyState.writeSkills" @change="setAgentPolicy({ writeSkills: ($event.target as HTMLSelectElement).value as 'allow' | 'ask' | 'deny' })">
            <option value="ask">先确认</option>
            <option value="allow">允许</option>
            <option value="deny">禁止</option>
          </select>
        </label>
        <label class="policy-row">
          <span class="policy-label">提交作业</span>
          <select class="form-input form-select" :value="agentPolicyState.submit" @change="setAgentPolicy({ submit: ($event.target as HTMLSelectElement).value as 'ask' | 'allow' })">
            <option value="ask">先确认</option>
            <option value="allow">允许</option>
          </select>
        </label>
      </div>
    </template>

    <template v-else>
      <p class="group-hint pane-intro-hint">同一个 Agent 同时使用学习与网页能力。学习配置用于通用任务，浏览器配置的附加规则仅用于网页操作，两边启用的 Skill 会合并。可复制配置并设为对应能力的默认值。</p>
      <div class="pane-intro">
        <button type="button" class="add-btn" :disabled="!selectedProfile" @click="duplicateSelected">复制</button>
      </div>
      <div class="network-group">
        <div class="skill-list">
          <div
            v-for="profile in profileRows"
            :key="profile.id"
            class="skill-row"
            role="button"
            tabindex="0"
            :class="{ 'is-selected': selectedProfileId === profile.id }"
            @click="selectedProfileId = profile.id"
            @keydown.enter.prevent="selectedProfileId = profile.id"
          >
            <div class="skill-main">
              <div class="skill-title">
                <span class="skill-name">{{ profile.name }}</span>
                <span class="skill-badge" :class="profile.preset ? 'builtin' : 'installed'">
                  {{ profile.preset ? '预设' : '自定义' }}
                </span>
                <span v-if="isDefaultProfile(profile)" class="skill-badge customized">默认</span>
              </div>
              <p class="skill-desc">{{ profile.kind === 'browser' ? '网页操作能力' : '通用与学习能力' }}</p>
            </div>
          </div>
        </div>
        <div v-if="selectedProfile" class="profile-edit">
          <div class="form-group">
            <label class="form-label">名称</label>
            <input
              class="form-input"
              type="text"
              :value="selectedProfile.name"
              :disabled="Boolean(selectedProfile.preset)"
              @change="patchSelected({ name: ($event.target as HTMLInputElement).value })"
            >
          </div>
          <div class="form-group">
            <label class="form-label">附加规则</label>
            <textarea
              class="form-input profile-overlay"
              rows="4"
              :value="selectedProfile.systemOverlay"
              placeholder="只写额外原则，不要把整份 SOP 贴回来"
              @change="patchSelected({ systemOverlay: ($event.target as HTMLTextAreaElement).value })"
            />
          </div>
          <div v-if="selectedProfile.kind === 'browser'" class="form-group">
            <label class="form-label">领域工具</label>
            <select
              class="form-input form-select"
              :value="selectedProfile.toolPolicy.domain"
              @change="patchSelected({ toolPolicy: { domain: ($event.target as HTMLSelectElement).value as 'current-site' | 'always' | 'never' } })"
            >
              <option value="current-site">仅当前站点</option>
              <option value="always">始终带上</option>
              <option value="never">从不</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Skill 集</label>
            <p class="group-hint">不勾选任何项表示按范围继承已启用 Skill。</p>
            <label
              v-for="skill in skillsForSelected"
              :key="skill.id"
              class="profile-skill"
            >
              <input
                type="checkbox"
                :checked="selectedProfile.skillIds.length ? selectedProfile.skillIds.includes(skill.id) : skill.enabled"
                @change="toggleProfileSkill(skill.id, ($event.target as HTMLInputElement).checked)"
              >
              <span>{{ skill.name }}</span>
            </label>
          </div>
          <div class="account-actions">
            <button type="button" class="text-btn" @click="makeSelectedDefault">设为默认</button>
            <button v-if="selectedProfile.preset" type="button" class="text-btn" @click="resetSelected">恢复默认</button>
            <button v-else type="button" class="text-btn danger" @click="removeSelected">删除</button>
          </div>
        </div>
      </div>
    </template>
    </template>

    <Teleport to="body">
      <div v-if="skillDialogOpen" class="dialog-overlay" @click="closeSkillDialog">
        <div class="dialog-panel account-dialog" @click.stop>
          <div class="dialog-header">
            <button type="button" class="btn-back" title="取消" @click="closeSkillDialog">
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
                <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
              </svg>
            </button>
            <h3 class="dialog-title">安装 Skill</h3>
            <button
              type="button"
              class="btn-confirm"
              :disabled="!canInstallSkill || agentSkillsState.installing"
              @click="submitSkillInstall"
            >
              {{ agentSkillsState.installing ? '安装中…' : '安装' }}
            </button>
          </div>
          <form class="dialog-body" @submit.prevent="submitSkillInstall">
            <div class="form-group">
              <label class="form-label" for="agent-skill-source">GitHub 来源</label>
              <input
                id="agent-skill-source"
                ref="skillInputRef"
                v-model="skillSource"
                class="form-input"
                type="text"
                spellcheck="false"
                placeholder="owner/repo 或 GitHub 链接"
                required
                @keydown.escape.prevent="closeSkillDialog"
              >
            </div>
            <p class="dialog-hint">支持 `owner/repo`（安装仓库内全部 Skill）、`owner/repo/skill-name`，或 GitHub 目录链接。</p>
          </form>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="dialogOpen" class="dialog-overlay" @click="closeDialog">
        <div class="dialog-panel account-dialog" @click.stop>
          <div class="dialog-header">
            <button type="button" class="btn-back" title="取消" @click="closeDialog">
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
                <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
              </svg>
            </button>
            <h3 class="dialog-title">{{ dialogMode === 'add' ? '添加账号' : '编辑账号' }}</h3>
            <button
              type="button"
              class="btn-confirm"
              :disabled="!canSubmit"
              @click="submitDialog"
            >
              {{ dialogMode === 'add' ? '添加' : '保存' }}
            </button>
          </div>
          <form class="dialog-body" @submit.prevent="submitDialog">
            <div class="form-group">
              <label class="form-label" for="agent-acc-platform">平台</label>
              <select
                id="agent-acc-platform"
                v-model="form.platform"
                class="form-input form-select"
                :disabled="dialogMode === 'edit'"
                required
              >
                <option
                  v-for="id in platformOptions"
                  :key="id"
                  :value="id"
                >
                  {{ labels[id] }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="agent-acc-account">账号</label>
              <input
                id="agent-acc-account"
                ref="accountInputRef"
                v-model="form.account"
                class="form-input"
                type="text"
                autocomplete="username"
                spellcheck="false"
                placeholder="手机号 / 学号"
                required
                @keydown.escape.prevent="closeDialog"
              >
            </div>
            <div class="form-group">
              <label class="form-label" for="agent-acc-password">密码</label>
              <div class="pwd-wrap">
                <input
                  id="agent-acc-password"
                  v-model="form.password"
                  class="form-input"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  spellcheck="false"
                  placeholder="登录密码"
                  required
                  @keydown.escape.prevent="closeDialog"
                >
                <button
                  type="button"
                  class="text-btn pwd-toggle"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? '隐藏' : '显示' }}
                </button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="agent-acc-note">备注</label>
              <input
                id="agent-acc-note"
                v-model="form.note"
                class="form-input"
                type="text"
                spellcheck="false"
                placeholder="可选，如班级 / 学校"
                @keydown.escape.prevent="closeDialog"
              >
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Toggle from '../../components/ui/Toggle.vue'
import AgentSkillDetail from './AgentSkillDetail.vue'
import {
  agentSkillsState,
  installSkillFromGitHub,
  setSkillEnabled,
  uninstallSkill,
} from '../../services/agent/agentSkills'
import {
  SITE_ACCOUNT_IDS,
  SITE_ACCOUNT_LABELS,
  forgetSiteAccount,
  rememberSiteAccount,
  siteAccountsState,
  type SiteAccountId,
} from '../../services/agent/siteAccounts'
import { agentPolicyState, setAgentPolicy } from '../../services/agent/agentPolicy'
import {
  agentProfileState,
  deleteAgentProfile,
  duplicateAgentProfile,
  listAgentProfiles,
  resetAgentProfile,
  saveAgentProfile,
  setDefaultProfile,
  type AgentProfile,
} from '../../services/agent/agentProfiles'
import type { SkillScope } from '../../services/agent/agentSkills'

const emit = defineEmits<{
  'skill-detail-change': [open: boolean]
}>()

const labels = SITE_ACCOUNT_LABELS

const skillRows = computed(() => agentSkillsState.items)

const savedRows = computed(() => (
  SITE_ACCOUNT_IDS
    .map((id) => {
      const row = siteAccountsState.rows[id]
      if (!row || !(row.account || row.password || row.note)) return null
      return { id, account: row.account, password: row.password, note: row.note }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
))

const unusedPlatforms = computed(() => (
  SITE_ACCOUNT_IDS.filter((id) => !savedRows.value.some((row) => row.id === id))
))

const canAdd = computed(() => unusedPlatforms.value.length > 0)

const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const showPassword = ref(false)
const accountInputRef = ref<HTMLInputElement | null>(null)

const form = reactive({
  platform: 'chaoxing' as SiteAccountId,
  account: '',
  password: '',
  note: '',
})

const platformOptions = computed(() => {
  if (dialogMode.value === 'edit') return [form.platform]
  return unusedPlatforms.value
})

const canSubmit = computed(() => (
  Boolean(form.platform && form.account.trim() && form.password)
))

const openAdd = async () => {
  if (!canAdd.value) return
  dialogMode.value = 'add'
  form.platform = unusedPlatforms.value[0]
  form.account = ''
  form.password = ''
  form.note = ''
  showPassword.value = false
  dialogOpen.value = true
  await nextTick()
  accountInputRef.value?.focus()
}

const openEdit = async (id: SiteAccountId) => {
  const row = siteAccountsState.rows[id]
  if (!row) return
  dialogMode.value = 'edit'
  form.platform = id
  form.account = row.account || ''
  form.password = row.password || ''
  form.note = row.note || ''
  showPassword.value = false
  dialogOpen.value = true
  await nextTick()
  accountInputRef.value?.focus()
}

const closeDialog = () => {
  dialogOpen.value = false
}

const submitDialog = () => {
  if (!canSubmit.value) return
  rememberSiteAccount(form.platform, {
    account: form.account.trim(),
    password: form.password,
    note: form.note.trim(),
  })
  dialogOpen.value = false
}

const clearRow = (id: SiteAccountId) => {
  forgetSiteAccount(id)
}

const skillDialogOpen = ref(false)
const skillSource = ref('')
const skillInputRef = ref<HTMLInputElement | null>(null)

const canInstallSkill = computed(() => Boolean(skillSource.value.trim()))

const openSkillInstall = async () => {
  skillSource.value = ''
  agentSkillsState.installError = ''
  skillDialogOpen.value = true
  await nextTick()
  skillInputRef.value?.focus()
}

const closeSkillDialog = () => {
  if (agentSkillsState.installing) return
  skillDialogOpen.value = false
}

const submitSkillInstall = async () => {
  if (!canInstallSkill.value || agentSkillsState.installing) return
  try {
    await installSkillFromGitHub(skillSource.value.trim())
    skillDialogOpen.value = false
  } catch {
    // error shown in agentSkillsState.installError
  }
}

const toggleSkill = (id: string, enabled: boolean) => {
  setSkillEnabled(id, enabled)
}

const removeSkill = async (id: string) => {
  await uninstallSkill(id)
}

const activePane = ref<'accounts' | 'skills' | 'policy' | 'agents'>('accounts')
const selectedProfileId = ref('browser')

const profileRows = computed(() => listAgentProfiles())
const selectedProfile = computed(() => profileRows.value.find((item) => item.id === selectedProfileId.value) || null)
const skillsForSelected = computed(() => {
  const kind = selectedProfile.value?.kind
  return agentSkillsState.items.filter((item) => !kind || item.scope === 'both' || item.scope === kind)
})

const scopeLabel = (scope?: SkillScope) => {
  if (scope === 'browser') return '浏览器'
  if (scope === 'learning') return '学习'
  return '共用'
}

const isDefaultProfile = (profile: AgentProfile) => (
  (profile.kind === 'browser' && agentProfileState.defaultBrowserId === profile.id)
  || (profile.kind === 'learning' && agentProfileState.defaultLearningId === profile.id)
)

const patchSelected = (patch: Partial<AgentProfile>) => {
  const current = selectedProfile.value
  if (!current) return
  saveAgentProfile({
    ...current,
    ...patch,
    toolPolicy: patch.toolPolicy ? { ...current.toolPolicy, ...patch.toolPolicy } : current.toolPolicy,
  })
}

const toggleProfileSkill = (id: string, checked: boolean) => {
  const current = selectedProfile.value
  if (!current) return
  const base = current.skillIds.length
    ? [...current.skillIds]
    : skillsForSelected.value.filter((item) => item.enabled).map((item) => item.id)
  const next = checked ? [...new Set([...base, id])] : base.filter((item) => item !== id)
  patchSelected({ skillIds: next })
}

const duplicateSelected = () => {
  const current = selectedProfile.value
  if (!current) return
  const copy = duplicateAgentProfile(current.id)
  if (copy) selectedProfileId.value = copy.id
}

const makeSelectedDefault = () => {
  const current = selectedProfile.value
  if (!current) return
  setDefaultProfile(current.kind, current.id)
}

const resetSelected = () => {
  const current = selectedProfile.value
  if (!current?.preset) return
  resetAgentProfile(current.id)
}

const removeSelected = () => {
  const current = selectedProfile.value
  if (!current || current.preset) return
  deleteAgentProfile(current.id)
  selectedProfileId.value = current.kind
}
const selectedSkillId = ref('')
const selectedSkillMode = ref<'view' | 'edit'>('view')

watch(selectedSkillId, (id) => {
  emit('skill-detail-change', Boolean(id))
})

const openSkillDetail = (id: string, mode: 'view' | 'edit') => {
  activePane.value = 'skills'
  selectedSkillMode.value = mode
  selectedSkillId.value = id
}

const openSkillView = (id: string) => openSkillDetail(id, 'view')
const openSkillEdit = (id: string) => openSkillDetail(id, 'edit')

const closeSkillDetail = () => {
  selectedSkillId.value = ''
}

</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.agent-pane-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 4px;
  padding: 12px 0 4px;
}

.agent-pane-tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.agent-pane-tab:hover {
  color: var(--text-primary);
}

.agent-pane-tab.active {
  color: var(--text-primary);
}

.network-group {
  background: var(--network-group-bg);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0 14px;
  margin: 12px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}

.pane-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 8px;
}

.group-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.pane-intro-hint {
  margin: 0 0 8px;
}

.add-btn {
  flex-shrink: 0;
  margin-top: 0;
  padding: 5px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.add-btn:hover:not(:disabled) {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
  border-color: var(--border-secondary, var(--border-color));
}

.add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.account-list {
  margin-top: 4px;
}

.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid var(--border-color);
  cursor: pointer;
}

.account-row:first-child {
  border-top: none;
}

.account-row:hover .account-title {
  color: var(--color-accent, #667eea);
}

.account-main {
  min-width: 0;
  flex: 1;
}

.account-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.platform {
  flex-shrink: 0;
}

.account {
  font-weight: 400;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-meta {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note {
  color: var(--text-secondary);
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.text-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.text-btn:hover {
  color: var(--text-primary);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.text-btn.danger:hover {
  color: #c2410c;
}

.empty-accounts,
.empty-skills {
  padding: 18px 4px 10px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.skill-list {
  margin-top: 4px;
}

.skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid var(--border-color);
  cursor: pointer;
}

.skill-row:hover .skill-name {
  color: var(--color-accent, #667eea);
}

.skill-row:first-child {
  border-top: none;
}

.skill-main {
  min-width: 0;
  flex: 1;
}

.skill-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.skill-badge {
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary);
}

.skill-badge.builtin {
  color: #2563eb;
}

.skill-badge.installed {
  color: #0f766e;
}

.skill-badge.customized {
  color: #b45309;
}

.skill-badge.scope {
  color: var(--text-secondary);
}

.skill-row.is-selected .skill-name {
  color: var(--color-accent, #667eea);
}

.policy-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 0 16px;
}

.policy-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.policy-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.profile-edit {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profile-overlay {
  min-height: 88px;
  resize: vertical;
}

.profile-skill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  margin-top: 6px;
}

.skill-desc,
.skill-source {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.skill-source {
  opacity: 0.85;
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.install-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #c2410c;
}

.dialog-hint {
  margin: -8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.account-dialog {
  width: min(420px, 90vw);
  max-width: 420px;
}

.pwd-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pwd-wrap .form-input {
  flex: 1;
  min-width: 0;
}

.pwd-toggle {
  flex-shrink: 0;
}

.btn-confirm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.form-select {
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 16px) calc(50% - 2px), calc(100% - 11px) calc(50% - 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 28px;
}

.form-select:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
