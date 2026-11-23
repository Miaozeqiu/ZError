<template>
  <div class="template-page" @keydown.ctrl.s.prevent="save" @keydown.meta.s.prevent="save">
    <header class="template-header">
      <button type="button" class="back-button" :disabled="saving" @click="requestLeave({ kind: 'back' })">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>返回
      </button>
      <h2>导入算法</h2>
      <div v-if="selected" class="header-actions">
        <div class="mode-switch" role="radiogroup" aria-label="算法显示模式">
          <label v-for="item in modes" :key="item.value" :class="{ selected: mode === item.value }">
            <input v-model="mode" type="radio" name="import-template-view" :value="item.value" :disabled="saving" />{{ item.label }}
          </label>
        </div>
        <button type="button" class="save-button" :disabled="!dirty || saving || !name.trim() || !code.trim()" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </header>
    <div v-if="!templates.length" class="template-empty">还没有保存的导入模板</div>
    <div v-else class="template-layout">
      <aside class="template-list" aria-label="导入算法模板">
        <button v-for="item in templates" :key="item.id" type="button" class="template-entry"
          :class="{ active: item.id === selectedId }" :aria-current="item.id === selectedId ? 'true' : undefined"
          :disabled="saving" @click="requestLeave({ kind: 'select', id: item.id })">
          <strong>{{ item.name }}</strong><span>{{ item.extensions.join(' · ').toUpperCase() }}</span>
        </button>
      </aside>
      <main v-if="selected" class="template-panel">
        <div class="template-meta">
          <template v-if="mode === 'edit'">
            <label>名称<input v-model="name" class="form-input" maxlength="80" :disabled="saving" /></label>
            <label>适用排版<textarea v-model="description" class="form-input" rows="2" maxlength="500" :disabled="saving" /></label>
          </template>
          <template v-else><h3>{{ name }}</h3><p>{{ description || '暂无排版说明' }}</p></template>
          <div class="meta-footer"><span>{{ selected.extensions.join(' · ').toUpperCase() }}</span>
            <button type="button" class="template-delete" :disabled="saving" :aria-label="`删除模板 ${selected.name}`" @click="requestLeave({ kind: 'delete', id: selected.id })">删除</button>
          </div>
        </div>
        <p v-if="error" class="template-error" role="alert">{{ error }}</p>
        <p v-else-if="saved" class="template-saved" role="status">已保存</p>
        <div class="template-code" :aria-label="mode === 'edit' ? '编辑导入算法' : '预览导入算法'">
          <SkillMarkdownEditor :key="selectedId" v-model="code" language="javascript" :readonly="mode === 'preview' || saving" :autofocus="mode === 'edit'" />
        </div>
      </main>
    </div>
    <SkillUnsavedDialog :visible="Boolean(pendingLeave)" message="当前算法有未保存的修改。" :saving="saving" :error="error"
      @cancel="pendingLeave = null" @save="saveAndLeave" @discard="discardAndLeave" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SkillMarkdownEditor from '../../components/settings/SkillMarkdownEditor.vue'
import SkillUnsavedDialog from '../../components/settings/SkillUnsavedDialog.vue'
import { deleteImportTemplate, importTemplateSettings, updateImportTemplate } from '../../services/agent/importTemplates'

