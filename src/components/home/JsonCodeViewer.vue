<template>
  <div class="json-viewer-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { tags } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps<{ content: string }>()

const containerRef = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let themeObserver: MutationObserver | null = null

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#8b5cf6' },
  { tag: tags.string, color: '#16a34a' },
  { tag: tags.number, color: '#2563eb' },
  { tag: tags.bool, color: '#d97706' },
  { tag: tags.null, color: '#dc2626' },
  { tag: tags.punctuation, color: '#6b7280' },
])

const baseExtensions = [
  json(),
  EditorState.readOnly.of(true),
  EditorView.theme({
    '&': { borderRadius: '8px', border: '1px solid var(--request-details-code-border)' },
    '.cm-content': {
      fontFamily: "'Consolas','Monaco','Courier New',monospace",
      fontSize: '13px',
      lineHeight: '1.5',
      padding: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    },
    '&.cm-editor': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
  }),
]

const buildView = () => {
  if (!containerRef.value) return
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const themeExt = isDark ? [oneDark] : [syntaxHighlighting(lightHighlightStyle)]
  const state = EditorState.create({
    doc: props.content,
    extensions: [...baseExtensions, ...themeExt],
  })
  cmView = new EditorView({ state, parent: containerRef.value })
}

const destroyView = () => {
  cmView?.destroy()
  cmView = null
}

onMounted(() => {
  buildView()
  themeObserver = new MutationObserver(() => {
    const text = cmView?.state.doc.toString() ?? props.content
    destroyView()
    buildView()
    if (cmView && text) {
      const s = cmView.state
      cmView.dispatch(s.update({ changes: { from: 0, to: s.doc.length, insert: text } }))
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  themeObserver?.disconnect()
  destroyView()
})

watch(() => props.content, (val) => {
  if (!cmView) return
  const s = cmView.state
  cmView.dispatch(s.update({ changes: { from: 0, to: s.doc.length, insert: val ?? '' } }))
})
</script>

<style scoped>
.json-viewer-container {
  min-height: 80px;
  max-height: 500px;
  overflow: hidden;
  border-radius: 8px;
}
</style>
