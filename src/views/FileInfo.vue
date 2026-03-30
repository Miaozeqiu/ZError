<template>
  <div class="file-info-page">
    <div class="window-header" data-tauri-drag-region>
      <div class="header-left"></div>
      <div class="header-center"></div>
      <div class="header-right">
        <button class="window-control minimize" @click="minimizeWindow" title="最小化">
          <svg width="12" height="12" viewBox="0 0 1024 1024">
            <path
              d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z"
              fill="currentColor" />
          </svg>
        </button>
        <button class="window-control maximize" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
          <svg width="12" height="12" viewBox="0 0 1024 1024" v-if="!isMaximized">
            <path
              d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z"
              fill="currentColor" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 12 12" v-else>
            <rect x="2" y="3" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none" />
            <rect x="4" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none" />
          </svg>
        </button>
        <button class="window-control close" @click="closeWindow" title="关闭">
          <svg width="12" height="12" viewBox="0 0 1024 1024">
            <path
              d="M897.6 183.5L183 898.1c-7.5 7.5-19.6 7.5-27.1 0l-29.5-29.5c-7.5-7.5-7.5-19.6 0-27.1L841 126.9c7.5-7.5 19.6-7.5 27.1 0l29.5 29.5c7.5 7.4 7.5 19.6 0 27.1z"
              fill="currentColor" />
            <path
              d="M183 126.9l714.7 714.7c7.5 7.5 7.5 19.6 0 27.1l-29.5 29.5c-7.5 7.5-19.6 7.5-27.1 0L126.4 183.5c-7.5-7.5-7.5-19.6 0-27.1l29.5-29.5c7.4-7.5 19.6-7.5 27.1 0z"
              fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
    <div class="main">
      <div class="sidebar">
        <div class="menu-item" :class="{ active: activeTab === 'file' }" @click="setTab('file')">
          <svg class="menu-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
            <path
              d="M381.633 132a90.045 90.045 0 0 1 60.34 23.206l120.801 109.059A30.015 30.015 0 0 0 582.887 272h191.338c49.721 0 90.029 40.294 90.029 90l-0.001 99.999 5.718 0.001C919.693 462 960 502.294 960 552a89.976 89.976 0 0 1-7.79 36.62l-111.392 250C826.352 871.085 794.13 892 758.578 892l-296.362-0.001V892H154.03C104.307 892 64 851.706 64 802V222c0-49.706 40.307-90 90.029-90h227.604zM869.97 522H297.702a30.01 30.01 0 0 0-27.413 17.793l-111.392 250A29.992 29.992 0 0 0 156.3 802c0 16.569 13.436 30 30.01 30h572.269a30.01 30.01 0 0 0 27.413-17.793l111.392-250c1.712-3.842 2.597-8.001 2.597-12.207 0-16.569-13.436-30-30.01-30zM381.633 192H154.029c-16.574 0-30.01 13.431-30.01 30v498.607l91.444-205.227c14.466-32.465 46.688-53.38 82.24-53.38l506.531-0.001V362c0-16.569-13.435-30-30.009-30H582.887a90.045 90.045 0 0 1-60.34-23.206L401.747 199.735A30.015 30.015 0 0 0 381.633 192z"
              fill="currentColor"></path>
          </svg>
          <span>文件选择</span>
        </div>
        <div class="menu-item" :class="{ active: activeTab === 'algo' }" @click="setTab('algo')">
          <svg class="menu-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
            <path
              d="M779.52 111.936c51.2 29.568 56.32 107.136 28.352 213.12l-61.888-16.256c21.056-79.872 17.6-132.16 1.536-141.44-14.4-8.32-55.36 9.856-107.968 58.752-36.8 34.176-75.776 79.808-113.6 132.928h5.44c258.688 0 467.136 64.064 467.136 165.824 0 59.136-64.64 102.4-170.432 131.2l-16.832-61.76c79.68-21.76 123.264-50.816 123.264-69.44 0-16.64-36.224-42.944-104.896-64.064-77.76-23.936-184.32-37.76-298.24-37.76-16.384 0-32.64 0.256-48.64 0.768a1368.192 1368.192 0 0 0-62.464 110.912c7.296 13.696 14.912 27.392 22.848 41.088 56.96 98.752 122.24 184.064 181.888 239.424 52.608 48.896 93.504 67.136 107.904 58.816 15.616-9.024 19.456-59.072-0.128-136.128-12.352-48.64-32.896-104.32-60.16-162.56l57.984-27.136c28.864 61.696 50.816 121.152 64.192 173.952 26.24 102.976 20.48 178.24-29.888 207.296-88.128 50.88-247.872-97.536-377.216-321.664l-0.768-1.152a831.36 831.36 0 0 0-45.696 136.128c-16 70.016-11.328 114.56 3.072 122.88 15.616 8.96 60.928-12.736 117.824-68.224l44.672 45.824c-76.16 74.24-144.192 106.88-194.496 77.76-74.56-43.008-51.2-201.856 36.16-385.472-15.936-31.616-30.08-62.656-42.368-92.672-26.368 5.12-50.88 11.072-73.024 17.92-68.672 21.12-104.896 47.424-104.896 64.064 0 18.048 41.472 46.4 117.952 67.968l-17.344 61.568c-102.272-28.8-164.608-71.424-164.608-129.536 0-65.92 87.424-115.968 219.264-143.104-42.432-127.744-42.752-228.48 14.336-261.44 51.2-29.568 120.96 4.8 198.784 81.984l-45.056 45.44c-58.624-58.112-105.6-81.28-121.728-72-14.4 8.32-19.136 52.864-3.072 122.88 5.12 22.592 12.16 46.784 20.992 72.128 31.36-4.224 64.448-7.424 98.944-9.408 119.808-182.592 254.592-294.592 332.8-249.408zM380.416 431.488l-8.96 1.088c4.352 10.304 8.96 20.736 13.76 31.296 5.504-10.112 11.2-20.224 17.024-30.336l2.688-4.672c-8.256 0.768-16.448 1.664-24.512 2.56z"
              fill="currentColor"></path>
          </svg>
          <span>算法选择</span>
        </div>
        <div class="menu-item" :class="{ active: activeTab === 'bank' }" @click="setTab('bank')">
          <svg class="menu-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
            <path
              d="M959.825 384.002V191.94c0-70.692-57.308-128-128-128H191.94c-70.692 0-128 57.308-128 128v639.885c0 70.692 57.308 128 128 128h639.885c70.692 0 128-57.308 128-128V384.002z m-813.16-237.337a63.738 63.738 0 0 1 45.336-18.785H832a63.962 63.962 0 0 1 63.886 64.121v128.061H127.88v-128.06a63.738 63.738 0 0 1 18.785-45.337z m269.127 461.308v-223.97h192.181v223.97H415.792z m192.181 63.94v223.972H415.792V671.914h192.181z m-256.121-63.94H127.88v-223.97h223.972v223.97zM146.665 877.21a63.467 63.467 0 0 1-18.785-45.21V671.914h223.972v223.97h-159.85a63.626 63.626 0 0 1-45.337-18.675z m749.22-45.21a63.763 63.763 0 0 1-63.886 63.886H671.914V671.914h223.97v160.085z m0-224.026H671.914v-223.97h223.97v223.97z"
              fill="currentColor"></path>
          </svg>
          <span>题库预览</span>
        </div>
      </div>
      <div class="content">
        <div v-if="activeTab === 'file'" class="box file-preview-box">
          <div class="file-path-section">
            <div class="label">文件路径：</div>
            <div class="name" :title="filePath">{{ filePath }}</div>
            <button class="btn btn-sm" @click="reselectFile">重新选择文件</button>
            <button class="btn btn-sm" @click="loadFilePreview" :disabled="isPreviewLoading">刷新预览</button>
          </div>
          <div class="file-content-preview">
            <div v-if="isPreviewLoading" class="loading">读取中...</div>
            <pre v-else class="content-text">{{ fileContent || '暂无内容或无法读取' }}</pre>
          </div>
        </div>
        <div v-else-if="activeTab === 'algo'" class="algo-container">
          <div class="algo-list">
            <div class="algo-item"
              :class="{ active: selectedAlgorithmId === AI_GENERATE_ID, disabled: isDocUnconverted }"
              @click="selectAlgorithmGuarded(AI_GENERATE_ID)">
              <div class="algo-title">使用AI模型生成导入算法</div>
              <div class="algo-meta">通过当前文本模型自动生成</div>
            </div>
            <div v-for="algo in algorithms" :key="algo.id" class="algo-item"
              :class="{ active: algo.id === selectedAlgorithmId, disabled: isDocUnconverted }"
              @click="selectAlgorithmGuarded(algo.id)">
              <div class="algo-title">{{ algo.name }}</div>
              <div class="algo-meta">{{ algo.applicableType }}</div>
            </div>
            <div v-if="algorithms.length === 0" class="placeholder">暂无算法，请在设置中添加</div>
          </div>
          <div class="algo-detail" v-if="selectedAlgorithmId === AI_GENERATE_ID">
            <div class="detail-title">使用AI模型生成导入算法</div>
            <div class="detail-type">当前文本模型：{{ currentTextModelName }}</div>
            <div class="ai-actions">
              <button class="btn btn-primary" :disabled="!filePath || isDocUnconverted"
                @click="aiRunning ? stopAIHeaderExtraction() : runAIHeaderExtraction()">{{ aiRunning ? '停止生成' : '生成算法'
                }}</button>
              <span v-if="aiRunning" class="ai-status">正在识别...</span>
            </div>
            <div class="ai-output" v-if="false">
              <div class="result-title">模型输出</div>
              <MarkdownRenderer :content="aiOutput" />
            </div>
            <div class="ai-code" v-if="finalAlgoCode">
              <div class="result-title">算法参考</div>
              <div class="code-editor">
                <div ref="cmFinalRef" class="cm-container" :key="finalAlgoCode"></div>
              </div>
            </div>
            <div class="ai-actions" v-if="finalAlgoCode">
              <button class="btn btn-primary" :disabled="aiRunning || isDocUnconverted"
                @click="selectAiAlgorithmAndPreview">选择该算法</button>
              <button class="btn" :disabled="aiRunning || isDocUnconverted"
                @click="saveGeneratedAlgorithm">保存算法</button>
            </div>
            <div class="ai-result" v-if="aiHeaders.length > 0">
              <div class="result-title">表头</div>
              <div class="headers">
                <span class="header" v-for="(h, i) in aiHeaders" :key="i">{{ h }}</span>
              </div>
            </div>
            <div class="placeholder" v-else-if="aiError">{{ aiError }}</div>
          </div>
          <div class="algo-detail" v-else-if="selectedAlgorithm">
            <div class="detail-title">{{ selectedAlgorithm.name }}</div>
            <div class="detail-type">适用类型：{{ selectedAlgorithm.applicableType }}</div>
            <div class="code-editor">
              <div ref="cmSelectedRef" class="cm-container" :key="selectedAlgorithmId"></div>
            </div>
            <div class="detail-actions">
              <button class="btn btn-primary" :disabled="isDocUnconverted" @click="confirmSelection">选择该算法</button>
              <button class="btn" @click="clearSelection" v-if="selectedAlgorithmId">取消选择</button>
            </div>
          </div>
          <div class="algo-detail" v-else>
            <div class="placeholder" v-if="isDocUnconverted">当前是DOC文件，需在“文件选择”中完成转换并刷新预览后再选择算法</div>
            <div class="placeholder" v-else>请选择左侧算法查看详情</div>
          </div>
        </div>
        <div v-else-if="activeTab === 'bank'" class="preview-container">
          <div v-if="previewItems.length === 0" class="placeholder">{{ previewError || '暂无预览数据' }}</div>
          <div v-else class="preview-list">
            <div class="preview-item" v-for="(item, i) in pagedItems" :key="i">
              <div class="preview-question">{{ item.Question }}</div>
              <div class="preview-type">类型：{{ item.QuestionType }}</div>
              <div class="preview-options" v-if="item.Options && item.Options.length">
                <div class="option" v-for="(opt, idx) in item.Options" :key="idx">{{ opt }}</div>
              </div>
              <div class="preview-answer">答案：{{ item.Answer }}</div>
            </div>
          </div>
          <div class="pagination">
            <div class="page-info">第 {{ currentPage }} / {{ totalPages }} 页，共 {{ previewItems.length }} 条</div>
            <div class="page-actions">
              <button class="btn" :disabled="currentPage <= 1" @click="prevPage">上一页</button>
              <button class="btn" :disabled="currentPage >= totalPages" @click="nextPage">下一页</button>
              <select class="page-size" v-model.number="pageSize">
                <option :value="10">每页 10 条</option>
                <option :value="20">每页 20 条</option>
                <option :value="50">每页 50 条</option>
                <option :value="0">全部</option>
              </select>
              <button class="btn btn-primary" @click="openImportDialog">导入</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Transition name="modal">
      <div v-if="showSaveModal" class="modal-overlay" @click="cancelSaveAlgorithm">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <div class="modal-title">保存算法</div>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>算法名称</label>
              <input v-model="saveAlgoName" class="form-input" placeholder="请输入算法名称" @keyup.enter="confirmSaveAlgorithm"
                v-focus />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn" @click="cancelSaveAlgorithm">取消</button>
            <button class="btn btn-primary" @click="confirmSaveAlgorithm" :disabled="!saveAlgoName.trim()">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useSettingsManager } from '../composables/useSettingsManager'
