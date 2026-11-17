<template>
  <div class="sketch" :class="[`is-${kind}`, { 'is-wide': !compact }]">
    <div class="win">
      <div class="chrome">
        <span class="dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span class="chrome-title">{{ windowTitle }}</span>
        <span class="chrome-end">
          <span v-if="badge" class="chrome-tab">{{ badge }}</span>
          <em v-if="live">当前</em>
        </span>
      </div>

      <div v-if="kind === 'full'" class="stage is-full">
        <span>{{ caption || '整页 · 无 iframe' }}</span>
      </div>

      <div v-else class="body">
        <aside v-if="side.length" class="rail" aria-label="侧栏">
          <span
            v-for="item in side"
            :key="item"
            class="rail-item"
            :class="{ 'is-on': onTab === item }"
          >{{ item }}</span>
        </aside>

        <div class="frame" :class="{ 'is-stay': stay }">
          <div class="frame-bar">
            <b>{{ compact ? '内容' : 'iframe' }}</b>
            <span>{{ compact ? '内容区域' : frameName }}</span>
            <i v-if="stay">留框</i>
          </div>

          <div v-if="tabs.length" class="tabs" role="tablist">
            <span
              v-for="item in tabs"
              :key="item"
              class="tab"
              :class="{ 'is-on': onTab === item }"
            >{{ item }}</span>
          </div>

          <div v-if="stack.length" class="layers">
            <em v-for="(layer, idx) in stack" :key="layer">{{ compact && /^(?:https?:\/\/|\/|[\w.-]+\/)/i.test(layer) ? '内容区域' : layer }}</em>
          </div>
          <p v-else class="doc">
            <span class="doc-name">{{ docTitle }}</span>
            <span v-if="!compact && docPath" class="doc-path">{{ docPath }}</span>
          </p>
        </div>
      </div>
    </div>

    <p v-if="!compact && kind !== 'full' && caption" class="note">{{ caption }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SiteGraphSketch } from '../../services/browser/siteGraphCore'

const props = defineProps<{
  sketch?: SiteGraphSketch | null
  onTab?: string
  pane?: string
  caption?: string
  stay?: boolean
  compact?: boolean
  frameName?: string
  docTitle?: string
  title?: string
  badge?: string
  live?: boolean
}>()

const kind = computed(() => props.sketch?.kind || 'full')
const shell = computed(() => props.sketch?.shell || '页面')
const windowTitle = computed(() => String(props.title || '').trim() || shell.value)
const badge = computed(() => String(props.badge || '').trim())
const caption = computed(() => props.caption || props.sketch?.caption || '')
const side = computed(() => props.sketch?.side || [])
const tabs = computed(() => props.sketch?.tabs || [])
const stack = computed(() => props.sketch?.stack || [])

const frameName = computed(() => {
  const named = String(props.frameName || '').trim()
  if (named) return named
  if (kind.value === 'host-tabs') return '#frame_content'
  if (kind.value === 'host-side') return '中间框'
  return 'iframe'
})

const docPath = computed(() => {
  const raw = String(props.pane || props.sketch?.pane || '').trim()
  if (!raw || raw === frameName.value) return ''
  if (/\s/.test(raw) && !raw.startsWith('/') && !raw.includes('.')) return ''
  return raw
})

const docTitle = computed(() => {
  const named = String(props.docTitle || '').trim()
  if (named) return named
  if (props.onTab) return props.onTab
  const raw = String(props.pane || props.sketch?.pane || '').trim()
  if (raw && (raw.includes(' ') || /[\u4e00-\u9fff]/.test(raw))) return raw
  return kind.value === 'host-tabs' ? '课表' : '内容'
})
</script>

<style scoped>
.sketch {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  width: 100%;
  height: 100%;
}

