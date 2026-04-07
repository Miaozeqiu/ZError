<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel ocs-config-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" @click="closeDialog" title="关闭" >
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
              <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
            </svg>
        </button>
        <div class="dialog-title-placeholder" aria-hidden="true"></div>
        <button class="copy-btn" @click="copyConfig" :class="{ copied: copySuccess }">
          <svg v-if="!copySuccess" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          {{ copySuccess ? '已复制' : '复制配置' }}
        </button>
      </div>

      <div class="dialog-body">
        <div class="json-container">
          <div class="code-editor">
            <div ref="cmContainerRef" class="cm-container"></div>
          </div>
        </div>

        <div class="config-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>当前端口号: <strong>{{ currentPort || '未设置' }}</strong></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { tags } from '@lezer/highlight'

interface Props {
  visible: boolean
  currentPort: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  test: []
}>()

const copySuccess = ref(false)

const ocsConfig = [{
  "name": "ZE题库(自建版)",
  "homepage": "http://app.zerror.cc",
  "url": "http://localhost:3002/query",
  "method": "get",
  "type": "GM_xmlhttpRequest",
  "contentType": "json",
  "data": {
    "title": "${title}",
    "options": "${options}",
    "type": "${type}"
  },
  "handler": "return (res)=>res.code === 0 ? [res.message, undefined] : [res.data.question,res.data.answer,{ai: res.data.is_ai}]"
}]

const formattedConfig = computed(() => {
  const config = [{ ...ocsConfig[0], url: `http://localhost:${props.currentPort || 3000}/query` }]
  return JSON.stringify(config, null, 2)
})

const cmContainerRef = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let themeObserver: MutationObserver | null = null

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#ff8c00' },   // key: 橙色
  { tag: tags.string, color: '#1a1a1a' },          // string: 黑色
  { tag: tags.number, color: '#2563eb' },
  { tag: tags.bool, color: '#d97706' },
  { tag: tags.null, color: '#dc2626' },
  { tag: tags.punctuation, color: '#6b7280' },
])

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#ff8c00' },   // key: 橙色
  { tag: tags.string, color: '#d4d4d4' },          // string: 浅灰（深色模式下接近白）
  { tag: tags.number, color: '#63b3ed' },
  { tag: tags.bool, color: '#f6ad55' },
  { tag: tags.null, color: '#fc8181' },
  { tag: tags.punctuation, color: '#9ca3af' },
])

const initCodeMirror = () => {
  if (!cmContainerRef.value || cmView) return
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const state = EditorState.create({
    doc: formattedConfig.value,
    extensions: [
      json(),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      EditorView.theme({
        '.cm-content': { fontFamily: "'Consolas','Monaco','Courier New',monospace", fontSize: '13px', lineHeight: '20px', padding: '12px' },
        '&.cm-editor': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' }
      }),
      ...(isDark ? [syntaxHighlighting(darkHighlightStyle)] : [syntaxHighlighting(lightHighlightStyle)])
    ]
  })
  cmView = new EditorView({ state, parent: cmContainerRef.value })
}

const setEditorDoc = (text: string) => {
  if (!cmView) return
  const s = cmView.state
  cmView.dispatch(s.update({ changes: { from: 0, to: s.doc.length, insert: text ?? '' } }))
}

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    if (cmView) { cmView.destroy(); cmView = null }
    initCodeMirror()
  } else {
    if (cmView) { cmView.destroy(); cmView = null }
  }
})

watch(() => formattedConfig.value, (j) => { if (cmView) setEditorDoc(j) })

onMounted(() => {
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme' && props.visible) {
        const text = cmView ? cmView.state.doc.toString() : formattedConfig.value
        if (cmView) { cmView.destroy(); cmView = null }
        nextTick(() => { initCodeMirror(); setEditorDoc(text) })
      }
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  if (cmView) { cmView.destroy(); cmView = null }
  if (themeObserver) { themeObserver.disconnect(); themeObserver = null }
})

const copyConfig = async () => {
  try {
    await navigator.clipboard.writeText(formattedConfig.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = formattedConfig.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copySuccess.value = true
  setTimeout(() => { copySuccess.value = false }, 2000)
}

const closeDialog = () => emit('close')

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('input') || target.closest('textarea')) return
  setTimeout(() => {
    if (window.getSelection()?.toString()) return
    const active = document.activeElement
    if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return
    closeDialog()
  }, 0)
}

const handleTest = async () => {
  if (!props.currentPort) {
    alert('请先配置端口号')
    return
  }

  try {
    const response = await fetch(`http://localhost:${props.currentPort}/query?test=true`)
    if (response.ok) {
      alert('测试成功！接口可以正常访问。')
      localStorage.setItem('ocs_config_tested', 'true')
    } else {
      alert(`测试失败：HTTP ${response.status}`)
    }
  } catch (error) {
    alert(`测试失败：${error instanceof Error ? error.message : '未知错误'}，请确认服务是否已启动。`)
  }
}
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.ocs-config-panel {
  max-width: 680px;
  display: flex;
  flex-direction: column;
}

.dialog-title-placeholder {
  flex: 1;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--add-btn-icon-bg);
  color: var(--add-btn-icon-color);
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.copy-btn:hover { background: var(--add-btn-icon-hover-bg); }
.copy-btn.copied { background: var(--add-btn-icon-bg); color: var(--add-btn-icon-color); }

.json-container {
  background: var(--bg-primary);
  border: 1px solid var(--platform-config-dialog-header-border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.code-editor { position: relative; height: 280px; }
.cm-container { position: absolute; inset: 0; }
.json-container :deep(.cm-editor) { height: 100%; }

.config-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.config-info strong {
  color: #ff8c00;
  font-family: 'DINAlternate-Bold', 'Barlow Semi Condensed', 'mitype-mono', monospace;
}
</style>
