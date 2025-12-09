<template>
  <div class="question-bank-settings">
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">自动将AI返回的题目添加到本地题库</h3>
        <p class="setting-description">(该设置暂时无效，ai返回的答案总是会保存)</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="localSettings.autoAddToQuestionBank" variant="default" size="medium"
          @change="handleSettingChange('autoAddToQuestionBank', $event)" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">开启分析（非思考模型）</h3>
        <p class="setting-description">开启后非思考模型会先进行一段分析，最后给出答案，可提高正确率，但会增加增加回答时间</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="localSettings.enableNonThinkingModelAnalysis" variant="default" size="medium"
          @change="handleSettingChange('enableNonThinkingModelAnalysis', $event)" />
      </div>
    </div>

    <div class="setting-item algorithms-section">
      <div class="section-header">
        <h3 class="setting-title">算法配置</h3>
        <div class="setting-control">
          <button class="btn btn-primary" @click="openAddModal">添加算法</button>
        </div>
      </div>
      <p class="setting-description">添加或删除算法。每个算法包含名称、适用类型、代码。</p>
      <div class="algorithm-config">
        <div class="algorithm-list">
          <div class="algorithm-item" v-for="algo in localSettings.algorithms" :key="algo.id"
            :class="{ active: editingId === algo.id }" @click="selectAlgorithm(algo)"
            @contextmenu.prevent="openAlgorithmContextMenu($event, algo)">
            <div class="algo-meta">
              <div class="algo-name">{{ algo.name }}</div>
              <div class="algo-type">{{ algo.applicableType }}</div>
            </div>
          </div>
          <div v-if="localSettings.algorithms.length === 0" class="empty-tip">暂无算法</div>
        </div>

        <Transition name="modal">
          <div v-if="isModalVisible" class="modal-overlay" @click="cancelEdit">
            <div class="modal-content" @click.stop>
              <div class="algorithm-editor">
                <div class="editor-title">{{ editingId ? '编辑算法' : '添加算法' }}</div>
                <div class="editor-body">
                  <div class="editor-left">
                    <div class="form-label">代码</div>
                    <div class="code-editor">
                      <div ref="cmContainerRef" class="cm-container"></div>
                    </div>
                  </div>
                  <div class="editor-right">
                    <div class="form-row">
                      <label class="form-label">名称</label>
                      <input class="form-input" v-model.trim="newAlgorithm.name" placeholder="输入算法名称" />
                    </div>
                    <div class="form-row">
                      <label class="form-label">适用类型</label>
                      <input class="form-input" v-model.trim="newAlgorithm.applicableType" placeholder="例如：单选/多选/判断" />
                    </div>
                    <div class="form-actions">
                      <button class="btn btn-primary" @click="saveAlgorithm">{{ editingId ? '完成' : '完成' }}</button>
                    </div>
                    <div v-if="formError" class="form-error">{{ formError }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
      <UnifiedContextMenu :visible="algoMenuVisible" :x="algoMenuX" :y="algoMenuY" :menu-items="algoMenuItems"
        @item-click="handleAlgoMenuItemClick" />
    </div>
  </div>


</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import Toggle from '../Toggle.vue'
import type { AlgorithmConfig } from '../../services/settings'
import UnifiedContextMenu, { type MenuItem } from '../UnifiedContextMenu.vue'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { linter, lintGutter } from '@codemirror/lint'
import * as acorn from 'acorn'

// 获取设置管理器
const { settings, setSetting, saveSettings, updateSettings } = useSettingsManager()

// 本地设置状态 - 使用 ref 而不是 reactive 来保持与 useSettingsManager 返回的 settings 响应式连接
// const localSettings = settings
// 由于 localSettings 在模板中被用作 v-model 和直接访问，我们需要确保它是响应式的并且能同步回全局设置
const localSettings = computed({
  get: () => settings.value,
  set: (val) => {
    updateSettings(val)
  }
})

const newAlgorithm = reactive<Pick<AlgorithmConfig, 'name' | 'applicableType' | 'code'>>({
  name: '',
  applicableType: '',
  code: ''
})

const formError = ref('')
const editingId = ref<string | null>(null)
const isEditing = computed(() => !!editingId.value)

const isModalVisible = ref(false)

// CodeMirror 相关
const cmContainerRef = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let themeObserver: MutationObserver | null = null

const initCodeMirror = () => {
  if (!cmContainerRef.value || cmView) return
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark'

  // 轻量语法检查
  const jsSyntaxLinter = linter((view) => {
    const diagnostics = [] as any[]
    const code = view.state.doc.toString()
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true
      })
    } catch (err: any) {
      const pos = typeof err?.pos === 'number' ? err.pos : 0
      diagnostics.push({
        from: Math.max(0, Math.min(pos, view.state.doc.length)),
        to: Math.max(0, Math.min(pos + 1, view.state.doc.length)),
        severity: 'error',
        message: err?.message || 'Syntax error'
      })
    }
    return diagnostics
  })

  const baseExtensions = [
    lineNumbers(),
    javascript(),
    jsSyntaxLinter,
    lintGutter(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        newAlgorithm.code = update.state.doc.toString()
      }
    }),
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
    doc: newAlgorithm.code ?? '',
    extensions: [...baseExtensions, ...themeExtensions]
  })
  cmView = new EditorView({ state, parent: cmContainerRef.value })
}

