<template>
  <div class="campus-workspace">
    <p v-if="syncError" class="campus-sync-error" role="status">{{ syncError }}</p>
    <iframe
      ref="webFrame"
      v-if="webCreated"
      class="campus-web-frame"
      :src="CAMPUS_WORKSPACE_URL"
      title="校园题库网页版"
      @load="connect"
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"
      referrerpolicy="no-referrer"
      :inert="!active || obscured"
      :tabindex="active && !obscured ? 0 : -1"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { CAMPUS_WORKSPACE_URL, useCampusWebAuth } from '../../services/app/campusWebAuth'
import { authReady } from '../../services/app/auth'

const props = defineProps<{ active: boolean; obscured: boolean }>()
const webCreated = ref(false)
const webFrame = ref<HTMLIFrameElement | null>(null)
const { connect, error: syncError } = useCampusWebAuth(webFrame)

// Keep the iframe alive after the first visit so its navigation and session persist.
watch([() => props.active, authReady], ([active, ready]) => {
  if (active && ready) webCreated.value = true
}, { immediate: true })
</script>

<style scoped>
.campus-workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.campus-sync-error {
  margin: 0;
  padding: 8px 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.campus-web-frame {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: block;
  width: 100%;
  border: 0;
  background: var(--bg-primary, #fff);
}
</style>