import { useModelConfig } from '../services/modelConfig'
import MarkdownRenderer from '../components/MarkdownRenderer.vue'
import { isTauriEnvironment } from '../services/environmentDetector'
import { readExcelHeaders, readExcelRange, readDocxRange, readDocRange, readFileBase64, readFileText } from '../utils/fileReader'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '../composables/useTheme'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const filePath = ref('')
const isMaximized = ref(false)
const activeTab = ref<'file' | 'algo' | 'bank'>('file')
const b64ToUint8 = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const setTab = (tab: 'file' | 'algo' | 'bank') => {
  activeTab.value = tab
}

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
}

const { initTheme, cleanup: cleanupTheme } = useTheme()
let unlistenTheme: (() => void) | null = null

onMounted(async () => {
  try { await initTheme() } catch { }
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenTheme = await listen('theme-changed', (event: any) => {
      const payload = event?.payload as any
      const root = document.documentElement
      root.removeAttribute('data-theme')
      const theme = payload?.theme
      if (theme && theme !== 'light') {
        root.setAttribute('data-theme', theme)
      }
    })
  } catch { }
})


const minimizeWindow = async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.minimize()
  } catch { }
}

const toggleMaximize = async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    if (isMaximized.value) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
    isMaximized.value = !isMaximized.value
  } catch { }
}

const closeWindow = async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.close()
  } catch { }
}

const reselectFile = async () => {
  try {
    if (!isTauriEnvironment()) {
      alert('此功能仅在 Tauri 应用中可用')
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ multiple: false, directory: false })
    if (selected) {
      const path = Array.isArray(selected) ? (selected[0] as string) : (selected as string)
      filePath.value = path
      activeTab.value = 'file'
      await nextTick()
      loadFilePreview()
    }
  } catch (e) {
    alert(String((e as any)?.message || e))
  }
}

onMounted(() => {
  let name = ''
  if (window.location.search && window.location.search.includes('name=')) {
    const params = new URLSearchParams(window.location.search)
    name = params.get('name') || ''
  } else if (window.location.hash) {
    const hash = window.location.hash
    const i = hash.indexOf('?')
    if (i >= 0) {
      const qs = hash.substring(i + 1)
      const params = new URLSearchParams(qs)
      name = params.get('name') || ''
    }
  }
  filePath.value = decodeURIComponent(name)
})

const fileContent = ref<string>('')
const isPreviewLoading = ref(false)

const loadFilePreview = async () => {
  if (!filePath.value) return
  isPreviewLoading.value = true
  fileContent.value = ''
  try {
    const fext = (filePath.value || '').toLowerCase()
    if (fext.endsWith('.xlsx') || fext.endsWith('.xls')) {
      const { data: rows } = await readExcelRange(filePath.value, 0, 20)
      fileContent.value = rows.map(r => r.join(' | ')).join('\n')
    } else if (fext.endsWith('.docx')) {
      const { data: paragraphs } = await readDocxRange(filePath.value, 0, 50)
      fileContent.value = paragraphs.join('\n')
    } else if (fext.endsWith('.doc')) {
      let targetPath = filePath.value
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
        if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
          targetPath = out
          filePath.value = targetPath
        }
      } catch { }
      if (targetPath.toLowerCase().endsWith('.docx')) {
        const { data: paragraphs } = await readDocxRange(targetPath, 0, 50)
        fileContent.value = paragraphs.join('\n')
      } else {
        const { data: paragraphs } = await readDocRange(filePath.value, 0, 50)
        fileContent.value = paragraphs.join('\n')
      }
    } else if (fext.endsWith('.pdf')) {
      const b64 = await readFileBase64(filePath.value)
      const bytes = b64ToUint8(b64)
      try {
        const task = pdfjsLib.getDocument({ data: bytes })
        const doc = await task.promise
        const texts: string[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const text = await page.getTextContent()
          const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
          if (pageText.trim()) texts.push(pageText.trim())
        }
        fileContent.value = texts.join('')
        if (fileContent.value.length > 5000) {
          fileContent.value = fileContent.value.slice(0, 5000) + '...'
        }
      } catch (err) {
        fileContent.value = '无法读取文件内容: PDF解析失败'
      }
    } else {
      fileContent.value = await readFileText(filePath.value)
      if (fileContent.value.length > 5000) {
        fileContent.value = fileContent.value.slice(0, 5000) + '...'
      }
    }
  } catch (e) {
    fileContent.value = `无法读取文件内容: ${(e as any).message || e}`
  } finally {
    isPreviewLoading.value = false
  }
}

