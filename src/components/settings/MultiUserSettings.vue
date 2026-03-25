<template>
  <div class="multiuser-settings">
    <h2 class="section-title">多用户设置</h2>

    <!-- 管理员 Token -->
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">管理员 Token</h3>
        <p class="setting-description">用于多用户场景下的管理员身份验证</p>
      </div>
      <div class="setting-control">
        <div class="input-group">
          <input
            :type="showAdminToken ? 'text' : 'password'"
            v-model="localToken"
            @change="handleTokenChange"
            class="form-input"
            placeholder="请输入管理员 Token"
          />
          <button class="toggle-btn" @click="showAdminToken = !showAdminToken" type="button">
            <svg v-if="!showAdminToken" width="16" height="16" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
              <path d="M512 192C268.8 192 64 512 64 512s204.8 320 448 320 448-320 448-320S755.2 192 512 192z m0 533.333333a213.333333 213.333333 0 1 1 0-426.666666 213.333333 213.333333 0 0 1 0 426.666666z m0-320a106.666667 106.666667 0 1 0 0 213.333334 106.666667 106.666667 0 0 0 0-213.333334z"/>
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
              <path d="M193.706667 147.626667l682.666666 682.666666-45.226666 45.226667-121.813334-121.813333C663.893333 786.773333 589.653333 810.666667 512 810.666667 268.8 810.666667 64 512 64 512s87.04-136.533333 213.333333-231.253333L147.626667 192l46.08-44.373333z"/>
            </svg>
          </button>
          <button class="gen-btn" @click="generateAdminToken" type="button">生成</button>
        </div>
      </div>
    </div>

    <div class="section-divider"></div>

    <!-- 用户管理 -->
    <div class="user-management">
      <div class="user-management-header">
        <h3 class="setting-title" style="margin:0">用户列表</h3>
        <button class="add-btn" @click="openAddDialog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          添加用户
        </button>
      </div>

      <div class="user-table-wrapper">
        <table class="user-table" v-if="users.length > 0">
          <thead>
            <tr>
              <th>用户名</th>
              <th>Token</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>{{ user.name }}</td>
              <td>
                <div class="token-cell">
                  <span class="token-text">{{ visibleTokens[user.id] ? user.token : maskToken(user.token) }}</span>
                  <button class="icon-btn" @click="toggleTokenVisible(user.id)" type="button">
                    <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                      <path v-if="!visibleTokens[user.id]" d="M512 192C268.8 192 64 512 64 512s204.8 320 448 320 448-320 448-320S755.2 192 512 192z m0 533.333333a213.333333 213.333333 0 1 1 0-426.666666 213.333333 213.333333 0 0 1 0 426.666666z m0-320a106.666667 106.666667 0 1 0 0 213.333334 106.666667 106.666667 0 0 0 0-213.333334z"/>
                      <path v-else d="M193.706667 147.626667l682.666666 682.666666-45.226666 45.226667-121.813334-121.813333C663.893333 786.773333 589.653333 810.666667 512 810.666667 268.8 810.666667 64 512 64 512s87.04-136.533333 213.333333-231.253333L147.626667 192l46.08-44.373333z"/>
                    </svg>
                  </button>
                  <button class="icon-btn" @click="copyToken(user.token)" type="button" title="复制">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 4h8a2 2 0 012 2v8M8 4a2 2 0 012-2h4a2 2 0 012 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </td>
              <td>{{ formatDate(user.createdAt) }}</td>
              <td>
                <div class="action-cell">
                  <button class="icon-btn edit-btn" @click="openEditDialog(user)" type="button" title="编辑">编辑</button>
                  <button class="icon-btn delete-btn" @click="deleteUser(user.id)" type="button" title="删除">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-tip">暂无用户，点击「添加用户」创建</div>
      </div>
    </div>

    <!-- 添加/编辑用户弹窗 -->
    <div class="dialog-overlay" v-if="dialogVisible" @click.self="dialogVisible = false">
      <div class="dialog">
        <div class="dialog-title">{{ editingUser ? '编辑用户' : '添加用户' }}</div>
        <div class="dialog-body">
          <div class="form-field">
            <label>用户名</label>
            <input type="text" v-model="form.name" class="form-input" placeholder="请输入用户名" />
          </div>
          <div class="form-field">
            <label>Token</label>
            <div class="input-group">
              <input :type="showFormToken ? 'text' : 'password'" v-model="form.token" class="form-input" placeholder="请输入或生成 Token" />
              <button class="toggle-btn" @click="showFormToken = !showFormToken" type="button">
                <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                  <path d="M512 192C268.8 192 64 512 64 512s204.8 320 448 320 448-320 448-320S755.2 192 512 192z m0 533.333333a213.333333 213.333333 0 1 1 0-426.666666 213.333333 213.333333 0 0 1 0 426.666666z m0-320a106.666667 106.666667 0 1 0 0 213.333334 106.666667 106.666667 0 0 0 0-213.333334z"/>
                </svg>
              </button>
              <button class="gen-btn" @click="form.token = generateToken()" type="button">生成</button>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="dialogVisible = false">取消</button>
          <button class="confirm-btn" @click="saveUser">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import type { UserConfig } from '../../services/settings'