const setEditorDoc = (text: string) => {
  if (!cmView) return
  const state = cmView.state
  cmView.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text ?? '' } }))
}

// 监听模态框显示状态
watch(isModalVisible, async (visible) => {
  if (visible) {
    await nextTick()
    initCodeMirror()
    if (cmView) {
      setEditorDoc(newAlgorithm.code)
    }
  } else {
    if (cmView) {
      cmView.destroy()
      cmView = null
    }
  }
})

// 处理设置变更
const handleSettingChange = async (key: keyof import('../../services/settings').AppSettings, value: any) => {
  setSetting(key, value)

  // 同步到后端（仅在 Tauri 环境中有效）
  if (key === 'enableNonThinkingModelAnalysis') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_non_thinking_analysis_enabled', { enabled: value })
    } catch (err) {
      // 非 Tauri 环境或调用失败时忽略，并在控制台提示
      console.warn('无法调用后端命令或非 Tauri 环境：', err)
    }
  }
}

const openAddModal = () => {
  editingId.value = null
  formError.value = ''
  newAlgorithm.name = ''
  newAlgorithm.applicableType = ''
  newAlgorithm.code = ''
  isModalVisible.value = true
}

const genId = (): string => {
  const rnd = Math.random().toString(36).slice(2)
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof (crypto as any).randomUUID === 'function') {
    try { return (crypto as any).randomUUID() } catch { return `${Date.now()}_${rnd}` }
  }
  return `${Date.now()}_${rnd}`
}

const addAlgorithm = async (): Promise<boolean> => {
  formError.value = ''
  const name = newAlgorithm.name.trim()
  const type = newAlgorithm.applicableType.trim()
  const code = newAlgorithm.code
  if (!name || !type || !code) {
    formError.value = '请填写完整的算法信息'
    return false
  }
  const algo: AlgorithmConfig = { id: genId(), name, applicableType: type, code }
  const list = [...localSettings.value.algorithms, algo]
  setSetting('algorithms', list)
  await saveSettings()
  newAlgorithm.name = ''
  newAlgorithm.applicableType = ''
  newAlgorithm.code = ''
  return true
}

const updateAlgorithm = async (): Promise<boolean> => {
  if (!editingId.value) return false
  formError.value = ''
  const name = newAlgorithm.name.trim()
  const type = newAlgorithm.applicableType.trim()
  const code = newAlgorithm.code
  if (!name || !type || !code) {
    formError.value = '请填写完整的算法信息'
    return false
  }
  const list = localSettings.value.algorithms.map(a => a.id === editingId.value ? { ...a, name, applicableType: type, code } : a)
  setSetting('algorithms', list)
  await saveSettings()
  editingId.value = null
  newAlgorithm.name = ''
  newAlgorithm.applicableType = ''
  newAlgorithm.code = ''
  return true
}

const saveAlgorithm = async () => {
  let success = false
  if (isEditing.value) {
    success = await updateAlgorithm()
  } else {
    success = await addAlgorithm()
  }
  if (success) {
    // 强制触发设置保存
    await saveSettings()
    isModalVisible.value = false
  }
}

const selectAlgorithm = (algo: AlgorithmConfig) => {
  editingId.value = algo.id
  newAlgorithm.name = algo.name
  newAlgorithm.applicableType = algo.applicableType
  newAlgorithm.code = algo.code
  isModalVisible.value = true
}

