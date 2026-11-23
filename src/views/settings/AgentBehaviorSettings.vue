<template>
  <div class="agent-behavior-settings">
    <section aria-labelledby="agent-permissions-heading">
      <h3 id="agent-permissions-heading" class="group-title">操作权限</h3>
      <div class="setting-item">
        <div class="setting-info">
          <label class="setting-title" for="agent-permission-mode">网页操作</label>
          <p class="setting-description">严格模式会限制在作业页直接点击和填写。</p>
        </div>
        <div class="setting-control">
          <SettingsSelect id="agent-permission-mode" class="permission-select" label="网页操作" :model-value="agentPolicyState.permissionMode" :options="[{ value: 'explore', label: '常规' }, { value: 'strict', label: '严格' }]" @update:model-value="setAgentPolicy({ permissionMode: $event as PermissionMode })" />
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <label class="setting-title" for="agent-skill-permission">修改 Skill</label>
          <p class="setting-description">决定 Agent 能否保存和修改技能文件。</p>
        </div>
        <div class="setting-control">
          <SettingsSelect id="agent-skill-permission" class="permission-select" label="修改 Skill" :model-value="agentPolicyState.writeSkills" :options="[{ value: 'ask', label: '先确认' }, { value: 'allow', label: '允许' }, { value: 'deny', label: '禁止' }]" @update:model-value="setAgentPolicy({ writeSkills: $event as ConfirmPolicy })" />
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <label class="setting-title" for="agent-submit-permission">提交作业</label>
          <p class="setting-description">决定提交前是否需要你的确认。</p>
        </div>
        <div class="setting-control">
          <SettingsSelect id="agent-submit-permission" class="permission-select" label="提交作业" :model-value="agentPolicyState.submit" :options="[{ value: 'ask', label: '先确认' }, { value: 'allow', label: '允许' }]" @update:model-value="setAgentPolicy({ submit: $event as SubmitPolicy })" />
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span id="agent-campus-upload-label" class="setting-title">上传到校园题库</span>
          <p id="agent-campus-upload-help" class="setting-description">允许 Agent 按你的要求向指定试卷上传题目。新建试卷还需开启修改权限。</p>
        </div>
        <div class="setting-control">
          <Toggle role="switch" aria-labelledby="agent-campus-upload-label" aria-describedby="agent-campus-upload-help"
            :model-value="agentPolicyState.campusUpload" @update:model-value="setAgentPolicy({ campusUpload: $event })" />
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span id="agent-campus-edit-label" class="setting-title">校验并修改校园题库</span>
          <p id="agent-campus-edit-help" class="setting-description">允许 Agent 核对后更正已有题目，并创建或管理课程与试卷。查看和查重始终可用。</p>
        </div>
        <div class="setting-control">
          <Toggle role="switch" aria-labelledby="agent-campus-edit-label" aria-describedby="agent-campus-edit-help"
            :model-value="agentPolicyState.campusEdit" @update:model-value="setAgentPolicy({ campusEdit: $event })" />
        </div>
      </div>
    </section>

    <AgentImportSettings @manage="emit('manage-import-templates')" />

    <section class="prompt-section" aria-labelledby="agent-rules-heading">
      <div class="section-heading">
        <h3 id="agent-rules-heading">附加提示词</h3>
        <p class="section-description">追加到内置系统提示词，对所有任务生效。</p>
      </div>
      <div class="prompt-editor">
        <textarea
          id="agent-rule-text"
          ref="promptInput"
          class="form-input profile-overlay"
          aria-labelledby="agent-rules-heading"
          rows="2"
          :value="activeProfile.systemOverlay"
          placeholder="例如：回答简洁；执行任务前先检查现有状态。"
          @input="resizePrompt"
          @change="savePrompt(($event.target as HTMLTextAreaElement).value)"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentImportSettings from './AgentImportSettings.vue'
import SettingsSelect from '../../components/ui/SettingsSelect.vue'
import Toggle from '../../components/ui/Toggle.vue'
import {
  agentPolicyState, setAgentPolicy, type PermissionMode, type ConfirmPolicy, type SubmitPolicy,
} from '../../services/agent/agentPolicy'
import { getActiveAgentProfile, saveAgentProfile } from '../../services/agent/agentProfiles'

const emit = defineEmits<{ 'manage-import-templates': [] }>()

const activeProfile = computed(() => getActiveAgentProfile())
const promptInput = ref<HTMLTextAreaElement | null>(null)
let promptResizeObserver: ResizeObserver | undefined

const resizePrompt = () => {
  const input = promptInput.value
  if (!input) return

  input.style.height = 'auto'
  const borderHeight = input.offsetHeight - input.clientHeight
  input.style.height = `${Math.max(input.offsetHeight, input.scrollHeight + borderHeight)}px`
}

watch(() => activeProfile.value.systemOverlay, resizePrompt, { flush: 'post' })
onMounted(() => {
  resizePrompt()
  if (!promptInput.value || typeof ResizeObserver === 'undefined') return
  let width = promptInput.value.clientWidth
  promptResizeObserver = new ResizeObserver(() => {
    const nextWidth = promptInput.value?.clientWidth
    if (nextWidth === undefined || nextWidth === width) return
    width = nextWidth
    resizePrompt()
  })
  promptResizeObserver.observe(promptInput.value)
})
onUnmounted(() => promptResizeObserver?.disconnect())

const savePrompt = (systemOverlay: string) => {
  saveAgentProfile({ ...activeProfile.value, systemOverlay })
}
</script>

<style scoped>
.agent-behavior-settings {
  min-width: 0;
  padding: 0 14px;
  background: var(--network-group-bg, var(--bg-secondary, #fff));
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 14px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 5%);
}
.prompt-section { border-top: 1px solid var(--border-color, #e2e8f0); }
.section-heading { padding: 16px 0 12px; }
.section-heading h3 { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 550; }
.section-description { margin: 5px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.group-title { margin: 0; padding: 10px 0 2px; color: var(--text-secondary); font-size: 12px; font-weight: 600; letter-spacing: .03em; }
.setting-item { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 0; border-bottom: 1px solid var(--border-color, #e2e8f0); }
.setting-item:last-child { border-bottom: none; }
.setting-info { flex: 1; min-width: 0; margin-right: 18px; }
.setting-title { display: block; margin: 0 0 6px; color: var(--text-primary); font-size: 14px; font-weight: 500; }
.setting-description { margin: 0; color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
.setting-control { display: flex; justify-content: flex-end; flex-shrink: 0; width: 148px; }
.permission-select { width: 100%; }
.prompt-editor { display: flex; flex-direction: column; padding: 0 0 16px; }
.profile-overlay { resize: none; overflow: hidden; overflow-wrap: anywhere; line-height: 1.65; }
@media (max-width: 640px) {
  .setting-item { flex-direction: column; gap: 10px; }
  .setting-info { margin-right: 0; }
  .setting-control { width: 100%; }
}
</style>
