<template>
  <form class="login-card" aria-label="网站登录" @submit.prevent="submit">
    <header><strong>{{ request.name }}登录</strong><span>{{ request.origin }}</span></header>
    <p v-if="request.replacingRejectedCredentials" role="status">网站提示账号或密码有误，请重新填写。</p>
    <p>账号和密码将加密保存在本机，Agent 只能使用凭据引用。</p>
    <div class="fields">
      <label>
        账号
        <input
          ref="accountInput"
          class="form-input"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          :placeholder="request.canReuseAccount ? '留空沿用已保存的账号' : undefined"
          :required="!request.canReuseAccount"
          :disabled="busy"
        />
      </label>
      <label>密码<input ref="passwordInput" class="form-input" type="password" autocomplete="off" required :disabled="busy" /></label>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <footer>
      <button type="button" :disabled="busy" @click="cancelChatLogin(request.id)">取消</button>
      <button class="confirm" type="submit" :disabled="busy">{{ busy ? '保存中…' : '继续' }}</button>
    </footer>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { cancelChatLogin, submitChatLogin, type ChatLoginRequest } from '../../services/agent/chatLogin'

const props = defineProps<{ request: ChatLoginRequest }>()
const accountInput = ref<HTMLInputElement>()
const passwordInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref('')
async function submit() {
  const account = accountInput.value
  const password = passwordInput.value
  if (busy.value || !account || !password) return
  if (!account.value.trim() && !props.request.canReuseAccount) { account.focus(); return }
  busy.value = true
  error.value = ''
  try {
    await submitChatLogin(props.request, account.value, password.value)
    account.value = password.value = ''
  } catch {
    error.value = '未能保存，请确认网站登录域名正确且本机安全存储已解锁。'
  } finally { busy.value = false }
}
</script>

<style scoped>
@import '../../styles/dialog.css';

.login-card { box-sizing: border-box; width: min(100%, 320px); align-self: flex-start; padding: 14px 16px; border: 1px solid var(--border-primary); border-radius: 14px; background: var(--bg-secondary); color: var(--text-primary); }
header, footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
header span, p { color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
p { margin: 5px 0 12px; }
.fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
label { display: grid; gap: 6px; font-size: 13px; min-width: 0; }
.form-input { min-width: 0; }
footer { justify-content: flex-end; margin-top: 10px; }
button { cursor: pointer; border: 0; border-radius: 8px; padding: 6px 12px; color: var(--text-primary); background: var(--bg-primary); }
.confirm { background: var(--text-primary); color: var(--bg-primary); }
</style>
