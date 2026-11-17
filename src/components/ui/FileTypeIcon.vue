<template>
  <Icon
    :icon="icon"
    class="file-type-icon"
    :width="size"
    :height="size"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { resolveFileIconName } from '../../utils/ui/fileTypeIcon'

const props = withDefaults(defineProps<{
  name?: string
  folder?: boolean
  open?: boolean
  icon?: string
  size?: number | string
}>(), {
  size: 16,
})

const icon = computed(() => resolveFileIconName({
  name: props.name,
  folder: props.folder,
  open: props.open,
  icon: props.icon,
}))
</script>
