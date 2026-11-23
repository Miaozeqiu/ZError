<template>
  <section class="import-settings" aria-label="题库导入设置">
    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-title" for="agent-import-template-mode">保存导入算法模板</label>
        <p class="setting-description">成功导入后，保留解析算法以便下次复用。</p>
      </div>
      <SettingsSelect id="agent-import-template-mode" class="setting-control" label="导入模板保存方式"
        :model-value="importTemplateSettings.saveMode" :options="modes" @update:model-value="changeMode" />
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-title">导入算法</span>
        <p class="setting-description">预览和编辑已保存的题库导入模板。</p>
      </div>
      <button type="button" class="template-manage" @click="emit('manage')">
        <span>{{ importTemplateSettings.templates.length }} 个模板</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </div>
    <p v-if="error" class="import-error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import SettingsSelect from '../../components/ui/SettingsSelect.vue'
import { importTemplateSettings, setImportTemplateSaveMode } from '../../services/agent/importTemplates'
import type { ImportTemplateSaveMode } from '../../services/agent/importTemplateTypes'
const emit = defineEmits<{ manage: [] }>()
const modes = [{ value: 'ask', label: '每次询问' }, { value: 'auto', label: '自动保存' }, { value: 'never', label: '不保存' }]
const error = ref('')
async function changeMode(value: string) {
  error.value = ''
  try { await setImportTemplateSaveMode(value as ImportTemplateSaveMode) }
  catch { error.value = '未能保存模板设置，请重试。' }
}
</script>
<style scoped>
.import-settings { border-top: 1px solid var(--border-color); }
.setting-item { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 0; }
.setting-item + .setting-item { border-top: 1px solid var(--border-color); }
.setting-info { flex: 1; min-width: 0; }
.setting-title { display: block; margin-bottom: 6px; color: var(--text-primary); font-size: 14px; font-weight: 500; }
.setting-description { margin: 0; color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
.setting-control { width: 148px; flex-shrink: 0; }
.template-manage { display: flex; align-items: center; justify-content: flex-end; gap: 8px; border: 0; border-radius: 8px; padding: 8px 0 8px 12px; background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.template-manage:hover { color: var(--text-primary); }
.import-error { margin: 0 0 12px; color: #c2410c; font-size: 12px; }
@media (max-width: 640px) { .setting-item { flex-wrap: wrap; }.setting-control { width: 100%; } }
</style>
