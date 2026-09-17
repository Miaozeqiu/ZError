<template>
  <div v-if="text" class="watch-bar" :class="`is-${status || 'watching'}`">
    <span class="watch-bar-dot" aria-hidden="true" />
    <span class="watch-bar-text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { browserVideoWatches, formatVideoClock } from '../../services/chaoxing/browser/watch'

const props = defineProps<{
  browserId?: string
}>()

const watch = computed(() => {
  const id = String(props.browserId || '').trim()
  return id ? browserVideoWatches.value[id] || null : null
})

const status = computed(() => watch.value?.status || '')

const active = computed(() => {
  const now = status.value
  return now === 'watching'
    || now === 'paused'
    || now === 'stalled'
    || now === 'captcha'
    || now === 'quiz'
})

const text = computed(() => {
  if (!active.value || !watch.value) return ''
  const live = watch.value
  const title = live.title || '视频'
  const clock = `${formatVideoClock(live.current)} / ${formatVideoClock(live.duration)}`
  if (live.status === 'captcha') return `验证码 · ${title}`
  if (live.status === 'quiz') return `测验将跳过 · ${title}`
  if (live.status === 'paused' || live.status === 'stalled') return `已暂停 · ${title} ${clock}`
  return `监控中 · ${title} ${clock}`
})
</script>

<style scoped>
.watch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.watch-bar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #22c55e 22%, transparent);
}

.watch-bar.is-paused .watch-bar-dot,
.watch-bar.is-stalled .watch-bar-dot {
  background: #f59e0b;
  box-shadow: 0 0 0 3px color-mix(in srgb, #f59e0b 22%, transparent);
}

.watch-bar.is-captcha .watch-bar-dot,
.watch-bar.is-quiz .watch-bar-dot {
  background: #ef4444;
  box-shadow: 0 0 0 3px color-mix(in srgb, #ef4444 22%, transparent);
}

.watch-bar-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
