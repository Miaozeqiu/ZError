<template>
  <div class="secure-secret-field">
    <div class="secure-secret-row">
      <input
        :id="id" ref="input" class="form-input" :class="[inputClass, { 'is-saved-hidden': saved && !visible }]"
        :value="displayValue" :type="visible || kind === 'account' ? 'text' : 'password'"
        :placeholder="saved ? '••••••••' : placeholder"
        :aria-label="label" :autocomplete="autocomplete" :required="required && !saved"
        spellcheck="false" @focus="onFocus" @blur="onBlur" @input="onInput"
      />
      <div class="secret-actions">
        <button type="button" :disabled="busy || (!saved && !modelValue)" :aria-label="visible ? `隐藏${label}` : `查看${label}`" :title="visible ? `隐藏${label}` : `查看${label}`" :aria-pressed="visible" @mousedown.prevent @click="toggleVisible">
          <Icon :icon="visible ? 'lucide:eye-off' : 'lucide:eye'" width="16" height="16" />
        </button>
        <button type="button" :disabled="busy || (!saved && !modelValue)" :aria-label="`复制${label}`" :title="copied ? '已复制' : `复制${label}`" @mousedown.prevent @click="copy">
          <Icon :icon="copied ? 'lucide:check' : 'lucide:copy'" width="16" height="16" />
        </button>
      </div>
    </div>
    <p v-if="error" class="secret-feedback" role="status">{{ error }}</p>
    <span v-if="copied" class="sr-only" role="status">已复制</span>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import { isSecretReference } from '../../services/security/secureStore'

const props = withDefaults(defineProps<{
  modelValue: string; id?: string; label?: string; placeholder?: string; inputClass?: string
  kind?: 'account' | 'password' | 'api'; autocomplete?: string; required?: boolean
}>(), { label: '密码', placeholder: '', kind: 'password', autocomplete: 'off' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const input = ref<HTMLInputElement | null>(null)
const saved = computed(() => isSecretReference(props.modelValue))
const revealed = ref(''), visible = ref(false), busy = ref(false), copied = ref(false), error = ref('')
const editing = ref(false), dirty = ref(false), draft = ref('')
let generation = 0, hideTimer: ReturnType<typeof setTimeout> | undefined, copyTimer: ReturnType<typeof setTimeout> | undefined
const displayValue = computed(() => editing.value && dirty.value ? draft.value : saved.value ? revealed.value : props.modelValue)
const hide = () => {
  clearTimeout(hideTimer); revealed.value = ''; visible.value = false
}
const reset = () => { generation++; hide(); copied.value = false; error.value = ''; clearTimeout(copyTimer) }
const onFocus = () => { editing.value = true }
const onBlur = () => { hide(); editing.value = false; dirty.value = false; draft.value = '' }
const onInput = (event: Event) => {
  const showing = visible.value
  reset(); visible.value = showing; editing.value = true; dirty.value = true; draft.value = (event.target as HTMLInputElement).value
  emit('update:modelValue', draft.value)
}
const action = async (type: 'reveal' | 'copy') => {
  if (busy.value) return
  const current = ++generation, reference = props.modelValue
  error.value = ''; busy.value = true
  try {
    const result = await invoke<{ value?: string; copied?: boolean }>('secure_secret_action', { reference, action: type })
    if (current !== generation || reference !== props.modelValue) return
    if (type === 'reveal' && typeof result.value === 'string') {
      revealed.value = result.value; visible.value = true
      input.value?.focus()
      hideTimer = setTimeout(hide, 30_000)
    } else if (type === 'copy' && result.copied) markCopied()
  } catch (reason) {
    if (current === generation) {
      const message = reason instanceof Error ? reason.message : String(reason)
      error.value = message.startsWith('已取消系统验证') ? '' : message
    }
  } finally { busy.value = false }
}
const markCopied = () => { copied.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = false }, 2000) }
const toggleVisible = async () => {
  if (visible.value) { reset(); return }
  if (saved.value) await action('reveal')
  else visible.value = true // A new value typed by the user is already available to them.
}
const copy = async () => {
  if (saved.value) return action('copy') // Verification and clipboard write both stay native.
  try { await writeText(props.modelValue); markCopied() } catch { error.value = '无法写入剪贴板' }
}
watch(() => props.modelValue, value => {
  if (editing.value && dirty.value && (value === draft.value || isSecretReference(value))) return
  reset(); if (!editing.value) { dirty.value = false; draft.value = '' }
})
const onWindowBlur = () => { hide(); if (!busy.value) generation++ }
const onVisibility = () => { if (document.visibilityState === 'hidden') onWindowBlur() }
onMounted(() => { window.addEventListener('blur', onWindowBlur); document.addEventListener('visibilitychange', onVisibility) })
onBeforeUnmount(() => { reset(); draft.value = ''; window.removeEventListener('blur', onWindowBlur); document.removeEventListener('visibilitychange', onVisibility) })
defineExpose({ focus: () => input.value?.focus() })
</script>
<style scoped>
.secure-secret-field { min-width: 0; width: 100%; }
.secure-secret-row { position: relative; width: 100%; }
.secure-secret-row .form-input { width: 100%; box-sizing: border-box; padding-right: 70px; }
.secure-secret-row .form-input.is-saved-hidden::placeholder { color: var(--text-primary); opacity: 1; }
.secret-actions { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 4px; }
.secret-actions button { display: inline-flex; align-items: center; justify-content: center; padding: 4px; border: none; border-radius: 4px; background: transparent; color: var(--text-secondary, #718096); cursor: pointer; line-height: 1; }
.secret-actions button:hover:not(:disabled) { color: var(--text-primary, #2d3748); background: var(--hover-bg, #00000006); }
.secret-actions button:disabled { opacity: .45; cursor: default; }
.secret-feedback { margin: 6px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
