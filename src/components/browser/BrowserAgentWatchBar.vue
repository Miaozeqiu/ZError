<template>
  <div v-if="text" class="watch-bar" :class="`is-${status || 'watching'}`">
    <span class="watch-bar-dot" aria-hidden="true" />
    <span class="watch-bar-text">{{ text }}</span>
    <div v-if="active" class="watch-progress" :class="{ 'is-indeterminate': progress === null }" role="progressbar" aria-label="视频播放进度" :aria-valuenow="progress ?? undefined" aria-valuemin="0" aria-valuemax="100">
      <span class="watch-progress-fill" :style="{ width: progress === null ? '32%' : `${progress}%` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agentWatchBusy, formatVideoClock, videoWatchFor } from '../../services/platform/panelAccess'
import { coursePlanState, coursePlanSummary } from '../../services/browser/coursePlan'

const props = defineProps<{
  browserId?: string
}>()

const watch = computed(() => videoWatchFor(props.browserId))

const status = computed(() => watch.value?.status || '')

const active = computed(() => agentWatchBusy(props.browserId))
const progress = computed(() => {
  const live = watch.value
  return active.value && live && Number.isFinite(live.current) && Number.isFinite(live.duration) && live.duration > 0
    ? Math.min(100, Math.max(0, Math.round(live.current / live.duration * 100))) : null
})

const text = computed(() => {
  const plan = coursePlanSummary(coursePlanState.byBrowser[props.browserId || ''])
  let liveText = ''
  if (active.value && watch.value) {
    const live = watch.value
    const title = live.title || '视频'
    const clock = progress.value === null
      ? `${formatVideoClock(live.current)} / 正在读取视频时长`
      : `${formatVideoClock(live.current)} / ${formatVideoClock(live.duration)}`
    if (live.status === 'captcha') liveText = `验证码 · ${title}`
    else if (live.status === 'quiz') liveText = `测验将跳过 · ${title}`
    else if (live.status === 'paused' || live.status === 'stalled') liveText = `已暂停 · ${title} ${clock}`
    else liveText = `监控中 · ${title} ${clock}`
  }
  return [plan, liveText].filter(Boolean).join(' · ')
})
</script>

<style scoped>
.watch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.watch-bar-dot {
  flex: 0 0 7px;
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
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.watch-progress { flex: 0 0 100%; height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, currentColor 12%, transparent); }
.watch-progress-fill { display: block; height: 100%; border-radius: inherit; background: currentColor; }
.watch-progress.is-indeterminate .watch-progress-fill {
  animation: watch-loading 1.4s ease-in-out infinite;
}
@keyframes watch-loading {
  from { transform: translateX(-110%); }
  to { transform: translateX(320%); }
}
@media (prefers-reduced-motion: reduce) {
  .watch-progress.is-indeterminate .watch-progress-fill { animation: none; }
}
</style>
