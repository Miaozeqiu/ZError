<template>
  <div class="agent-page">
    <AgentChat :active="active" :browser-obscured="browserObscured" @open-folder="emit('open-folder', $event)" />
  </div>
</template>

<script setup lang="ts">
import AgentChat from './AgentChat.vue'
withDefaults(defineProps<{ active?: boolean; browserObscured?: boolean }>(), { active: true, browserObscured: false })

const emit = defineEmits<{
  'open-folder': [folderId: number]
}>()
</script>

<style scoped>
.agent-page {
  height: 100%;
  background: var(--bg-primary, #f5f5f7);
}
</style>
