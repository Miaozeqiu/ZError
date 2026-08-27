<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click="emit('close')">
      <div class="dialog-panel create-form-panel" @click.stop>
        <div class="dialog-header">
          <button class="btn-back" type="button" title="取消" @click="emit('close')">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
              <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
            </svg>
          </button>
          <h3 class="dialog-title">{{ title }}</h3>
          <button class="btn-confirm" type="button" :disabled="!canSubmit" @click="submit">{{ confirmText }}</button>
        </div>
        <form class="dialog-body" @submit.prevent="submit">
          <div v-for="field in fields" :key="field.key" class="form-group">
            <label class="form-label">{{ field.label }}</label>
            <input
              :ref="(el) => setInputRef(field.key, el)"
              v-model="values[field.key]"
              class="form-input"
              :placeholder="field.placeholder || ''"
              spellcheck="false"
              autocomplete="off"
              @keydown.escape.prevent="emit('close')"
            />
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'

export type CreateFormField = {
  key: string
  label: string
  placeholder?: string
  required?: boolean
}

const props = withDefaults(defineProps<{
  visible: boolean
  title: string
  fields: CreateFormField[]
  confirmText?: string
}>(), {
  confirmText: '添加',
})

const emit = defineEmits<{
  close: []
  submit: [values: Record<string, string>]
}>()

const values = reactive<Record<string, string>>({})
const inputRefs = new Map<string, HTMLInputElement>()

const resetValues = () => {
  for (const key of Object.keys(values)) delete values[key]
  for (const field of props.fields) values[field.key] = ''
}

const canSubmit = computed(() => (
  props.fields.every((field) => !field.required || String(values[field.key] || '').trim())
))

const setInputRef = (key: string, el: unknown) => {
  if (el instanceof HTMLInputElement) inputRefs.set(key, el)
  else inputRefs.delete(key)
}

const submit = () => {
  if (!canSubmit.value) return
  const next: Record<string, string> = {}
  for (const field of props.fields) next[field.key] = String(values[field.key] || '').trim()
  emit('submit', next)
}

watch(() => props.visible, async (open) => {
  if (!open) return
  resetValues()
  await nextTick()
  const first = props.fields[0]?.key
  if (first) inputRefs.get(first)?.focus()
}, { immediate: true })
</script>

<style>
@import '../styles/dialog.css';
</style>

<style scoped>
.create-form-panel {
  width: min(420px, 90vw);
  max-width: 420px;
}

.form-group:last-child {
  margin-bottom: 0;
}
</style>