const { settings, setSetting, saveSettings } = useSettingsManager()

const localToken = ref(settings.value.adminToken || '')
const showAdminToken = ref(false)
const visibleTokens = ref<Record<string, boolean>>({})

const users = computed(() => settings.value.multiUser?.users || [])

const handleTokenChange = async () => {
  setSetting('adminToken', localToken.value)
  await saveSettings()
}

const generateToken = () => {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

const generateAdminToken = async () => {
  localToken.value = generateToken()
  setSetting('adminToken', localToken.value)
  await saveSettings()
}

const toggleTokenVisible = (id: string) => {
  visibleTokens.value[id] = !visibleTokens.value[id]
}

const maskToken = (token: string) => {
  if (!token) return ''
  return token.slice(0, 4) + '••••••••' + token.slice(-4)
}

const copyToken = (token: string) => {
  navigator.clipboard.writeText(token)
}

const formatDate = (iso: string) => {
  return new Date(iso).toLocaleDateString('zh-CN')
}

// 弹窗
const dialogVisible = ref(false)
const showFormToken = ref(false)
const editingUser = ref<UserConfig | null>(null)
const form = ref({ name: '', token: '' })

const openAddDialog = () => {
  editingUser.value = null
  form.value = { name: '', token: generateToken() }
  showFormToken.value = true
  dialogVisible.value = true
}

const openEditDialog = (user: UserConfig) => {
  editingUser.value = user
  form.value = { name: user.name, token: user.token }
  showFormToken.value = false
  dialogVisible.value = true
}

const saveUser = async () => {
  if (!form.value.name.trim() || !form.value.token.trim()) return
  const current = [...(settings.value.multiUser?.users || [])]
  if (editingUser.value) {
    const idx = current.findIndex(u => u.id === editingUser.value!.id)
    if (idx !== -1) current[idx] = { ...current[idx], name: form.value.name, token: form.value.token }
  } else {
    current.push({
      id: crypto.randomUUID(),
      name: form.value.name,
      token: form.value.token,
      createdAt: new Date().toISOString()
    })
  }
  setSetting('multiUser', { ...settings.value.multiUser, users: current })
  await saveSettings()
  dialogVisible.value = false
}

const deleteUser = async (id: string) => {
  const current = (settings.value.multiUser?.users || []).filter(u => u.id !== id)
  setSetting('multiUser', { ...settings.value.multiUser, users: current })
  await saveSettings()
}

onMounted(() => {
  localToken.value = settings.value.adminToken || ''
})
</script>

<style scoped>
.multiuser-settings {
  padding: 0 4px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 24px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  gap: 24px;
}

.setting-info {
  flex: 1;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  margin: 0 0 4px;
}

.setting-description {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  margin: 0;
}

.setting-control {
  flex-shrink: 0;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.form-input {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #1a1a1a);
  min-width: 220px;
  outline: none;
}

.form-input:focus {
  border-color: var(--primary-color, #6366f1);
}

.toggle-btn, .icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
  font-size: 12px;
}

.toggle-btn:hover, .icon-btn:hover {
  background: var(--hover-bg, #f3f4f6);
}

.gen-btn {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.gen-btn:hover {
  background: var(--hover-bg, #f3f4f6);
}

.section-divider {
  height: 1px;
  background: var(--border-color, #e5e7eb);
  margin: 8px 0 24px;
}

.user-management {
  padding-top: 8px;
}

.user-management-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--primary-color, #6366f1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.add-btn:hover {
  opacity: 0.9;
}

.user-table-wrapper {
  overflow-x: auto;
}

.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.user-table th {
  text-align: left;
  padding: 8px 12px;
  background: var(--hover-bg, #f3f4f6);
  color: var(--text-secondary, #6b7280);
  font-weight: 500;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.user-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  color: var(--text-primary, #1a1a1a);
  vertical-align: middle;
}

.token-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.token-text {
  font-family: monospace;
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-cell {
  display: flex;
  gap: 4px;
}

.delete-btn {
  color: var(--text-secondary, #6b7280);
}

.delete-btn:hover {
  background: #fee2e2 !important;
  color: #ef4444 !important;
}

.edit-btn {
  color: var(--text-secondary, #6b7280);
}

.edit-btn:hover {
  background: #e0e7ff !important;
  color: #6366f1 !important;
}

.empty-tip {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--bg-primary, #fff);
  border-radius: 10px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 20px;
  color: var(--text-primary, #1a1a1a);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
}

.form-field .form-input {
  width: 100%;
  box-sizing: border-box;
  min-width: unset;
}

.form-field .input-group {
  width: 100%;
}

.form-field .input-group .form-input {
  flex: 1;
  min-width: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}

.cancel-btn {
  padding: 6px 18px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-primary, #1a1a1a);
}

.cancel-btn:hover {
  background: var(--hover-bg, #f3f4f6);
}

.confirm-btn {
  padding: 6px 18px;
  background: var(--primary-color, #6366f1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.confirm-btn:hover {
  opacity: 0.9;
}
</style>
