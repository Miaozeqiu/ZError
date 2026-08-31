<template>
  <div class="graph-panel" role="region" aria-label="网站图谱">
    <div v-if="!map.site" class="graph-empty">
      {{ map.unknown ? '当前站还没有图谱' : '打开网页后显示路由和解析器' }}
    </div>

    <div v-else class="graph-board">
      <header class="graph-head">
        <b>{{ map.site.name }}</b>
        <span>{{ map.current ? `当前在「${map.current.title}」` : map.site.host }}</span>
      </header>

      <div ref="scrollRef" class="graph-scroll">
        <div class="graph-map" :style="{ width: `${map.width}px`, height: `${map.height}px` }">
          <svg class="graph-wires" :viewBox="`0 0 ${map.width} ${map.height}`">
            <defs>
              <marker id="sg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 1 1 L 9 5 L 1 9 z" />
              </marker>
              <marker id="sg-arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 1 1 L 9 5 L 1 9 z" />
              </marker>
            </defs>
            <path
              v-for="(wire, idx) in map.wires"
              :key="`${wire.from}-${wire.to}-${idx}`"
              :d="wire.d"
              :class="['graph-wire', `is-${wire.kind}`, { 'is-on': wire.active }]"
              :marker-end="wire.active ? 'url(#sg-arrow-on)' : 'url(#sg-arrow)'"
            />
          </svg>

          <span
            v-for="(wire, idx) in map.wires"
            :key="`lbl-${wire.from}-${wire.to}-${idx}`"
            class="graph-edge"
            :class="{ 'is-on': wire.active }"
            :style="{ left: `${wire.lx}px`, top: `${wire.ly}px` }"
          >
            {{ wire.label }}
          </span>

          <article
            v-for="node in map.nodes"
            :key="node.id"
            :ref="(el) => bindNode(node.id, el)"
            class="graph-node"
            :class="{ 'is-current': node.current }"
            :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: `${node.h}px` }"
            :title="node.summary"
          >
            <div class="graph-node-row">
              <strong>{{ node.title }}</strong>
              <em v-if="node.current">当前</em>
            </div>
            <div v-if="node.parsers.length" class="graph-parsers">
              <button
                v-for="parser in node.parsers"
                :key="parser.id"
                type="button"
                class="graph-parser"
                :disabled="!node.current"
                :title="node.current ? parser.tool : '打开对应页面后可挂这个解析器'"
                @click="openParser(node.id)"
              >
                {{ parserLabel(parser.name) }}
              </button>
            </div>
            <span v-else class="graph-path">{{ node.path }}</span>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { abstractionMenuOpen } from '../../services/browser/abstractions'
import { siteGraphMenuOpen, siteGraphView } from '../../services/browser/siteGraph'

const props = defineProps<{
  url?: string
}>()

const map = computed(() => siteGraphView(props.url || ''))
const scrollRef = ref<HTMLElement | null>(null)

const parserLabel = (name: string) => name.replace(/^学习通/, '')

const nodeEls = new Map<string, Element>()

const bindNode = (id: string, el: unknown) => {
  if (el instanceof Element) nodeEls.set(id, el)
  else nodeEls.delete(id)
}

const openParser = (nodeId: string) => {
  const node = map.value.nodes.find((item) => item.id === nodeId)
  if (!node?.current) return
  siteGraphMenuOpen.value = false
  abstractionMenuOpen.value = true
}

const scrollNodeInPanel = (id: string) => {
  const list = scrollRef.value
  const el = nodeEls.get(id)
  if (!list || !(el instanceof HTMLElement)) return
  const nextTop = list.scrollTop + el.getBoundingClientRect().top - list.getBoundingClientRect().top
    - (list.clientHeight - el.offsetHeight) / 2
  const maxTop = Math.max(0, list.scrollHeight - list.clientHeight)
  list.scrollTop = Math.max(0, Math.min(nextTop, maxTop))
}

watch(() => map.value.current?.id, async (id) => {
  await nextTick()
  if (id) scrollNodeInPanel(id)
})
</script>

<style scoped>
.graph-panel {
  box-sizing: border-box;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.graph-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  font-size: 13px;
  color: var(--text-secondary, #86868b);
  text-align: center;
}

.graph-board {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.graph-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px 8px;
}

.graph-head b {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-primary, #1d1d1f);
}

.graph-head span {
  font-size: 12px;
  color: var(--text-secondary, #86868b);
}

.graph-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}

.graph-map {
  position: relative;
  margin: 0 auto;
}

.graph-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.graph-wire {
  fill: none;
  stroke: color-mix(in srgb, var(--text-primary, #1d1d1f) 22%, transparent);
  stroke-width: 1.2;
}

.graph-wire.is-back,
.graph-wire.is-loop {
  stroke-dasharray: 3.5 3;
}

.graph-wire.is-on {
  stroke: color-mix(in srgb, var(--color-primary, #667eea) 72%, transparent);
}

#sg-arrow path {
  fill: color-mix(in srgb, var(--text-primary, #1d1d1f) 28%, transparent);
}

#sg-arrow-on path {
  fill: color-mix(in srgb, var(--color-primary, #667eea) 80%, transparent);
}

.graph-edge {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 0 4px;
  border-radius: 4px;
  background: var(--bg-secondary, #fff);
  font-size: 10px;
  line-height: 1.2;
  color: var(--text-secondary, #86868b);
  white-space: nowrap;
  pointer-events: none;
}

.graph-edge.is-on {
  color: var(--color-primary, #667eea);
}

.graph-node {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 7px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-tertiary, #f5f5f7) 88%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
}

.graph-node.is-current {
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, var(--bg-secondary, #fff));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary, #667eea) 55%, transparent);
}

.graph-node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
}

.graph-node-row strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #1d1d1f);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-node-row em {
  flex-shrink: 0;
  font-size: 10px;
  font-style: normal;
  color: var(--color-primary, #667eea);
}

.graph-path {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  font-family: inherit;
  line-height: 1.3;
  color: var(--text-secondary, #86868b);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-parsers {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.graph-parser {
  height: 18px;
  padding: 0 6px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 10px;
  cursor: pointer;
}

.graph-parser:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary, #667eea) 18%, transparent);
}

.graph-parser:disabled {
  cursor: default;
  opacity: 0.7;
}

[data-theme="dark"] .graph-edge {
  background: var(--bg-secondary, #2c2c2e);
}
</style>
