<template>
  <div v-if="visible">
    <Teleport to="body">
      <div class="dialog-overlay" @click="handleOverlayClick">
        <div class="dialog-container" @click.stop>
          <div class="dialog-header">
            <h3>OCS题库配置</h3>
            <button class="close-btn" @click="closeDialog">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <div class="dialog-content">
            <div class="config-section">
              <div class="config-header">
                <h4>OCS题库配置</h4>
                <button class="copy-btn" @click="copyConfig" :class="{ copied: copySuccess }">
                  <svg v-if="!copySuccess" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    xmlns="http://www.w3.org/2000/svg">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"
                      fill="none" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor"
                      stroke-width="2" fill="none" />
                  </svg>
                  <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" />
                  </svg>
                  {{ copySuccess ? '已复制' : '复制配置' }}
                </button>
              </div>

              <div class="json-container">
                <div class="code-editor">
                  <div ref="cmContainerRef" class="cm-container"></div>
                </div>
              </div>
            </div>

            <div class="config-info">
              <div class="info-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                  <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" />
                </svg>
                <span>当前端口号: <strong>{{ currentPort || '未设置' }}</strong></span>
              </div>
            </div>
          </div>

          </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  visible: boolean
  currentPort: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  test: []
}>()

// 复制状态
const copySuccess = ref(false)

// OCS配置JSON数据
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

// 格式化的配置JSON
const formattedConfig = computed(() => {
  const configWithCurrentPort = [{
    ...ocsConfig[0],
    url: `http://localhost:${props.currentPort || 3000}/query`
  }]
  return JSON.stringify(configWithCurrentPort, null, 2)
})

const cmContainerRef = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let themeObserver: MutationObserver | null = null

const initCodeMirror = async () => {
  if (!cmContainerRef.value || cmView) return
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark'
  let langExt: any = null
  try {
    const mod = await import('@codemirror/lang-json')
    langExt = mod.json()
  } catch {
    langExt = javascript()
  }
  const baseExtensions = [
    langExt,
    EditorState.readOnly.of(true),
    EditorView.theme({
      '.cm-content': {
        fontFamily: "'Consolas','Monaco','Courier New',monospace",
        fontSize: '13px',
        lineHeight: '20px'
      },
      '&.cm-editor': { height: '100%' }
    })
  ]
  const themeExtensions = isDarkTheme
    ? [oneDark]
    : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]

  const state = EditorState.create({
    doc: formattedConfig.value,
    extensions: [...baseExtensions, ...themeExtensions]
  })
  cmView = new EditorView({ state, parent: cmContainerRef.value })
}

const setEditorDoc = (text: string) => {
  if (!cmView) return
  const state = cmView.state
  cmView.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text ?? '' } }))
}

watch(() => props.visible, async (visible) => {
  if (visible) {
    await nextTick()
    if (cmView) {
      cmView.destroy()
      cmView = null
    }
    await initCodeMirror()
  } else {
    if (cmView) {
      cmView.destroy()
      cmView = null
    }
  }
})

watch(() => formattedConfig.value, (json) => {
  if (cmView) setEditorDoc(json)
})

onMounted(() => {
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        if (props.visible) {
          const currentText = cmView ? cmView.state.doc.toString() : formattedConfig.value
          if (cmView) {
            cmView.destroy()
            cmView = null
          }
          nextTick(async () => {
            await initCodeMirror()
            setEditorDoc(currentText)
          })
        }
      }
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
})

// 复制配置到剪贴板
const copyConfig = async () => {
  try {
    await navigator.clipboard.writeText(formattedConfig.value)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
    // 降级方案：使用传统的复制方法
    const textArea = document.createElement('textarea')
    textArea.value = formattedConfig.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  }
}

// 关闭弹窗
const closeDialog = () => {
  emit('close')
}

// 点击遮罩层关闭
const handleOverlayClick = (event: MouseEvent) => {
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
    target.closest('input') || target.closest('textarea') || target.closest('select')) {
    return
  }

  // 使用 setTimeout 延迟检查文本选择状态，避免时序问题
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }

    // 检查是否有任何输入框处于焦点状态
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }

    closeDialog()
  }, 0)
}

// 测试连接
const testConnection = () => {
  emit('test')
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.dialog-container {
  background: var(--bg-secondary);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 700px;
  max-height: 90vh;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--header-bg);
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
}

.close-btn {
  height: 32px;
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.dialog-content {
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.config-section {
  margin-bottom: 20px;
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.config-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-btn:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.copy-btn.copied {
  background: #10b981;
}

.copy-btn.copied:hover {
  background: #059669;
}

.json-container {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  min-height: 200px;
}

.json-code {
  margin: 0;
  padding: 20px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color);
  background: transparent;
  overflow-x: auto;
  white-space: pre;
}

.code-editor { position: relative; min-height: 200px; }
.cm-container { position: relative; width: 100%; height: 100%; }
.json-container :deep(.cm-editor) { height: 100%; }
.json-container :deep(.cm-content) {
  padding: 12px;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  font-size: 13px;
  line-height: 20px;
}

/* JSON语法高亮 */
.json-code {
  color: var(--json-default);
}

/* 字符串 */
.json-code::before {
  content: '';
}

/* 使用CSS来实现简单的JSON语法高亮 */
.json-code {
  background: linear-gradient(to right,
      transparent 0%,
      transparent 100%);
}

/* 为JSON添加语法高亮样式变量 */
:root {
  --json-default: var(--text-color);
  --json-string: #22c55e;
  --json-number: #3b82f6;
  --json-boolean: #f59e0b;
  --json-null: #ef4444;
  --json-key: #8b5cf6;
  --json-punctuation: var(--text-color-secondary);
}

.config-info {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.detail-row .label {
  min-width: 80px;
  font-weight: 500;
  color: var(--text-color-secondary);
  margin-right: 12px;
}

.detail-row .value {
  color: var(--text-color);
  word-break: break-all;
}

.detail-row .value.method {
  background: var(--primary-bg);
  color: var(--primary-color);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.config-data,
.config-handler {
  margin-bottom: 16px;
}

.config-data h6,
.config-handler h6 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.data-preview,
.handler-preview {
  background: var(--code-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  font-size: 12px;
  color: var(--code-color);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.config-info {
  background: var(--info-bg);
  border: 1px solid var(--info-border);
  border-radius: 8px;
  padding: 16px;
}

.info-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.info-item:last-child {
  margin-bottom: 0;
}

.info-item svg {
  margin-right: 8px;
  color: var(--info-color);
}

.info-item span {
  color: var(--text-color-secondary);
  font-size: 14px;
}

.info-item strong {
  color: var(--text-color);
}

.status-active {
  color: var(--success-color) !important;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-color);
  background: var(--footer-bg);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn-secondary {
  background: var(--secondary-bg);
  color: var(--secondary-color);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--secondary-hover-bg);
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover-color);
}

/* 深色模式适配 */
:root {
  --card-bg: var(--bg-color);
  --header-bg: var(--bg-color);
  --footer-bg: var(--bg-color);
  --code-bg: var(--input-bg);
  --code-color: var(--text-color);
  --info-bg: var(--bg-secondary);
  --info-border: var(--border-color);
  --info-color: var(--primary-color);
  --success-bg: rgba(34, 197, 94, 0.1);
  --success-color: #22c55e;
  --primary-bg: rgba(59, 130, 246, 0.1);
  --secondary-bg: var(--bg-secondary);
  --secondary-color: var(--text-color);
  --secondary-hover-bg: var(--hover-bg);
  --primary-hover-color: #2563eb;
}
</style>