watch(() => filePath.value, () => {
  if (activeTab.value === 'file') {
    loadFilePreview()
  }
})

watch(() => activeTab.value, (newTab) => {
  if (newTab === 'file' && !fileContent.value) {
    loadFilePreview()
  }
})

const { settings, setSetting, saveSettings } = useSettingsManager()
const algorithms = computed(() => settings.value.algorithms || [])
const selectedAlgorithmId = ref<string | null>(null)
const selectedAlgorithm = computed(() => algorithms.value.find(a => a.id === selectedAlgorithmId.value) || null)
const isDocUnconverted = computed(() => {
  const p = (filePath.value || '').toLowerCase()
  return p.endsWith('.doc')
})
const AI_GENERATE_ID = '__ai_generate__'

const { selectedTextModel } = useModelConfig()
const currentTextModelName = computed(() => selectedTextModel.value?.displayName || '未选择')

const storageKey = computed(() => {
  const p = filePath.value || ''
  return `file-info:selected-algorithm:${p}`
})

onMounted(() => {
  try {
    const saved = localStorage.getItem(storageKey.value)
    if (saved) selectedAlgorithmId.value = saved
  } catch { }
})

const selectAlgorithm = (id: string) => {
  selectedAlgorithmId.value = id
  if (id === AI_GENERATE_ID) {
    aiHeaders.value = []
    aiError.value = ''
    aiRunning.value = false
  }
}
const selectAlgorithmGuarded = (id: string) => {
  if (isDocUnconverted.value) {
    aiError.value = '当前是DOC文件，请在“文件选择”中完成转换并刷新预览后再选择算法'
    activeTab.value = 'file'
    return
  }
  selectAlgorithm(id)
}


const clearSelection = () => {
  selectedAlgorithmId.value = null
  try {
    localStorage.removeItem(storageKey.value)
  } catch { }
}

// 不再自动注入示例算法，保持用户算法为空时不显示数据

type PreviewItem = { Question: string; Options: string[]; QuestionType: string; Answer: string }
const previewItems = ref<PreviewItem[]>([])

