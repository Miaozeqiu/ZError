<template>
  <div v-if="text" class="watch-bar" :class="`is-${status || 'watching'}`">
    <div class="watch-bar-row">
      <span class="watch-bar-dot" aria-hidden="true" />
      <span class="watch-bar-text">{{ text }}</span>
      <span v-if="clock" class="watch-bar-clock" :title="clock">{{ clock }}</span>
    </div>
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

const clock = computed(() => {
  const live = watch.value
  if (!active.value || !live) return ''
  const duration = progress.value === null ? '正在读取视频时长' : formatVideoClock(live.duration)
  return `${formatVideoClock(live.current)} / ${duration}`
})

const text = computed(() => {
  const plan = coursePlanSummary(coursePlanState.byBrowser[props.browserId || ''])
  let liveText = ''
  if (active.value && watch.value) {
    const live = watch.value
    const title = live.title || '视频'
    if (live.status === 'paused' || live.status === 'stalled') liveText = `已暂停 · ${title}`
    else liveText = `监控中 · ${title}`
  }
  return [plan, liveText].filter(Boolean).join(' · ')
})
</script>

<style scoped>
.watch-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
  background:
    linear-gradient(to bottom, rgb(255 255 255 / 16%), transparent),
    color-mix(in srgb, var(--bg-secondary, #fff) 62%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  backdrop-filter: blur(18px) saturate(145%);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--border-primary, #e2e8f0) 60%, transparent),
    inset 0 1px 0 rgb(255 255 255 / 38%),
    0 2px 8px rgb(0 0 0 / 10%);
}

.watch-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

.watch-bar-text,
.watch-bar-clock {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.watch-bar-text {
  flex: 1;
  min-width: 0;
}
.watch-bar-clock {
  flex: 0 0 auto;
  max-width: 65%;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.watch-progress { height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, currentColor 12%, transparent); }
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
@media (prefers-reduced-transparency: reduce) {
  .watch-bar {
    background: var(--bg-secondary, #fff);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
</style>
