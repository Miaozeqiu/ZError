<template>
  <div v-if="kind" class="campus-platform-icon">
    <XuexitongIcon v-if="kind === 'xuexitong'" />
    <MoocIcon v-else-if="kind === 'mooc'" />
    <RainClassroomIcon v-else-if="kind === 'yuketang'" />
    <ZhihuishuIcon v-else-if="kind === 'zhihuishu'" />
    <ZhihuizhijiaoIcon v-else-if="kind === 'icve'" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import XuexitongIcon from './icons/XuexitongIcon.vue'
import MoocIcon from './icons/MoocIcon.vue'
import RainClassroomIcon from './icons/RainClassroomIcon.vue'
import ZhihuishuIcon from './icons/ZhihuishuIcon.vue'
import ZhihuizhijiaoIcon from './icons/ZhihuizhijiaoIcon.vue'

const props = defineProps<{
  name?: string | null
}>()

const kind = computed(() => {
  const text = String(props.name || '').trim()
  if (!text) return ''
  if (text === '学习通' || /超星|chaoxing/i.test(text)) return 'xuexitong'
  if (text === '中国大学MOOC' || text === 'Mooc' || /慕课|icourse/i.test(text)) return 'mooc'
  if (text === '雨课堂' || /yuketang/i.test(text)) return 'yuketang'
  if (text === '智慧树' || /zhihuishu/i.test(text)) return 'zhihuishu'
  if (text === '智慧职教' || /职教云|icve/i.test(text)) return 'icve'
  return ''
})
</script>

<style scoped>
.campus-platform-icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  overflow: hidden;
  flex: 0 0 18px;
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 70%, transparent);
}
</style>