const normalizeItem = (x: any): PreviewItem | null => {
  if (!x || (typeof x !== 'object')) return null
  const q = x.Question ?? x.question ?? x.title ?? ''
  const rawOptions = x.Options ?? x.options ?? x.choices ?? x.choice ?? x.opts
  let options: string[] = []
  if (Array.isArray(rawOptions)) {
    options = rawOptions.map((o: any) => String(o))
  } else if (rawOptions && typeof rawOptions === 'object') {
    const keys = Object.keys(rawOptions)
    options = keys.map(k => `${k}. ${String((rawOptions as any)[k])}`)
  } else if (typeof rawOptions === 'string') {
    options = rawOptions.split(/[\n\r,;]+/).map(s => s.trim()).filter(Boolean)
  }
  let t = x.QuestionType ?? x.type ?? x.questionType ?? ''
  t = String(t)
  const typeMap: Record<string, string> = {
    single: '单选', multiple: '多选', boolean: '判断', tf: '判断', true_false: '判断'
  }
  const typeLower = t.toLowerCase()
  const mappedType = typeMap[typeLower] || (['单选', '多选', '判断'].includes(t) ? t : '单选')
  let ans = x.Answer ?? x.answer ?? ''
  if (Array.isArray(ans)) ans = ans.join(',')
  if (typeof ans === 'boolean') ans = ans ? '对' : '错'
  ans = String(ans).trim()

  // Process answer to replace A/B/C/D with full option content if options exist
  if (options.length > 0) {
    // Check if answer looks like "A" or "A,B" or "ABCD" or "A B"
    // Allow continuous letters for multiple choice like "ABCD"
    if (/^[A-Za-z]+(?:[#,，\s]+[A-Za-z]+)*$/.test(ans)) {
      // If it looks like "ABCD", split into chars. If "A,B", split by separator
      let letters: string[] = []
      if (/^[A-Za-z]+$/.test(ans)) {
        letters = ans.split('').map(l => l.toUpperCase())
      } else {
        letters = ans.split(/[#,，\s]+/).map(l => l.toUpperCase())
      }

      const mappedAns: string[] = []
      for (const letter of letters) {
        const idx = letter.charCodeAt(0) - 65 // 'A' -> 0
        if (idx >= 0 && idx < options.length) {
          let optContent = options[idx]
          // Remove prefix like "A." or "A "
          optContent = optContent.replace(/^[A-Z][\.\s、．]+/, '').trim()
          mappedAns.push(optContent)
        } else {
          mappedAns.push(letter) // Keep original if index out of bounds
        }
      }
      if (mappedAns.length > 0) {
        ans = mappedAns.join('###')
      }
    }
  }

  const question = String(q)
  if (!question) return null
  return { Question: question, Options: options, QuestionType: mappedType, Answer: ans }
}

const previewError = ref('')
const runSelectedAlgorithm = async (): Promise<boolean> => {
  const algo = selectedAlgorithm.value
  if (!algo) return false
  let result: any = null
  try {
    const code = String(algo.code || '')
    try { console.log('运行算法', { id: algo.id, name: algo.name, applicableType: algo.applicableType }) } catch { }
    let fileText: string | null = null
    let fileBytesBase64: string | null = null
    let paragraphs: string[] = []

    try {
      const fext = (filePath.value || '').toLowerCase()
      if (fext.endsWith('.xlsx') || fext.endsWith('.xls')) {
        fileBytesBase64 = await readFileBase64(filePath.value)
      } else if (fext.endsWith('.docx')) {
        const { data } = await readDocxRange(filePath.value, 0, 1000000)
        paragraphs = data
      } else if (fext.endsWith('.doc')) {
        let targetPath = filePath.value
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
          if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
            targetPath = out
            filePath.value = targetPath
          }
        } catch { }
        if (targetPath.toLowerCase().endsWith('.docx')) {
          const { data } = await readDocxRange(targetPath, 0, 1000000)
          paragraphs = data
        } else {
          const { data } = await readDocRange(filePath.value, 0, 1000000)
          paragraphs = data
        }
      } else if (fext.endsWith('.pdf')) {
        const b64 = await readFileBase64(filePath.value)
        const bytes = b64ToUint8(b64)
        const task = pdfjsLib.getDocument({ data: bytes })
        const doc = await task.promise
        let allText = ''
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const text = await page.getTextContent()
          const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
          if (pageText.trim()) allText += pageText.trim()
        }
        fileText = allText
      } else {
        fileText = await readFileText(filePath.value)
      }
    } catch (e) {
      previewError.value = `读取文件失败：${String((e as any)?.message || e)}`
      try { console.error('读取文件失败', { error: String((e as any)?.message || e) }) } catch { }
      return false
    }

    let xlsxLib: any = null
    try {
      const mod = await import('xlsx')
      xlsxLib = mod
    } catch (e) { }

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const libs = { xlsx: xlsxLib, escapeRegExp }
    const fn = new Function('input', 'libs', `${code}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
    const input = { filePath: filePath.value, fileText, fileBytesBase64, paragraphs }
    try { console.log('运行参数', { filePath: input.filePath, fileTextLength: input.fileText ? input.fileText.length : 0, fileBytesBase64Length: input.fileBytesBase64 ? input.fileBytesBase64.length : 0 }) } catch { }
    result = await fn(input, libs)
    try {
      if (Array.isArray(result)) {
        console.log('算法返回数组', { length: result.length, sample: result[0] })
      } else {
        console.log('算法返回对象', result)
      }
    } catch { }
  } catch { }
  if (result && result.__error) {
    previewError.value = `算法执行异常：${result.__error}`
    try { console.error('算法执行异常', { error: result.__error }) } catch { }
    previewItems.value = []
    currentPage.value = 1
    activeTab.value = 'bank'
    return false
  }
  if (Array.isArray(result)) {
    const normalized = result.map(normalizeItem).filter(Boolean) as PreviewItem[]
    if (normalized.length) {
      previewItems.value = normalized
      previewError.value = ''
      pageSize.value = 10
      currentPage.value = 1
      activeTab.value = 'bank'
      return true
    }
  }
  previewError.value = '算法返回数据无效或为空，请检查字段'
  try { console.warn('算法返回数据无效或为空') } catch { }
  previewItems.value = []
  currentPage.value = 1
  activeTab.value = 'bank'
  return false
}

const confirmSelection = async () => {
  try {
    if (selectedAlgorithmId.value) {
      localStorage.setItem(storageKey.value, selectedAlgorithmId.value)
    }
  } catch { }
  await runSelectedAlgorithm()
}
const pageSize = ref<number>(10)
const currentPage = ref<number>(1)
const totalPages = computed(() => {
  const total = previewItems.value.length
  const size = pageSize.value
  return total === 0 ? 1 : (size <= 0 ? 1 : Math.ceil(total / size))
})
const pagedItems = computed(() => {
  const size = pageSize.value
  if (size <= 0) return previewItems.value
  const start = (currentPage.value - 1) * size
  return previewItems.value.slice(start, start + size)
})
const prevPage = () => {
  if (currentPage.value > 1) currentPage.value -= 1
}
const nextPage = () => {
  if (currentPage.value < totalPages.value) currentPage.value += 1
}

const openImportDialog = async () => {
  const payload = { items: previewItems.value };
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('open-import-dialog', payload)
    // 尝试聚焦主窗口
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      // 如果当前是在独立窗口中运行（即 isFileInfoPage 为 true），我们可能需要找到主窗口并聚焦它
      // 但是 Tauri 前端 API 主要是针对当前窗口的。
      // 我们可以通过发出一个事件，让主窗口监听到事件后自己调用 setFocus。
      // 上面的 open-import-dialog 事件已经被主窗口监听了。

      // 如果当前本身就是主窗口（不太可能，因为 FileInfo 通常在独立窗口），直接聚焦自己
      // 如果是在独立窗口，尝试聚焦该窗口本身可能没意义，因为用户想要的是激活主窗口。
      // 不过通常 open-import-dialog 事件处理逻辑会在主窗口中执行，
      // 我们可以在主窗口接收到该事件时，执行窗口聚焦操作。
    } catch { }
  } catch {
    try { window.dispatchEvent(new CustomEvent('open-import-dialog', { detail: payload })) } catch { }
  }
}

const aiRunning = ref(false)
const aiAbortController = ref<AbortController | null>(null)
const aiHeaders = ref<string[]>([])
const aiError = ref('')
const aiOutput = ref('')
const finalAlgoCode = ref('')
const truncate = (s: string, max = 8000) => {
  s = String(s)
  return s.length > max ? s.slice(0, max) : s
}
const limitRows = (rows: any[], maxRows = 20, maxCell = 300) => {
  const sliced = rows.slice(0, maxRows)
  return sliced.map((r: any[]) => r.map(v => String(v ?? '').slice(0, maxCell)))
}
const limitParagraphs = (pars: string[], maxPars = 20, maxLen = 800) => {
  const sliced = pars.slice(0, maxPars)
  return sliced.map(p => String(p ?? '').slice(0, maxLen))
}
const limitPages = (pages: string[], maxPages = 20, maxLen = 800) => {
  const sliced = pages.slice(0, maxPages)
  return sliced.map(p => String(p ?? '').slice(0, maxLen))
}

const cmFinalRef = ref<HTMLElement | null>(null)
let cmFinalView: EditorView | null = null
const cmSelectedRef = ref<HTMLElement | null>(null)
let cmSelectedView: EditorView | null = null
let algoThemeObserver: MutationObserver | null = null

const buildExtensions = () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const base = [
    javascript(),
    EditorState.readOnly.of(true),
    EditorView.theme({
      '&.cm-editor': { height: '100%', width: '100%', maxWidth: '100%' },
      '.cm-content': { fontFamily: "'Consolas','Monaco','Courier New',monospace", fontSize: '13px', lineHeight: '20px' },
      '.cm-scroller': { overflow: 'auto', overflowX: 'auto' }
    })
  ]
  const theme = isDark ? [oneDark] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
  return [...base, ...theme]
}

const initFinalEditor = async () => {
  if (!cmFinalRef.value) return
  if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
  const state = EditorState.create({ doc: String(finalAlgoCode.value || ''), extensions: buildExtensions() })
  cmFinalView = new EditorView({ state, parent: cmFinalRef.value })
}
const setFinalDoc = (text: string) => {
  if (!cmFinalView) return
  const state = cmFinalView.state
  cmFinalView.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text ?? '' } }))
}

const initSelectedEditor = async () => {
  if (!cmSelectedRef.value) return
  if (cmSelectedView) { cmSelectedView.destroy(); cmSelectedView = null }
  const state = EditorState.create({ doc: String(selectedAlgorithm.value?.code || ''), extensions: buildExtensions() })
  cmSelectedView = new EditorView({ state, parent: cmSelectedRef.value })
}
const setSelectedDoc = (text: string) => {
  if (!cmSelectedView) return
  const state = cmSelectedView.state
  cmSelectedView.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text ?? '' } }))
}

watch(() => finalAlgoCode.value, async (code) => {
  await nextTick()
  if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
  await initFinalEditor()
  setFinalDoc(String(code || ''))
})
watch(() => selectedAlgorithmId.value, async (id) => {
  await nextTick()
  if (id === AI_GENERATE_ID) {
    if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
    if (finalAlgoCode.value && cmFinalRef.value) {
      await initFinalEditor()
      setFinalDoc(String(finalAlgoCode.value || ''))
    }
    if (cmSelectedView) { cmSelectedView.destroy(); cmSelectedView = null }
  } else {
    if (cmSelectedView) { cmSelectedView.destroy(); cmSelectedView = null }
    await initSelectedEditor()
    setSelectedDoc(String(selectedAlgorithm.value?.code || ''))
    if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
  }
})
watch(() => activeTab.value, async (tab) => {
  if (tab === 'algo') {
    await nextTick()
    if (finalAlgoCode.value) await initFinalEditor()
    if (selectedAlgorithm.value) await initSelectedEditor()
  }
})

onMounted(() => {
  algoThemeObserver = new MutationObserver(async (mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        const finalText = cmFinalView ? cmFinalView.state.doc.toString() : String(finalAlgoCode.value || '')
        const selText = cmSelectedView ? cmSelectedView.state.doc.toString() : String(selectedAlgorithm.value?.code || '')
        if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
        if (cmSelectedView) { cmSelectedView.destroy(); cmSelectedView = null }
        await nextTick()
        if (cmFinalRef.value) { await initFinalEditor(); setFinalDoc(finalText) }
        if (cmSelectedRef.value) { await initSelectedEditor(); setSelectedDoc(selText) }
      }
    }
  })
  algoThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  if (cmFinalView) { cmFinalView.destroy(); cmFinalView = null }
  if (cmSelectedView) { cmSelectedView.destroy(); cmSelectedView = null }
  if (algoThemeObserver) { algoThemeObserver.disconnect(); algoThemeObserver = null }
  if (unlistenTheme) { try { unlistenTheme() } catch { } unlistenTheme = null }
  try { cleanupTheme() } catch { }
})
const runAIHeaderExtraction = async () => {
  if (!filePath.value) {
    aiError.value = '未选择文件'
    return
  }
  if (!selectedTextModel.value) {
    aiError.value = '未选择文本模型'
    return
  }
  aiRunning.value = true
  aiAbortController.value = new AbortController()
  aiError.value = ''
  aiHeaders.value = []
  aiOutput.value = ''
  try {
    const { platforms } = useModelConfig()
    const platform = platforms.value.find(p => p.id === selectedTextModel.value!.platformId)
    if (!platform || !platform.apiKey || !platform.baseUrl) {
      aiError.value = '模型平台未配置'
      aiRunning.value = false
      return
    }
    let tauriFetch: any
    try {
      const httpMod: any = await import('@tauri-apps/plugin-http')
      tauriFetch = httpMod.fetch
    } catch {
      tauriFetch = fetch
    }
    const extForSample = (filePath.value || '').toLowerCase()
    const isPdfTypeForSample = extForSample.endsWith('.pdf')
    const isTxtTypeForSample = extForSample.endsWith('.txt')
    const isDocTypeForSample = extForSample.endsWith('.docx') || extForSample.endsWith('.doc')
    const sampleAlgorithmCodeExcel = `function runAlgorithm(input, libs) {
  const XLSX = libs.xlsx;
  const base64 = String(input.fileBytesBase64 || '');
  const fp = String(input.filePath || '');
  const name = fp.split(/[\\/]/).pop() || fp;
  if (!XLSX || !base64) { return []; }
  const wb = XLSX.read(base64, { type: 'base64' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || !rows.length) return [];
  const header = rows[0].map(v => String(v || '').trim());
  const map = buildHeaderMap(header);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const q = get(row, map, '大题题干');
    const a = get(row, map, '选项A');
    const b = get(row, map, '选项B');
    const c = get(row, map, '选项C');
    const t = get(row, map, '题目类型') || '单选';
    let ans = get(row, map, '正确答案') || '';
    const options = [a, b, c].filter(Boolean).map(String);
    if (!q) continue;
    out.push({ Question: String(q), Options: options, QuestionType: String(t), Answer: String(ans) });
  }
  return out;
  function buildHeaderMap(header) {
    const alias = {
      '大题题干': ['大题题干','题干','Question','question','题目'],
      '选项A': ['选项A','A','A选项','OptionA'],
      '选项B': ['选项B','B','B选项','OptionB'],
      '选项C': ['选项C','C','C选项','OptionC'],
      '题目类型': ['题目类型','类型','Type','type','QuestionType'],
      '正确答案': ['正确答案','答案','Answer','answer']
    };
    const map = {};
    for (const key in alias) {
      const names = alias[key];
      let idx = -1;
      for (let i = 0; i < header.length; i++) {
        const h = header[i];
        if (names.some(n => String(n).toLowerCase() === h.toLowerCase())) { idx = i; break; }
      }
      if (idx >= 0) map[key] = idx;
    }
    return map;
  }
  function get(row, map, k) {
    const idx = map[k];
    return idx != null ? String((row[idx] || '')).trim() : '';
  }
}`
    const sampleAlgorithmCodeDocx = `function runAlgorithm(input, libs) {
  const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
  const out = [];
  let currentQuestion = null;
  
  for (let i = 0; i < paragraphs.length; i++) {
    const t = String(paragraphs[i] || '').trim();
    if (!t) continue;
    
    // 匹配题目开始 (例如 "1.单选题(1分)")
    const startMatch = t.match(/^(\d+)[\.、]\s*(\w+)(?:\(.*\))?$/);
    if (startMatch) {
      if (currentQuestion) out.push(currentQuestion);
      currentQuestion = {
        Question: '',
        Options: [],
        QuestionType: startMatch[2].includes('多选') ? '多选' : (startMatch[2].includes('单选') ? '单选' : '简答'),
        Answer: ''
      };
      continue; // 这一行只是题号和类型
    }
    
    if (!currentQuestion) continue;
    
    // 匹配答案
    const ansMatch = t.match(/^我的答案：([A-D]+)$/);
    if (ansMatch) {
      currentQuestion.Answer = ansMatch[1];
      continue;
    }
    
    // 匹配选项 (例如 "A 选项内容")
    const optMatch = t.match(/^([A-D])\s*(.*)$/);
    if (optMatch) {
      currentQuestion.Options.push(optMatch[1] + '.' + optMatch[2]);
      continue;
    }
    
    // 否则是题干的一部分
    if (!currentQuestion.Question) {
      currentQuestion.Question = t;
    } else {
      currentQuestion.Question += '\\n' + t;
    }
  }
  
  if (currentQuestion) out.push(currentQuestion);
  return out;
}`
    const sampleAlgorithmCodePdf = `function runAlgorithm(input, libs) {
  const text = String(input.fileText || input.text || (Array.isArray(input.pages) ? input.pages.join('\n') : '') || '').trim();
  if (!text) return [];
  const norm = text.replace(/\r\n|\r/g, '\n').replace(/\n{2,}/g, '\n');
  let segments = norm.split(/(?=第\s*\d+\s*题[：: ])/g);
  if (segments.length < 2) segments = norm.split(/\n{2,}/g);
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    let t = String(segments[i] || '').trim();
    if (!t) continue;
    const ms = Array.from(t.matchAll(/\b([A-D])[\.)、．]\s*([^\n]+?)(?=\s*[A-D][\.)、．]|$)/g));
    const options = ms.map(m => String(m[2] || '').trim());
    let question = t;
    if (ms.length) {
      const idx = t.search(/\b[A-D][\.)、．]/);
      if (idx > 0) question = t.slice(0, idx).replace(/^第\s*\d+\s*题[：: ]?/, '').trim();
    } else {
      question = t.split(/\n/)[0].replace(/^第\s*\d+\s*题[：: ]?/, '').trim();
    }
    const am = t.match(/(?:正确答案|答案)[：:]\s*([A-D]|[A-D](?:[,，][A-D])+|[\w]+)/i);
    const answer = am ? String(am[1] || '').trim() : '';
    const type = options.length ? ((/[,，]/.test(answer) || (answer.split(/[,,\s，]+/).length > 1)) ? '多选' : '单选') : '简答';
    out.push({ Question: question, Options: options, QuestionType: type, Answer: answer });
  }
  return out;
}`
    const ext = (filePath.value || '').toLowerCase()
    let previewMsg = ''
    let sampleCode = ''

    try {
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        const headers = await readExcelHeaders(filePath.value)
        aiHeaders.value = headers
        const { data: rows } = await readExcelRange(filePath.value, 0, 20)
        const safeRows = limitRows(rows)
        previewMsg = `文件类型: Excel\n表头: ${JSON.stringify(headers)}\n前20行数据预览: ${JSON.stringify(safeRows)}`
        sampleCode = sampleAlgorithmCodeExcel
      } else if (ext.endsWith('.docx')) {
        const { data: paragraphs } = await readDocxRange(filePath.value, 0, 8000)
        const safePars = limitParagraphs(paragraphs, 8000)
        previewMsg = `文件类型: DOCX\n前8000段落预览: ${JSON.stringify(safePars)}`
        sampleCode = sampleAlgorithmCodeDocx
      } else if (ext.endsWith('.doc')) {
        let targetPath = filePath.value
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
          if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
            targetPath = out
            filePath.value = targetPath
          }
        } catch { }
        const { data: paragraphs } = targetPath.toLowerCase().endsWith('.docx')
          ? await readDocxRange(targetPath, 0, 8000)
          : await readDocRange(filePath.value, 0, 8000)
        const safePars = limitParagraphs(paragraphs, 8000)
        previewMsg = `文件类型: DOC\n前8000段落预览: ${JSON.stringify(safePars)}`
        sampleCode = sampleAlgorithmCodeDocx
      } else if (ext.endsWith('.pdf')) {
        const b64 = await readFileBase64(filePath.value)
        const bytes = b64ToUint8(b64)
        const task = pdfjsLib.getDocument({ data: bytes })
        const doc = await task.promise
        let allText = ''
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const text = await page.getTextContent()
          const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
          if (pageText.trim()) allText += pageText.trim()
        }
        const safeText = allText.slice(0, 8000)
        previewMsg = `文件类型: PDF\n前8000字符预览: ${JSON.stringify(safeText)}`
        sampleCode = sampleAlgorithmCodePdf
      } else if (ext.endsWith('.txt')) {
        const allText = await readFileText(filePath.value)
        const safeText = allText.slice(0, 8000)
        previewMsg = `文件类型: TXT\n前8000字符预览: ${JSON.stringify(safeText)}`
        sampleCode = sampleAlgorithmCodePdf
      } else {
        throw new Error('不支持的文件类型')
      }
    } catch (readErr: any) {
      aiError.value = `读取文件失败: ${readErr.message || readErr}`
      aiRunning.value = false
      return
    }

    const availableTools = [
      {
        type: 'function',
        function: {
          name: 'read_file_segment',
          description: '读取文件的指定片段内容。对于Excel返回行，对于DOC/DOCX返回段落，对于PDF/TXT返回文本行或字符。',
          parameters: {
            type: 'object',
            properties: {
              start: { type: 'integer', description: '起始索引 (0-based)' },
              count: { type: 'integer', description: '读取数量' }
            },
            required: ['start', 'count']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_file_content',
          description: '搜索文件内容中的关键词，返回第一个匹配项的前后500个字符。',
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: '搜索关键词' }
            },
            required: ['keyword']
          }
        }
      }
    ]

    const executeTool = async (name: string, args: any) => {
      if (name === 'search_file_content') {
        const keyword = String(args.keyword || '').trim()
        if (!keyword) return JSON.stringify({ error: '关键词为空' })
        const ext = (filePath.value || '').toLowerCase()
        try {
          let allText = ''
          if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
            // Excel search is heavy, convert to CSV-like text for simplicity
            const { data: rows } = await readExcelRange(filePath.value, 0, 100000) // Limit for perf
            allText = rows.map(r => r.join(' ')).join('\n')
          } else if (ext.endsWith('.docx')) {
            const { data: paragraphs } = await readDocxRange(filePath.value, 0, 100000)
            allText = paragraphs.join('\n')
          } else if (ext.endsWith('.doc')) {
            let targetPath = filePath.value
            try {
              const { invoke } = await import('@tauri-apps/api/core')
              const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
              if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
                targetPath = out
              }
            } catch { }
            const { data: paragraphs } = targetPath.toLowerCase().endsWith('.docx')
              ? await readDocxRange(targetPath, 0, 100000)
              : await readDocRange(filePath.value, 0, 100000)
            allText = paragraphs.join('\n')
          } else if (ext.endsWith('.pdf')) {
            const b64 = await readFileBase64(filePath.value)
            const bytes = b64ToUint8(b64)
            const task = pdfjsLib.getDocument({ data: bytes })
            const doc = await task.promise
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i)
              const text = await page.getTextContent()
              const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
              if (pageText.trim()) allText += pageText.trim() + '\n'
            }
          } else {
            allText = await readFileText(filePath.value)
          }

          const idx = allText.indexOf(keyword)
          if (idx < 0) return JSON.stringify({ error: '未找到关键词', keyword })

          const start = Math.max(0, idx - 500)
          const end = Math.min(allText.length, idx + keyword.length + 500)
          const context = allText.slice(start, end)
          return JSON.stringify({ keyword, context, found_at: idx, total_length: allText.length })
        } catch (e: any) {
          return JSON.stringify({ error: String(e?.message || e) })
        }
      }
      if (name === 'read_file_segment') {
        const start = Number(args.start) || 0
        const count = Number(args.count) || 20
        const ext = (filePath.value || '').toLowerCase()

        try {
          if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
            const { data: rows, total } = await readExcelRange(filePath.value, start, start + count - 1)
            return JSON.stringify({ data: limitRows(rows), total })
          } else if (ext.endsWith('.docx')) {
            const { data: paragraphs, total } = await readDocxRange(filePath.value, start, start + count - 1)
            return JSON.stringify({ data: limitParagraphs(paragraphs, count, 800), total })
          } else if (ext.endsWith('.doc')) {
            let targetPath = filePath.value
            try {
              const { invoke } = await import('@tauri-apps/api/core')
              const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
              if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
                targetPath = out
              }
            } catch { }
            const { data: paragraphs, total } = targetPath.toLowerCase().endsWith('.docx')
              ? await readDocxRange(targetPath, start, start + count - 1)
              : await readDocRange(filePath.value, start, start + count - 1)
            return JSON.stringify({ data: limitParagraphs(paragraphs, count, 800), total })
          } else if (ext.endsWith('.pdf')) {
            // PDF handling is tricky for random access, we might need to re-read or cache.
            // For simplicity, re-read and slice (inefficient but works)
            const b64 = await readFileBase64(filePath.value)
            const bytes = b64ToUint8(b64)
            const task = pdfjsLib.getDocument({ data: bytes })
            const doc = await task.promise
            let allText = ''
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i)
              const text = await page.getTextContent()
              const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
              if (pageText.trim()) allText += pageText.trim()
            }
            const total = allText.length
            return JSON.stringify({ data: allText.slice(start, start + count), total }) // count as chars
          } else {
            const allText = await readFileText(filePath.value)
            const total = allText.length
            return JSON.stringify({ data: allText.slice(start, start + count), total })
          }
        } catch (e: any) {
          return JSON.stringify({ error: String(e?.message || e) })
        }
      }
      return JSON.stringify({ error: 'Unknown tool' })
    }

    const messages: any[] = [
      {
        role: 'system',
        content: '你是算法生成助手。我将提供文件的预览内容，请你生成一个JavaScript函数 `runAlgorithm(input, libs)`。\n\n要求：\n1. 函数返回一个对象数组，每个对象包含 { Question, Options, QuestionType, Answer }。\n2. 代码必须包含 `function runAlgorithm(input, libs) { ... }`。\n3. 仅输出代码块。\n4. 如果觉得信息不足，可以使用 `read_file_segment` 工具查看更多文件内容。\n\n输入对象 `input` 包含：\n- filePath: string\n- fileText: string (PDF/TXT)\n- paragraphs: string[] (DOC/DOCX)\n- fileBytesBase64: string (Excel)\n\n可用库 `libs` 包含：\n- xlsx: SheetJS库 (Excel用)\n- escapeRegExp: 正则转义函数'
      },
      {
        role: 'user',
        content: `文件预览内容如下：\n${previewMsg}\n\n参考示例代码：\n\`\`\`javascript\n${sampleCode}\n\`\`\`\n\n请生成适配该文件的提取算法（仅输出代码块）。`
      }
    ]

    aiOutput.value = ''
    const maxRequests = 15
    let requestCount = 0

    while (requestCount < maxRequests) {
      // 构建输入和配置
      const input = {
        messages: JSON.parse(JSON.stringify(messages)), // Deep copy to avoid mutation issues
        tools: requestCount > 0 ? availableTools : undefined,
        tool_choice: requestCount > 0 ? 'auto' : undefined
      }

      const config = {
        apiKey: platform.apiKey,
        baseUrl: platform.baseUrl,
        model: selectedTextModel.value
      }

      let fullText = ''
      let toolCalls: any[] = []
      
      try {
        // 获取模型配置代码
        const jsCode = selectedTextModel.value!.jsCode || ''
        let processModelFunc

        // 实例化 processModel
        if (jsCode.trim().startsWith('async function') || jsCode.trim().startsWith('function')) {
          const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
            ${jsCode}
            return processModel;
          `)
          processModelFunc = safeEval(input, config, fetch, aiAbortController.value?.signal)
        } else {
          const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
            return (async function processModel(input, config) {
              ${jsCode}
            });
          `)
          processModelFunc = wrapperFunction(input, config, fetch, aiAbortController.value?.signal)
        }

        // 执行模型
        const generator = await processModelFunc(input, config, aiAbortController.value?.signal)
        requestCount++

        // 处理流式响应
        for await (const chunk of generator) {
          // 累积文本内容
          if (chunk.content) {
            aiOutput.value += chunk.content
            fullText += chunk.content
          }
          
          // 处理工具调用 (兼容 export.js 格式)
          if (chunk.tool_calls) {
            toolCalls = chunk.tool_calls
          }
        }

      } catch (err: any) {
         throw new Error(`模型执行失败: ${err.message}`)
      }

      // Handle Tool Calls
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: fullText || null, tool_calls: toolCalls })
        for (const tc of toolCalls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch { }
          const toolResult = await executeTool(tc.function.name, args)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
        }
        // Continue loop to let AI use the tool result
        continue
      }

      // Handle Code Generation
      const codeBlocks = Array.from(fullText.matchAll(/```(?:javascript|js)?\n([\s\S]*?)```/g))
      let algoCode = ''
      if (codeBlocks.length > 0) {
        const last = codeBlocks[codeBlocks.length - 1]
        algoCode = String(last[1] || '')
      } else {
        const blocks = Array.from(fullText.matchAll(/```\n([\s\S]*?)```/g))
        if (blocks.length > 0) {
          const last = blocks[blocks.length - 1]
          algoCode = String(last[1] || '')
        }
      }

      const assistantForCtx = algoCode ? `\`\`\`javascript\n${truncate(algoCode, 8000)}\n\`\`\`` : truncate(fullText, 8000)
      messages.push({ role: 'assistant', content: assistantForCtx })

      const hasRunAlgo = /function\s+runAlgorithm\s*\(|runAlgorithm\s*=\s*function|runAlgorithm\s*=\s*\(/.test(algoCode)
      if (!hasRunAlgo) {
        // AI output text without code, assuming finished or chatting
        break
      }

      finalAlgoCode.value = algoCode
      // 运行算法并提供前10行数据反馈
      let feedback: any = {}
      try {
        // const { invoke } = await import('@tauri-apps/api/core')
        const fext = (filePath.value || '').toLowerCase()
        if (fext.endsWith('.xlsx') || fext.endsWith('.xls')) {
          const base64: string = await readFileBase64(filePath.value)
          let xlsxLib: any = null
          try { const mod = await import('xlsx'); xlsxLib = mod } catch { }
          if (xlsxLib) {
            const wb = xlsxLib.read(base64, { type: 'base64' })
            const sheetName = wb.SheetNames[0]
            const sheet = wb.Sheets[sheetName]
            const rows: any[] = xlsxLib.utils.sheet_to_json(sheet, { header: 1 })
            const headerRow = Array.isArray(rows[0]) ? rows[0].map((v: any) => String(v ?? '').slice(0, 100)) : []
            const previewRows = limitRows(rows.slice(1, 11), 10, 200)
            const libs = { xlsx: xlsxLib }
            const input = { filePath: filePath.value, fileText: null, fileBytesBase64: base64 }
            let result: any = null
            try {
              const fn = new Function('input', 'libs', `${algoCode}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
              result = await fn(input, libs)
            } catch (e: any) {
              feedback = { error: String(e?.message || e), header: headerRow, rows_preview: previewRows }
            }
            if (result && result.__error) {
              feedback = { error: String(result.__error), header: headerRow, rows_preview: previewRows }
            } else if (Array.isArray(result)) {
              feedback = { status: 'ok', result_count: result.length, sample: pickRandom(result, 50), header: headerRow, rows_preview: previewRows }
            } else {
              feedback = { error: '算法未返回数组', header: headerRow, rows_preview: previewRows }
            }
          } else {
            feedback = { error: 'xlsx库不可用' }
          }
        } else if (fext.endsWith('.pdf')) {
          const b64: string = await readFileBase64(filePath.value)
          const bytes = b64ToUint8(b64)
          const task = pdfjsLib.getDocument({ data: bytes })
          const doc = await task.promise
          let allText = ''
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i)
            const text = await page.getTextContent()
            const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
            if (pageText.trim()) allText += pageText.trim()
          }
          const textPreview = allText.slice(0, 2000)
          const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const libs = { escapeRegExp }
          const input = { filePath: filePath.value, fileText: allText }
          let result: any = null
          try {
            const fn = new Function('input', 'libs', `${algoCode}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
            result = await fn(input, libs)
          } catch (e: any) {
            feedback = { error: String(e?.message || e), text_preview: textPreview }
          }
          if (result && result.__error) {
            feedback = { error: String(result.__error), text_preview: textPreview }
          } else if (Array.isArray(result)) {
            feedback = { status: 'ok', result_count: result.length, sample: pickRandom(result, 50), text_preview: textPreview }
          } else {
            feedback = { error: '算法未返回数组', text_preview: textPreview }
          }
        } else if (fext.endsWith('.txt')) {
          const allText: string = await readFileText(filePath.value)
          const textPreview = allText.slice(0, 2000)
          const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const libs = { escapeRegExp }
          const input = { filePath: filePath.value, fileText: allText }
          let result: any = null
          try {
            const fn = new Function('input', 'libs', `${algoCode}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
            result = await fn(input, libs)
          } catch (e: any) {
            feedback = { error: String(e?.message || e), text_preview: textPreview }
          }
          if (result && result.__error) {
            feedback = { error: String(result.__error), text_preview: textPreview }
          } else if (Array.isArray(result)) {
            feedback = { status: 'ok', result_count: result.length, sample: pickRandom(result, 50), text_preview: textPreview }
          } else {
            feedback = { error: '算法未返回数组', text_preview: textPreview }
          }
        } else if (fext.endsWith('.docx')) {
          const { data: paragraphs } = await readDocxRange(filePath.value, 0, 8000)
          const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const libs = { escapeRegExp }
          const input = { filePath: filePath.value, paragraphs: limitParagraphs(paragraphs, 8000, 800) }
          let result: any = null
          try {
            const fn = new Function('input', 'libs', `${algoCode}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
            result = await fn(input, libs)
          } catch (e: any) {
            feedback = { error: String(e?.message || e), paragraphs_preview: paragraphs.slice(0, 50) }
          }
          if (result && result.__error) {
            feedback = { error: String(result.__error), paragraphs_preview: paragraphs.slice(0, 50) }
          } else if (Array.isArray(result)) {
            feedback = { status: 'ok', result_count: result.length, sample: pickRandom(result, 50), paragraphs_preview: paragraphs.slice(0, 50) }
          } else {
            feedback = { error: '算法未返回数组', paragraphs_preview: paragraphs.slice(0, 50) }
          }
        } else if (fext.endsWith('.doc')) {
          const { data: paragraphs } = await readDocRange(filePath.value, 0, 8000)
          const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const libs = { escapeRegExp }
          const input = { filePath: filePath.value, paragraphs: limitParagraphs(paragraphs, 8000, 800) }
          let result: any = null
          try {
            const fn = new Function('input', 'libs', `${algoCode}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
            result = await fn(input, libs)
          } catch (e: any) {
            feedback = { error: String(e?.message || e), paragraphs_preview: paragraphs.slice(0, 50) }
          }
          if (result && result.__error) {
            feedback = { error: String(result.__error), paragraphs_preview: paragraphs.slice(0, 50) }
          } else if (Array.isArray(result)) {
            feedback = { status: 'ok', result_count: result.length, sample: pickRandom(result, 50), paragraphs_preview: paragraphs.slice(0, 50) }
          } else {
            feedback = { error: '算法未返回数组', paragraphs_preview: paragraphs.slice(0, 50) }
          }
        } else {
          feedback = { error: '暂不支持的文件类型' }
        }
      } catch (e: any) {
        feedback = { error: String(e?.message || e) }
      }
      const prefix = '这是你给出的代码的运行结果'
      let userMsg = ''
      const fext2 = (filePath.value || '').toLowerCase()
      const isDocx = fext2.endsWith('.docx') || fext2.endsWith('.doc')
      const isPdf2 = fext2.endsWith('.pdf')
      const safeSample = Array.isArray(feedback.sample) ? (feedback.sample as any[]).slice(0, 3) : []
      const safeRowsPrev = Array.isArray(feedback.rows_preview) ? limitRows(feedback.rows_preview as any, 10, 120) : []
      const safeHeader = Array.isArray(feedback.header) ? (feedback.header as any[]).map((x: any) => String(x ?? '').slice(0, 60)) : []
      const safeParsPrev = Array.isArray(feedback.paragraphs_preview) ? limitParagraphs(feedback.paragraphs_preview as any, 10, 300) : []
      const safeTextPrev = typeof feedback.text_preview === 'string' ? String(feedback.text_preview).slice(0, 2000) : ''
      if (feedback && typeof feedback === 'object' && feedback.error) {
        userMsg = `${prefix}：\n错误：${String(feedback.error)}\n\n${isDocx ? '该输入来自DOC/DOCX段落提取，不是Excel；因此忽略 libs 和 input.fileBytesBase64。' : ''}${isPdf2 ? '该输入来自PDF字符提取，不是Excel；因此忽略 libs 和 input.fileBytesBase64。' : ''}\n${isPdf2 ? '字符预览：' + JSON.stringify(safeTextPrev) : (isDocx ? '前10段预览：' + JSON.stringify(safeParsPrev) : '表头：' + JSON.stringify(safeHeader) + '\n前10行预览：' + JSON.stringify(safeRowsPrev))}\n\n请仔细分析代码的报错原因，并告诉我修复后的代码（仅输出代码块）。如果需要查看更多文件内容，请使用工具。`
      } else {
        const safeSample50 = Array.isArray(feedback.sample) ? feedback.sample : []
        userMsg = `${prefix}：\n状态：ok\n识别到的题目数量：${String(feedback.result_count ?? '')}\n示例（随机抽取50题）：${JSON.stringify(safeSample50)}\n${isPdf2 ? '字符预览：' + JSON.stringify(safeTextPrev) : (isDocx ? '前10段预览：' + JSON.stringify(safeParsPrev) : '表头：' + JSON.stringify(safeHeader) + '\n前10行预览：' + JSON.stringify(safeRowsPrev))}\n\n格式化后的题目是否已经符合预期了？如果已经符合预期，请告诉我。如果没有，请给我优化后的代码（仅输出代码块）。如果需要查看更多文件内容，请使用工具。`
      }
      messages.push({ role: 'user', content: userMsg })
      // Loop continues via requestCount check
    }
    if (aiOutput.value) {
      try {
        const obj = JSON.parse(aiOutput.value)
        if (Array.isArray(obj.headers)) aiHeaders.value = obj.headers.map((x: any) => String(x))
      } catch { }
    }
  } catch (e: any) {
    aiError.value = String(e?.message || e)
  } finally {
    aiRunning.value = false
    aiAbortController.value = null
  }
}

const stopAIHeaderExtraction = () => {
  try { aiAbortController.value?.abort() } catch { }
  aiRunning.value = false
}

const pickRandom = (arr: any[], count: number) => {
  if (!arr || arr.length <= count) return arr
  const shuffled = [...arr].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, count)
}

const selectAiAlgorithmAndPreview = async () => {
  if (!finalAlgoCode.value) {
    aiError.value = '未获取到算法代码'
    return
  }
  try {
    // const { invoke } = await import('@tauri-apps/api/core')
    const fext = (filePath.value || '').toLowerCase()
    let libs: any = {}
    let input: any = { filePath: filePath.value }
    if (fext.endsWith('.xlsx') || fext.endsWith('.xls')) {
      const base64: string = await readFileBase64(filePath.value)
      let xlsxLib: any = null
      try { const mod = await import('xlsx'); xlsxLib = mod } catch { }
      if (!xlsxLib) {
        aiError.value = 'xlsx库不可用'
        return
      }
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      libs = { xlsx: xlsxLib, escapeRegExp }
      input = { filePath: filePath.value, fileText: null, fileBytesBase64: base64 }
    } else if (fext.endsWith('.txt')) {
      const allText: string = await readFileText(filePath.value)
      input = { filePath: filePath.value, fileText: allText }
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      libs = { escapeRegExp }
    } else if (fext.endsWith('.pdf')) {
      const b64: string = await readFileBase64(filePath.value)
      const bytes = b64ToUint8(b64)
      const task = pdfjsLib.getDocument({ data: bytes })
      const doc = await task.promise
      let allText = ''
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const text = await page.getTextContent()
        const pageText = (text.items || []).map((it: any) => String(it?.str || '')).join(' ')
        if (pageText.trim()) allText += pageText.trim()
      }
      input = { filePath: filePath.value, fileText: allText }
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      libs = { escapeRegExp }
    } else if (fext.endsWith('.docx')) {
      const { data: paragraphs } = await readDocxRange(filePath.value, 0, 1000000)
      input = { filePath: filePath.value, paragraphs }
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      libs = { escapeRegExp }
    } else if (fext.endsWith('.doc')) {
      let targetPath = filePath.value
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const out = await invoke<string>('convert_doc_to_docx', { path: filePath.value })
        if (out && typeof out === 'string' && out.toLowerCase().endsWith('.docx')) {
          targetPath = out
          filePath.value = targetPath
        }
      } catch { }
      if (targetPath.toLowerCase().endsWith('.docx')) {
        const { data: paragraphs } = await readDocxRange(targetPath, 0, 1000000)
        input = { filePath: targetPath, paragraphs }
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        libs = { escapeRegExp }
      } else {
        const { data: paragraphs } = await readDocRange(filePath.value, 0, 1000000)
        input = { filePath: filePath.value, paragraphs }
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        libs = { escapeRegExp }
      }
    }
    let result: any = null
    try {
      const fn = new Function('input', 'libs', `${finalAlgoCode.value}; try { return typeof runAlgorithm==='function' ? runAlgorithm(input, libs) : null } catch (e) { return { __error: String(e && e.message || e) } }`)
      result = await fn(input, libs)
    } catch (e: any) {
      aiError.value = String(e?.message || e)
      return
    }
    if (result && result.__error) {
      aiError.value = String(result.__error)
      return
    }


    if (Array.isArray(result)) {
      const normalized = result.map(normalizeItem).filter(Boolean) as PreviewItem[]
      if (normalized.length) {
        previewItems.value = normalized
        previewError.value = ''
        pageSize.value = 10
        currentPage.value = 1
        activeTab.value = 'bank'
        return
      }
    }
    aiError.value = '算法返回数据无效或为空'
  } catch (e: any) {
    aiError.value = String(e?.message || e)
  }
}

const showSaveModal = ref(false)
const saveAlgoName = ref('')
const saveAlgoType = ref('')

const saveGeneratedAlgorithm = async () => {
  if (!finalAlgoCode.value) {
    aiError.value = '未获取到算法代码'
    return
  }
  const ext = (filePath.value || '').toLowerCase()
  let applicableType = '文件'
  if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) applicableType = 'Excel'
  else if (ext.endsWith('.docx')) applicableType = 'DOCX'
  else if (ext.endsWith('.doc')) applicableType = 'DOC'
  else if (ext.endsWith('.pdf')) applicableType = 'PDF'
  else if (ext.endsWith('.txt')) applicableType = 'TXT'

  saveAlgoType.value = applicableType
  saveAlgoName.value = `AI生成算法(${applicableType})`
  showSaveModal.value = true
}

const confirmSaveAlgorithm = async () => {
  if (!saveAlgoName.value.trim()) {
    return
  }

  const name = saveAlgoName.value.trim()
  const id = `algo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const newAlgo = { id, name, applicableType: saveAlgoType.value, code: finalAlgoCode.value }

  const list = Array.isArray(settings.value.algorithms) ? [...settings.value.algorithms, newAlgo] : [newAlgo]
  setSetting('algorithms', list as any)
  try { await saveSettings() } catch { }

  selectedAlgorithmId.value = id
  aiError.value = ''
  showSaveModal.value = false
}

const cancelSaveAlgorithm = () => {
  showSaveModal.value = false
}

</script>

<style scoped>
.file-info-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-tertiary, #f4f4f4);
  color: var(--text-primary, #2d3748);
}

.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: var(--bg-primary, #f5f5f5);
  user-select: none;
  position: relative;
  z-index: 1000;
  -webkit-app-region: drag;
}

.header-left {
  margin-left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  -webkit-app-region: drag;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  -webkit-app-region: drag;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  padding-right: 0;
  -webkit-app-region: no-drag;
}

.window-control {
  border-radius: 0;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-primary, #333);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
  -webkit-app-region: no-drag;
}

.window-control:hover {
  background-color: var(--btn-primary-hover, rgba(158, 158, 158, 0.1));
}

.window-control.close:hover {
  background-color: var(--danger-color, #e74c3c);
  color: var(--text-white, #fff);
}

.window-control.minimize:hover,
.window-control.maximize:hover {
  background-color: var(--btn-primary-hover, rgba(158, 158, 158, 0.2));
}

.main {
  background-color: var(--bg-primary);
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 4px;
}

.sidebar {

  width: 200px;
  background: var(--bg-primary);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.menu-item {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-primary);
  gap: 8px;
  border: 1px solid transparent;
}

.menu-item:hover {
  background: var(--bg-tertiary, #e9e9e9);
}

.menu-item.active {
  border: 1px solid var(--nav-item-border-active);
  background: var(--nav-item-bg-active);
  color: var(--color-accent, #fff);
}

.menu-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  color: currentColor;
}

.content {
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--fileinfo-content-bg, var(--bg-primary, #fff));
}

.box {
  font-size: 14px;
  color: var(--text-primary, #333);
  background: var(--bg-primary, #fff);
  padding: 16px 20px;
  width: calc(100% - 40px);
}

.label {
  color: var(--text-secondary, #4a5568);
  margin-bottom: 8px;
}

.name {
  font-weight: 600;
  color: var(--text-accent, #007acc);
  word-break: break-all;
}

.placeholder {
  border-radius: 6px;
  margin-right: 4px;
  background-color: var(--bg-secondary);
  margin-top: 4px;
  font-size: 14px;
  color: var(--text-secondary, #4a5568);
  flex: 1;
  display: flex;
  align-items: center;
  padding: 12px;
}

.algo-container {
  background-color: var(--bg-primary);
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  gap: 4px;
}

.algo-list {
  margin-top: 4px;
  margin-bottom: 4px;
  border-radius: 4px;
  background-color: var(--bg-secondary);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.algo-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--platform-item-border);
  background: var(--model-item-bg);
}

.algo-item:hover {
  background-color: var(--model-item-hover-bg);
}

.algo-item.active {
  background-color: var(--platform-item-active-bg);
  /* border-color: var(--platform-item-active-border); */
  color: var(--platform-item-active-text);
}

.algo-title {
  font-weight: 500;
  color: var(--text-primary, #333);
}

.algo-meta {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.algo-detail {
  margin-top: 4px;
  margin-bottom: 4px;
  margin-right: 4px;
  padding: 16px;
  flex: 1;
  border-radius: 4px;
  background: var(--bg-secondary);
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.algo-detail {
  min-width: 0;
}

.detail-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin-bottom: 8px;
}

.detail-type {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.detail-code {
  flex: 0 0 auto;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  padding: 10px;
  color: var(--text-primary, #333);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}

.detail-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.btn {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ddd);
  cursor: pointer;
}

.btn-primary {
  background: var(--color-primary, #007acc);
  color: var(--text-white, #fff);
  border-color: var(--color-primary, #007acc);
}

.preview-container {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.preview-list {
  background-color: var(--bg-secondary);
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 12px;
  padding-top: 0px;
  box-sizing: border-box;
  border-radius: 4px;
}

.code-editor {
  position: relative;
  min-height: 0;
  height: 100%;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, #fff);
}

.cm-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.ai-code {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ai-code .code-editor {
  height: 100%;
  max-height: none;
}

.algo-detail .code-editor {
  flex: 1;
  min-height: 0;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
  width: 100%;
  max-width: 100%;
  background: transparent;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
  overflow-x: auto;
}

.code-editor :deep(.cm-content) {
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 20px;
  min-width: max-content;
}

.ai-actions {
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 8px;
}

.ai-status {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.ai-result {
  margin-top: 8px;
}

.result-title {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin-bottom: 6px;
}

.headers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.header {
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-primary, #333);
}

.ai-output {
  margin-top: 8px;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  padding: 8px;
  max-height: 260px;
  overflow: auto;
}

.preview-item {
  margin-top: 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 3px;
  padding: 12px;
}

.preview-question {
  font-weight: 600;
  color: var(--text-primary, #333);
  margin-bottom: 6px;
}

.preview-type {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.preview-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}

.option {
  font-size: 14px;
  color: var(--text-primary, #333);
}

.preview-answer {
  font-size: 14px;
  color: var(--color-primary, #007acc);
  font-weight: 600;
}

.pagination {
  flex-shrink: 0;
  background: var(--bg-primary, #fff);
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin-top: auto;
}

.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.page-size {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
}

.file-preview-box {
  border-radius: 6px;
  margin-top: 6px;
  margin-bottom: 6px;
  background-color: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(100vh - 50px);
  width: 100%;
  overflow: hidden;
}

.file-path-section {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-path-section .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.file-content-preview {
  flex: 1;
  min-height: 0;
  background: var(--platform-detail-form-input-bg);
  border-radius: 6px;
  padding: 12px;
  overflow: auto;
  scrollbar-color: var(--bg-tertiary) transparent;
}

.content-text {
  margin: 0;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary, #333);
  font-size: 13px;
  line-height: 1.5;
}

.loading {
  color: var(--text-secondary, #666);
  font-style: italic;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-overlay, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-content {
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.3));
  width: 400px;
  max-width: 90vw;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
}

.form-input:focus {
  border-color: var(--color-primary, #007acc);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Transition styles */
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
  transition: transform 0.2s ease;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95);
}
</style>