const cancelEdit = () => {
  isModalVisible.value = false
  editingId.value = null
  formError.value = ''
  newAlgorithm.name = ''
  newAlgorithm.applicableType = ''
  newAlgorithm.code = ''
}

const deleteAlgorithm = async (id: string) => {
  if (!confirm('确定要删除此算法吗？')) return
  const list = localSettings.value.algorithms.filter(a => a.id !== id)
  setSetting('algorithms', list)
  await saveSettings()
}

const algoMenuVisible = ref(false)
const algoMenuX = ref(0)
const algoMenuY = ref(0)
const algoMenuAlgorithm = ref<AlgorithmConfig | null>(null)

const openAlgorithmContextMenu = (e: MouseEvent, algo: AlgorithmConfig) => {
  e.preventDefault()
  e.stopPropagation()
  algoMenuAlgorithm.value = algo
  algoMenuX.value = e.clientX
  algoMenuY.value = e.clientY
  algoMenuVisible.value = true
}

const hideAlgorithmMenu = () => {
  algoMenuVisible.value = false
}

const algoMenuItems = computed<MenuItem[]>(() => [
  { id: 'edit', label: '编辑', action: 'edit', icon: { type: 'emoji', content: '✏️' } },
  { type: 'divider' },
  { id: 'delete', label: '删除', action: 'delete', danger: true, icon: { type: 'emoji', content: '🗑️' } }
])

const handleAlgoMenuItemClick = async (item: MenuItem) => {
  const algo = algoMenuAlgorithm.value
  if (!algo) return
  if (item.action === 'edit') {
    selectAlgorithm(algo)
  } else if (item.action === 'delete') {
    await deleteAlgorithm(algo.id)
  }
  hideAlgorithmMenu()
}

onMounted(() => {
  document.addEventListener('click', hideAlgorithmMenu)

  // 监听主题变化
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        if (isModalVisible.value) {
          const currentText = cmView ? cmView.state.doc.toString() : newAlgorithm.code
          if (cmView) {
            cmView.destroy()
            cmView = null
          }
          nextTick(() => {
            initCodeMirror()
            if (currentText != null) {
              setEditorDoc(currentText)
            }
          })
        }
      }
    }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  document.removeEventListener('click', hideAlgorithmMenu)
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
})
</script>

<style scoped>
.question-bank-settings {
  /* 继承父组件的样式 */
}

.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 24px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.algorithms-section {
  flex-direction: column;
  justify-content: initial;
  align-items: stretch;
}


.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  width: 100%;
}

.question-bank-settings>.setting-item:last-of-type,
.setting-item.algorithms-section:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 24px;
}

.setting-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.setting-description {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.algorithm-config {
  margin-top: 16px;
  padding-top: 16px;
  width: 100%;
}


.algorithm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-secondary, #fff);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  width: 80%;
  height: 100%;
  overflow-y: auto;
  padding: 20px;
}

.algorithm-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-body {
  display: flex;
  flex: 1;
  gap: 20px;
  height: 0; /* 关键：让 flex item 高度生效 */
}

.editor-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0; /* 防止内容溢出 */
}

.editor-right {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.algorithm-item {
  background-color: var(--model-item-bg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.algorithm-item:hover {
  background-color: var(--model-item-hover-bg);
}

.algorithm-item.active {
  border-color: var(--color-primary, #667eea);
  background: var(--bg-secondary, #f7fafc);
}

.algo-meta {
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.algo-name {
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.algo-type {
  font-size: 12px;
  color: var(--text-secondary);
  width: 60px; /* 固定宽度 */
  text-align: right; /* 右对齐 */
  flex-shrink: 0;
}

.empty-tip {
  color: var(--text-secondary);
  text-align: center;
  padding: 20px;
}



.editor-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.form-row {
  margin-bottom: 12px;
}

.code-editor-row {
  flex: 1;
}



.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
}

.code-editor {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-primary);
}

.cm-container {
  width: 100%;
  height: 100%;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-content) {
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 20px;
}

.code-editor :deep(.cm-gutters) {
  border-right: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-primary, #ffffff);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  cursor: pointer;
}

.btn-primary {
  background: var(--color-primary, #667eea);
  color: #fff;
  border-color: var(--color-primary, #667eea);
}

.btn-danger {
  background: #e53e3e;
  color: #fff;
  border-color: #e53e3e;
}

.form-error {
  margin-top: 8px;
  color: #e53e3e;
  font-size: 13px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95);
  opacity: 0;
}
</style>