.win {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 94%, transparent);
  box-shadow:
    0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
    0 1px 2px color-mix(in srgb, var(--text-primary, #1d1d1f) 18%, transparent),
    0 6px 10px color-mix(in srgb, var(--text-primary, #1d1d1f) 14%, transparent),
    0 14px 22px color-mix(in srgb, var(--text-primary, #1d1d1f) 10%, transparent),
    0 0 0 0.5px color-mix(in srgb, var(--text-primary, #1d1d1f) 22%, transparent);
}

.chrome {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  height: 22px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 5%, transparent);
}

.dots {
  position: relative;
  z-index: 1;
  display: flex;
  flex-shrink: 0;
  gap: 3px;
}

.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 18%, transparent);
}

.dots i:nth-child(1) { background: #ff5f57; }
.dots i:nth-child(2) { background: #febc2e; }
.dots i:nth-child(3) { background: #28c840; }

.chrome-title {
  position: absolute;
  left: 34px;
  right: 52px;
  overflow: hidden;
  color: var(--text-primary, #1d1d1f);
  font-size: 10px;
  font-weight: 620;
  letter-spacing: -0.02em;
  line-height: 22px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.chrome-end {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 18px;
  min-height: 14px;
}

.chrome-tab,
.chrome-end em {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 14%, transparent);
  color: var(--color-primary, #667eea);
  font-size: 8px;
  font-style: normal;
  font-weight: 650;
  line-height: 14px;
}

.body {
  display: flex;
  flex: 1;
  gap: 0;
  min-height: 0;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 40px;
  flex-shrink: 0;
  padding: 5px 4px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 3.5%, transparent);
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--text-primary, #1d1d1f) 6%, transparent);
}

.rail-item {
  padding: 3px 0;
  border-radius: 4px;
  color: var(--text-secondary, #86868b);
  font-size: 9px;
  font-weight: 560;
  line-height: 12px;
  text-align: center;
  transition: background 160ms cubic-bezier(0.23, 1, 0.32, 1), color 160ms ease;
}

.rail-item.is-on {
  background: color-mix(in srgb, var(--color-primary, #667eea) 16%, transparent);
  color: var(--color-primary, #667eea);
  font-weight: 650;
}

.sketch:not(.is-wide) .stage.is-full {
  min-height: 0;
  padding: 3px 8px;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
}

.stage.is-full span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.stage.is-full {
  display: flex;
  flex: 1;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  color: var(--text-primary, #1d1d1f);
  font-size: 11px;
  font-weight: 560;
}

.frame {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 4px;
  overflow: hidden;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 2.5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-primary, #1d1d1f) 9%, transparent);
}

.frame.is-stay {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #c47d12 26%, transparent);
}

.frame-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 16px;
  padding: 0 5px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 4%, transparent);
}

.frame-bar b {
  flex-shrink: 0;
  color: var(--text-tertiary, #a1a1a6);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 12px;
}

.frame-bar span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary, #86868b);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 8px;
  line-height: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frame-bar i {
  flex-shrink: 0;
  font-size: 8px;
  font-style: normal;
  font-weight: 650;
  letter-spacing: 0.03em;
  color: #8a5a10;
}

.tabs {
  display: flex;
  gap: 2px;
  margin: 4px 4px 0;
  padding: 2px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 5%, transparent);
}

.tab {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 3px 4px;
  border-radius: 4px;
  color: var(--text-secondary, #86868b);
  font-size: 9px;
  font-weight: 560;
  line-height: 12px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background 160ms cubic-bezier(0.23, 1, 0.32, 1), color 160ms ease;
}

.tab.is-on {
  background: color-mix(in srgb, var(--bg-secondary, #fff) 92%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary, #1d1d1f) 6%, transparent);
  color: var(--text-primary, #1d1d1f);
  font-weight: 650;
}

.doc {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-height: 26px;
  margin: 4px;
  padding: 4px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 70%, transparent);
}

.doc-name {
  overflow: hidden;
  color: var(--text-primary, #1d1d1f);
  font-size: 10px;
  font-weight: 620;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-path {
  overflow: hidden;
  color: var(--text-tertiary, #a1a1a6);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 8px;
  line-height: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layers {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px;
}

.layers em {
  display: block;
  overflow: hidden;
  padding: 4px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 70%, transparent);
  color: var(--text-primary, #1d1d1f);
  font-size: 9px;
  font-style: normal;
  font-weight: 560;
  line-height: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layers em:last-child {
  background: color-mix(in srgb, var(--color-primary, #667eea) 8%, transparent);
}

.note {
  margin: 0;
  color: var(--text-secondary, #86868b);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.45;
}

.sketch.is-wide .body {
  min-height: 78px;
}

.sketch.is-wide .rail {
  width: 52px;
}

.sketch.is-wide .chrome {
  height: 24px;
}

.sketch.is-wide .chrome-title {
  line-height: 24px;
  font-size: 11px;
}

.sketch.is-wide .tab,
.sketch.is-wide .rail-item {
  font-size: 10px;
  line-height: 14px;
}

.sketch.is-wide .doc {
  min-height: 34px;
}

.sketch.is-wide .doc-name {
  font-size: 12px;
  line-height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .tab,
  .rail-item {
    transition: none;
  }
}
</style>