const emit = defineEmits<{ back: [] }>()
const templates = computed(() => importTemplateSettings.value.templates)
const selectedId = ref(templates.value[0]?.id || '')
const selected = computed(() => templates.value.find(item => item.id === selectedId.value))
const mode = ref<'preview' | 'edit'>('preview')
const modes = [{ value: 'preview', label: '预览' }, { value: 'edit', label: '编辑' }] as const
const name = ref(''), description = ref(''), code = ref(''), error = ref('')
const saving = ref(false), saved = ref(false)
const baseline = ref({ name: '', description: '', code: '' })
const dirty = computed(() => Boolean(selected.value) && (name.value !== baseline.value.name || description.value !== baseline.value.description || code.value !== baseline.value.code))
type LeaveAction = { kind: 'back' } | { kind: 'select' | 'delete'; id: string }
const pendingLeave = ref<LeaveAction | null>(null)
function load() {
  const item = selected.value
  baseline.value = { name: item?.name || '', description: item?.description || '', code: item?.code || '' }
  name.value = baseline.value.name; description.value = baseline.value.description; code.value = baseline.value.code
  error.value = ''; saved.value = false
}
watch(selectedId, load, { immediate: true })
// 聊天保存或其他入口修改同一模板时刷新预览，同时保留尚未保存的编辑草稿。
watch([() => selected.value?.name, () => selected.value?.description, () => selected.value?.code], () => {
  if (!dirty.value) load()
})
// 初始设置异步载入或外部删除模板后，始终保持有效选中项。
watch(() => templates.value.map(item => item.id), ids => {
  if (!ids.includes(selectedId.value)) selectedId.value = ids[0] || ''
})
async function save() {
  if (!selected.value || saving.value || !dirty.value) return false
  saving.value = true; error.value = ''; saved.value = false
  try {
    await updateImportTemplate(selected.value.id, { name: name.value, description: description.value, code: code.value })
    load(); saved.value = true
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '未能保存算法，请重试。'
    return false
  } finally { saving.value = false }
}
async function leave(action: LeaveAction) {
  pendingLeave.value = null; error.value = ''
  if (action.kind === 'back') { emit('back'); return }
  if (action.kind === 'select') { selectedId.value = action.id; mode.value = 'preview'; return }
  saving.value = true
  try { await deleteImportTemplate(action.id) }
  catch { error.value = '未能删除模板，请重试。' }
  finally { saving.value = false }
}
function requestLeave(action: LeaveAction) {
  if (saving.value || (action.kind === 'select' && action.id === selectedId.value)) return
  if (dirty.value) pendingLeave.value = action
  else void leave(action)
}
async function saveAndLeave() {
  const action = pendingLeave.value
  if (action && await save()) await leave(action)
}
function discardAndLeave() {
  const action = pendingLeave.value
  if (!action || saving.value) return
  load(); void leave(action)
}
</script>
<style scoped>
.template-page { display: flex; flex-direction: column; height: 100%; min-height: 420px; min-width: 0; color: var(--text-primary); }
.template-header { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border-color); }
h2 { margin: 0; font-size: 14px; font-weight: 550; }.header-actions { margin-left: auto; display: flex; align-items: center; gap: 12px; }
button { border: 0; border-radius: 7px; font: inherit; cursor: pointer; }button:disabled { opacity: .45; cursor: default; }
.back-button { display: flex; align-items: center; gap: 4px; padding: 6px 0; background: transparent; color: var(--text-secondary); font-size: 12px; }
.mode-switch { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--bg-tertiary); font-size: 12px; }.mode-switch label { position: relative; padding: 5px 10px; border-radius: 6px; cursor: pointer; color: var(--text-secondary); }.mode-switch label.selected { background: var(--bg-secondary); color: var(--text-primary); box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }.mode-switch input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; cursor: pointer; }.mode-switch label:has(input:focus-visible) { outline: 2px solid var(--color-accent); }
.save-button { padding: 6px 12px; background: var(--dialog-button-primary-bg, #007aff); color: var(--dialog-button-primary-text, #fff); font-size: 12px; }
.template-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }.template-list { width: 190px; flex-shrink: 0; overflow: auto; padding: 10px 8px; box-sizing: border-box; border-right: 1px solid var(--border-color); }.template-entry { display: grid; gap: 5px; width: 100%; padding: 10px; margin: 2px 0; background: transparent; color: var(--text-primary); text-align: left; }.template-entry.active, .template-entry:hover { background: var(--bg-tertiary); }.template-entry strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }.template-entry span { color: var(--text-secondary); font-size: 10px; }
.template-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }.template-meta { display: grid; gap: 12px; padding: 18px 20px 12px; }.template-meta h3 { margin: 0; font-size: 15px; font-weight: 550; }.template-meta p { margin: 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }.template-meta label { display: grid; gap: 6px; font-size: 12px; color: var(--text-secondary); }.form-input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 0; border-radius: 8px; background: var(--bg-tertiary); color: var(--text-primary); font: inherit; font-size: 13px; resize: vertical; }.meta-footer { display: flex; justify-content: space-between; align-items: center; color: var(--text-secondary); font-size: 11px; }.template-delete { background: transparent; color: #c2410c; padding: 4px 6px; font-size: 12px; }
.template-code { flex: 1; min-height: 230px; display: flex; overflow: hidden; }.template-code :deep(.skill-cm-editor) { flex: 1; min-width: 0; }.template-error, .template-saved { margin: 0; padding: 6px 20px; font-size: 12px; }.template-error { color: #c2410c; }.template-saved { color: var(--text-secondary); }.template-empty { padding: 48px 16px; text-align: center; color: var(--text-secondary); font-size: 13px; }
@media (max-width: 640px) { .template-header { flex-wrap: wrap; gap: 8px; }.header-actions { gap: 8px; }.template-layout { flex-direction: column; }.template-list { display: flex; width: 100%; max-height: 110px; border-right: 0; border-bottom: 1px solid var(--border-color); }.template-entry { min-width: 130px; width: auto; }.template-meta { padding: 14px; } }
</style>
