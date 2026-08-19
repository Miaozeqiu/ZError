<template>
  <div class="agent-html">
    <div class="agent-html-bar">
      <button
        class="agent-html-tab"
        type="button"
        :class="{ active: mode === 'preview' }"
        @click="mode = 'preview'"
      >预览</button>
      <button
        class="agent-html-tab"
        type="button"
        :class="{ active: mode === 'source' }"
        @click="mode = 'source'"
      >源码</button>
    </div>
    <iframe
      v-show="mode === 'preview'"
      ref="frameRef"
      class="agent-html-frame"
      sandbox="allow-same-origin"
      scrolling="no"
      referrerpolicy="no-referrer"
      :srcdoc="frameDoc"
      @load="onFrameLoad"
    />
    <pre v-show="mode === 'source'" class="agent-html-source"><code class="language-html" v-html="highlighted" /></pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'

const props = defineProps<{
  node: Record<string, unknown>
  loading?: boolean
  isDark?: boolean
}>()

const RESET_CSS = `html,body{margin:0!important;padding:8px;height:auto!important;min-height:0!important;overflow:hidden!important;background:transparent;color:#2d3748;font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;}html{scrollbar-width:none;}body{max-width:100%!important;}img,video,svg{max-width:100%;height:auto;}::-webkit-scrollbar{width:0;height:0;display:none;}`

const mode = ref<'preview' | 'source'>('preview')
const frameRef = ref<HTMLIFrameElement | null>(null)
let resizeObs: ResizeObserver | null = null

const source = computed(() =>
  String(props.node.code ?? props.node.content ?? props.node.raw ?? ''),
)

const safeHtml = computed(() =>
  source.value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?iframe\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, ''),
)

const frameDoc = computed(() => {
  const html = safeHtml.value
  const reset = `<style>${RESET_CSS}</style>`
  if (/<!doctype\s+html|<html[\s>]/i.test(html)) {
    if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${reset}`)
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${reset}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${reset}</head><body>${html}</body></html>`
})

const highlighted = computed(() => {
  const text = source.value
  if (!text.trim()) return ''
  try {
    return hljs.highlight(text, { language: 'html', ignoreIllegals: true }).value
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
})

const contentHeight = (doc: Document) => {
  const body = doc.body
  const win = doc.defaultView
  if (!body || !win) return 48

  const origin = doc.documentElement.getBoundingClientRect().top
  let bottom = origin
  for (const child of Array.from(body.children)) {
    const el = child as HTMLElement
    const style = win.getComputedStyle(el)
    if (style.display === 'none' || style.position === 'fixed') continue
    bottom = Math.max(
      bottom,
      el.getBoundingClientRect().bottom + (parseFloat(style.marginBottom) || 0),
    )
  }

  const bodyStyle = win.getComputedStyle(body)
  const extra =
    (parseFloat(bodyStyle.paddingBottom) || 0) +
    (parseFloat(bodyStyle.marginBottom) || 0)
  const height = Math.ceil(bottom - origin + extra) + 2
  return Math.max(height, body.offsetHeight, 48)
}

const resizeFrame = () => {
  const frame = frameRef.value
  const doc = frame?.contentDocument
  if (!frame || !doc?.body) return
  const next = Math.max(contentHeight(doc), 48)
  if (frame.style.height !== `${next}px`) frame.style.height = `${next}px`
}

const bindFrameSize = () => {
  resizeObs?.disconnect()
  resizeObs = null
  const doc = frameRef.value?.contentDocument
  if (!doc?.body || typeof ResizeObserver === 'undefined') {
    resizeFrame()
    return
  }
  resizeObs = new ResizeObserver(() => resizeFrame())
  resizeObs.observe(doc.documentElement)
  resizeObs.observe(doc.body)
  resizeFrame()
}

const onFrameLoad = () => {
  bindFrameSize()
}

watch(source, () => {
  requestAnimationFrame(resizeFrame)
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  resizeObs = null
  const frame = frameRef.value
  if (frame) frame.srcdoc = ''
})
</script>

<style scoped>
.agent-html {
  margin: 0 0 10px;
  overflow: hidden;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, #fff);
}

.agent-html-bar {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
}

.agent-html-tab {
  border: none;
  border-radius: 6px;
  padding: 3px 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.agent-html-tab.active,
.agent-html-tab:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.agent-html-frame {
  display: block;
  width: 100%;
  min-height: 48px;
  border: 0;
  overflow: hidden;
  background: transparent;
}

.agent-html-source {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  max-width: 100%;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
  color: var(--text-primary, #2d3748);
}
</style>
