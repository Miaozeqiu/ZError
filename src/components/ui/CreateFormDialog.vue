<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="emit('close')">
      <form
        class="dialog-panel account-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${formId}-title`"
        @submit.prevent="submit"
        @keydown.esc.prevent.stop="emit('close')"
      >
        <div class="dialog-header">
          <h3 :id="`${formId}-title`" class="dialog-title">{{ title }}</h3>
        </div>
        <div class="dialog-body">
          <div v-for="field in fields" :key="field.key" class="form-group">
            <label class="form-label" :for="`${formId}-field-${field.key}`">{{ field.label }}</label>
            <input
              :id="`${formId}-field-${field.key}`"
              :ref="(el) => setInputRef(field.key, el)"
              v-model="values[field.key]"
              class="form-input"
              :placeholder="field.placeholder || ''"
              :required="field.required"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
          <div class="account-dialog-footer">
            <button class="account-dialog-cancel" type="button" @click="emit('close')">取消</button>
            <button class="btn-confirm" type="submit" :disabled="!canSubmit">{{ confirmText }}</button>
          </div>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, useId, watch } from 'vue'

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

const formId = useId()
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
@import '../../styles/dialog.css';
</style>
