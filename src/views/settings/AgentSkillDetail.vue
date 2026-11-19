<template>
  <div class="skill-detail-page">
    <div class="skill-detail-header">
      <button type="button" class="back-btn" title="返回网站列表" :disabled="saving" @click="requestBack">
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="12" height="12">
          <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
        </svg>
        <span>返回</span>
      </button>
      <div v-if="skillDoc" class="skill-detail-title">
        <span class="skill-path">{{ editingSupplement ? '本地经验 · ' : '' }}{{ siteHost || skillDoc.name }}</span>
      </div>
      <div class="header-actions">
        <button
          v-if="!readingRepositoryMarkdown && !editingSupplement && !readingCustomFile"
          type="button"
          class="action-btn primary"
          :disabled="!dirty || !canSave || saving"
          :title="dirty ? '保存 (Ctrl+S)' : '没有需要保存的修改'"
          @click="submitSave()"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <div
          v-if="canPreview && !readingRepositoryMarkdown"
          class="radio-inputs edit-layout-toggle"
          :class="{ 'local-mode-switch': editingSupplement }"
          :data-selected-index="panelMode === 'preview' ? 0 : 1"
          role="radiogroup"
          aria-label="显示模式"
        >
          <div class="slider" aria-hidden="true"></div>
          <label class="radio" title="预览">
            <input v-model="panelMode" type="radio" name="skill-view-mode" value="preview" :disabled="saving">
            <span class="name">预览</span>
          </label>
          <label class="radio" :title="editingSupplement ? '编辑' : '源码'">
            <input v-model="panelMode" type="radio" name="skill-view-mode" value="source" :disabled="saving">
            <span class="name">{{ editingSupplement ? '编辑' : '源码' }}</span>
          </label>
        </div>
        <button
          v-if="canReset"
          type="button"
          class="action-btn danger"
          :disabled="saving"
          @click="resetSkill"
        >
          {{ isRepositorySkill ? '清除图谱的本地补充' : '恢复默认' }}
        </button>
        <span v-if="websiteRepositoryState" class="skill-badge repository-status" role="status" :title="websiteRepositoryState.error || '打开详情时自动检查网站经验'">
          {{ repositoryStatusLabel }}
        </span>
      </div>
    </div>

    <div v-if="loadError" class="skill-detail-error">{{ loadError }}</div>

    <div v-else class="skill-detail-layout">
      <aside class="skill-file-sidebar">
        <div class="sidebar-label">目录</div>
        <SkillFileTree
          :files="directoryFiles"
          :root-path="isRepositorySkill && siteHost ? `sites/${siteHost}` : undefined"
          :selected="currentPath"
          @select="selectFile"
        />
      </aside>

      <main class="skill-file-panel">
        <div
          v-if="panelMode === 'preview' && isSiteGraphFile"
          class="skill-file-body skill-graph-body"
        >
          <div v-if="!siteGraphPreview.ok" class="skill-preview-empty">{{ siteGraphPreview.error }}</div>
          <BrowserSiteGraphPanel v-else preview :data="siteGraphPreview.data" />
        </div>

        <div
          v-else-if="isMarkdownFile && (panelMode === 'preview' || readingRepositoryMarkdown)"
          class="skill-file-body skill-markdown-body"
          :class="{ 'local-experience local-note-preview': editingSupplement }"
        >
          <dl v-if="!editingSupplement && previewMetaRows.length" class="skill-frontmatter" aria-label="经验信息">
            <div
              v-for="row in previewMetaRows"
              :key="row.key"
              class="skill-frontmatter-row"
            >
              <dt class="skill-frontmatter-key">{{ row.label }}</dt>
              <dd class="skill-frontmatter-val">{{ row.value }}</dd>
            </div>
          </dl>
          <MarkdownRender
            v-if="previewBody"
            :key="previewRenderKey"
            custom-id="agent-skill-preview"
            :content="previewBody"
            :final="true"
            :batch-rendering="false"
            :max-live-nodes="480"
          />
          <div v-else-if="editingSupplement" class="local-note-empty">
            <strong>还没有本地经验</strong>
            <p>可以补充当前经验里缺少的步骤，供 Agent 下次参考。</p>
          </div>
          <div v-else class="skill-preview-empty">没有正文内容</div>
        </div>

        <div
          v-else-if="panelMode === 'source' || !canPreview"
          class="skill-file-body skill-edit-body"
        >
          <p v-if="readingCustomFile" class="panel-hint">此文件由自定义 HTTP 接口提供。</p>
          <p v-else-if="isRepositorySkill && isSiteGraphFile" class="panel-hint">图谱保存本地新增的节点、连接和字段改动。删除云端内容的操作不会保存。</p>
          <SkillMarkdownEditor
            :key="`${currentPath}-source-${editorKey}`"
            ref="editorRef"
            v-model="markdown"
            :language="editingSupplement ? 'plain' : editorLanguage"
            :readonly="readingCustomFile || (editingSupplement && saving)"
            :autofocus="panelMode === 'source'"
            :placeholder="editingSupplement ? '在此补充已验证的步骤或例外…' : isMarkdownFile ? '在此编辑 Markdown…' : '在此编辑文件…'"
          />
        </div>

        <p v-if="saveError" class="panel-error">{{ saveError }}</p>
        <p v-else-if="saveHint" class="panel-hint">{{ saveHint }}</p>
      </main>
    </div>

    <SkillUnsavedDialog
      :visible="Boolean(pendingLeave)"
      :title="leaveCopy.title"
      :message="leaveCopy.message"
      :detail="leaveCopy.detail"
      :save-label="leaveCopy.saveLabel"
      :discard-label="leaveCopy.discardLabel"
      :saving="saving"
      :error="saveError"
      @cancel="pendingLeave = null"
      @save="confirmLeaveSave"
      @discard="confirmLeaveDiscard"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import MarkdownRender, { setCustomComponents } from 'markstream-vue'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'
import '../../services/model/markstream'
import SkillMarkdownEditor from '../../components/settings/SkillMarkdownEditor.vue'
import SkillUnsavedDialog from '../../components/settings/SkillUnsavedDialog.vue'
import SkillFileTree from '../../components/settings/SkillFileTree.vue'
import BrowserSiteGraphPanel from '../../components/browser/BrowserSiteGraphPanel.vue'
import { SITE_GRAPH_PATH } from '../../services/agent/skillRuntime'
import { ensureWebsiteRepository, refreshWebsiteRepository, repositoryForHost, readWebsiteRepositoryFile, websiteRepositoryStates, writeWebsiteRepositorySupplement } from '../../services/agent/websiteRepository'
import { websiteRepositoryTarget } from '../../services/agent/websiteRepositoryTarget'
import type { SiteGraphData } from '../../services/browser/siteGraph'
import {
  agentSkillsState,
  getSkillDocument,
  getSkillFileContent,
  parseSkillFrontmatter,
  resetSkillDocument,
  resetSkillFileContent,
  saveSkillFileContent,
  type SkillDocument,
} from '../../services/agent/agentSkills'

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim()
    if (message) return message
  }
  return fallback
}

const isMarkdownPath = (path: string) => /\.md(?:own)?$/i.test(path)
const LOCAL_EXPERIENCE_PATH = '本地经验.md'
const isSiteGraphPath = (path: string) => path === SITE_GRAPH_PATH || /(^|\/)site-graph\.json$/i.test(path)
const editorLanguageOf = (path: string): 'markdown' | 'javascript' | 'json' | 'plain' => {
  if (isMarkdownPath(path)) return 'markdown'
  if (/\.(?:js|mjs|cjs|ts)$/i.test(path)) return 'javascript'
  if (/\.json$/i.test(path)) return 'json'
  return 'plain'
}

/** 预览专用：吞掉 thematic break，避免残留 --- 被画成奇怪分割线 */
const SKILL_PREVIEW_CUSTOM_ID = 'agent-skill-preview'
const EmptyNode = { name: 'SkillPreviewEmptyNode', render: () => null }
setCustomComponents(SKILL_PREVIEW_CUSTOM_ID, {
  thematic_break: EmptyNode,
  hr: EmptyNode,
})

const props = defineProps<{
  skillId: string
  initialMode?: 'view' | 'edit' | 'local'
  siteHost?: string
  initialPath?: string
}>()

const emit = defineEmits<{
  back: []
  saved: []
}>()

const skillDoc = ref<SkillDocument | null>(null)
const repository = computed(() => websiteRepositoryTarget(props.skillId, props.siteHost ? `sites/${props.siteHost}/SKILL.md` : 'SKILL.md'))
const isRepositorySkill = computed(() => Boolean(repository.value))
const websiteRepositoryState = computed(() => repository.value ? websiteRepositoryStates[repository.value.host] : undefined)
const repositoryStatusLabel = computed(() => {
  const state = websiteRepositoryState.value
  if (state?.customUrl) return state.error ? 'HTTP 接口不可用 · 使用缓存' : '自定义 HTTP'
  if (state?.refreshing) return '正在同步…'
  if (state?.source === 'repository') return state.error ? '同步失败 · 使用缓存' : '云端经验 · 已同步'
  return state?.error ? '同步失败 · 尚无缓存' : '尚未同步'
})
const repositoryPath = computed(() => websiteRepositoryTarget(props.skillId, currentPath.value)?.path || '')
const loadedRepositoryVersion = ref<string | undefined>()
const files = ref<string[]>(['SKILL.md'])
const directoryFiles = computed(() => isRepositorySkill.value ? [...files.value, LOCAL_EXPERIENCE_PATH] : files.value)
const currentPath = ref('SKILL.md')
const markdown = ref('')
const loadedMarkdown = ref('')
const loadError = ref('')
const saveError = ref('')
const saveHint = ref('')
const saving = ref(false)
const editorRef = ref<{ focus: () => void; getValue: () => string } | null>(null)
const editorKey = ref(0)
const initialPanelMode = () => props.initialMode === 'edit' || props.initialMode === 'local' ? 'source' : 'preview'
const panelMode = ref<'preview' | 'source'>(initialPanelMode())
let hintTimer: ReturnType<typeof setTimeout> | null = null
let unmounting = false
let discardOnExit = false

const isMarkdownFile = computed(() => isMarkdownPath(currentPath.value))
const isSiteGraphFile = computed(() => isSiteGraphPath(currentPath.value))
const canPreview = computed(() => isMarkdownFile.value || isSiteGraphFile.value)
const editorLanguage = computed(() => editorLanguageOf(currentPath.value))
const siteGraphPreview = computed(() => {
  const raw = String(markdown.value || '').trim()
  if (!raw) return { ok: false as const, error: '文件是空的', data: null }
  try {
    const data = JSON.parse(raw) as SiteGraphData
    if (!data?.id || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return { ok: false as const, error: '需要包含 id、nodes、edges', data: null }
    }
    return { ok: true as const, error: '', data }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'JSON 无法解析'
    return { ok: false as const, error: detail, data: null }
  }
})
const dirty = computed(() => markdown.value !== loadedMarkdown.value)
const editingSupplement = computed(() => isRepositorySkill.value && currentPath.value === LOCAL_EXPERIENCE_PATH)
const readingCustomFile = computed(() => Boolean(websiteRepositoryState.value?.customUrl) && !editingSupplement.value)
const readingRepositoryMarkdown = computed(() => isRepositorySkill.value && !readingCustomFile.value && isMarkdownFile.value && !editingSupplement.value)
const canSave = computed(() => !readingCustomFile.value && !readingRepositoryMarkdown.value
  && (editingSupplement.value || currentPath.value !== 'SKILL.md' || Boolean(markdown.value.trim())))
const canReset = computed(() => isRepositorySkill.value
  ? !readingCustomFile.value && isSiteGraphFile.value && Boolean(websiteRepositoryState.value?.changedPaths.includes('site-graph.json'))
  : Boolean(skillDoc.value?.customized && skillDoc.value.builtin))

const previewParts = computed(() => parseSkillFrontmatter(markdown.value))
/** 预览绝不把 YAML frontmatter 丢给 markstream（`---` 会被渲染成奇怪的水平线）。 */
const previewBody = computed(() => {
  if (editingSupplement.value) return markdown.value.trimEnd()
  const parts = previewParts.value
  if (parts.hasFrontmatter) return parts.body
  // 兜底：只要开头像 frontmatter，就硬剥掉，避免解析失败时整段进 markstream
  const text = String(markdown.value || '').replace(/^\uFEFF/, '')
  const fallback = text.match(/^[\s\uFEFF]*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (fallback) return fallback[1].trim()
  return text.trim()
})
const previewMetaRows = computed(() => {
  const parts = previewParts.value
  const rows = [
    { key: 'name', label: '标识', value: parts.name },
    { key: 'description', label: '用途', value: parts.description },
    { key: 'compatibility', label: '使用条件', value: parts.compatibility === 'Requires ZError browser tools and a signed-in Chaoxing browser session.'
      ? '需要 ZError 浏览器工具，并已在浏览器中登录学习通。' : parts.compatibility },
    { key: 'license', label: '许可证', value: parts.license },
    { key: 'allowed-tools', label: '允许的工具', value: parts.allowedTools },
  ].filter(row => row.value)
  for (const [key, value] of Object.entries(parts.metadata)) {
    const label = key === 'display-name' ? '显示名称' : key === 'requires' ? '所需能力' : `扩展字段 · ${key}`
    const text = key === 'requires' && value === 'ZError browser, credential and video-wait tools'
      ? 'ZError 浏览器、凭据及视频播放等待工具' : String(value)
    rows.push({ key: `metadata.${key}`, label, value: text })
  }
  if (parts.errors.length) rows.push({ key: 'errors', label: '格式错误', value: parts.errors.join('；') })
  return rows
})
const previewRenderKey = computed(() => (
  `${currentPath.value}::${previewBody.value.slice(0, 48)}::${previewBody.value.length}`
))

const flushEditor = () => {
  const latest = editorRef.value?.getValue?.()
  if (typeof latest === 'string') markdown.value = latest
}

const showHint = (text: string) => {
  saveHint.value = text
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    saveHint.value = ''
    hintTimer = null
  }, 2200)
}

const loadFile = async (path: string) => {
  if (!directoryFiles.value.includes(path)) throw new Error('不能读取其他网站的文件')
  const file = path === LOCAL_EXPERIENCE_PATH && repository.value
    ? await readWebsiteRepositoryFile(repository.value.host, 'SKILL.md')
      .then(note => ({ path, content: note.supplement, repositoryVersion: note.version }))
    : await getSkillFileContent(props.skillId, path)
  if (!file) throw new Error(`无法读取 ${path}`)
  currentPath.value = file.path
  markdown.value = file.content
  loadedMarkdown.value = markdown.value
  loadedRepositoryVersion.value = file.repositoryVersion
  editorKey.value += 1
  if (isSiteGraphPath(file.path)) panelMode.value = 'preview'
  else if (!isMarkdownPath(file.path)) panelMode.value = 'source'
}

const loadSkill = async (useInitialPath = false) => {
  loadError.value = ''
  saveError.value = ''
  const hadDocument = Boolean(skillDoc.value)
  if (useInitialPath && repository.value) await ensureWebsiteRepository(repository.value.host, true)
  const doc = await getSkillDocument(props.skillId, props.siteHost)
  if (!doc) {
    loadError.value = '无法读取 Skill'
    return
  }
  skillDoc.value = doc
  files.value = doc.files?.length ? doc.files : ['SKILL.md']
  const initialPath = props.initialMode === 'local' && isRepositorySkill.value
    ? LOCAL_EXPERIENCE_PATH
    : props.initialPath || (props.siteHost ? `sites/${props.siteHost}/SKILL.md` : 'SKILL.md')
  const preferred = hadDocument && !useInitialPath ? currentPath.value : initialPath
  await loadFile(directoryFiles.value.includes(preferred) ? preferred : files.value[0])
}

watch(() => websiteRepositoryState.value?.version, async () => {
  if (!isRepositorySkill.value || !skillDoc.value || dirty.value || saving.value) return
  try { await loadSkill() } catch (error) { loadError.value = errorMessage(error, '读取网站仓库失败') }
})
watch(() => websiteRepositoryState.value?.customUrl, (customUrl, _, onCleanup) => {
  if (!customUrl || !repository.value) return
  const { host } = repository.value
  const timer = setInterval(() => { if (!document.hidden) void refreshWebsiteRepository(host).catch(() => undefined) }, 3000)
  onCleanup(() => clearInterval(timer))
}, { immediate: true })

type LeaveIntent = { kind: 'back' } | { kind: 'file'; path: string }

const pendingLeave = ref<LeaveIntent | null>(null)
const leaveCopy = computed(() => {
  if (pendingLeave.value?.kind === 'file') {
    return {
      title: '未保存的修改',
      message: `「${currentPath.value}」有未保存修改。`,
      detail: '不保存就切换的话，这些改动会丢掉。',
      saveLabel: '保存',
      discardLabel: '不保存',
    }
  }
  return {
    title: '未保存的修改',
    message: '离开后当前修改会丢失。',
    detail: currentPath.value ? `当前文件：${currentPath.value}` : '',
    saveLabel: '保存',
    discardLabel: '不保存',
  }
})

const openNextFile = async (path: string) => {
  saveError.value = ''
  try {
    await loadFile(path)
    if (path === LOCAL_EXPERIENCE_PATH) panelMode.value = 'preview'
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '读取失败'
  }
}

const confirmLeaveSave = async () => {
  const pending = pendingLeave.value
  if (!pending) return
  const ok = await submitSave({ quiet: true })
  if (!ok) return
  pendingLeave.value = null
  if (pending.kind === 'back') emit('back')
  else await openNextFile(pending.path)
}

const confirmLeaveDiscard = async () => {
  const pending = pendingLeave.value
  if (!pending) return
  pendingLeave.value = null
  if (pending.kind === 'back') {
    discardOnExit = true
    emit('back')
    return
  }
  markdown.value = loadedMarkdown.value
  await openNextFile(pending.path)
}

const requestBack = async () => {
  if (saving.value) return
  flushEditor()
  if (!dirty.value || (editingSupplement.value && await submitSave({ quiet: true }))) {
    emit('back')
    return
  }
  pendingLeave.value = { kind: 'back' }
}

const selectFile = async (path: string) => {
  if (path === currentPath.value || saving.value) return
  flushEditor()
  if (dirty.value && (!editingSupplement.value || !await submitSave({ quiet: true }))) {
    pendingLeave.value = { kind: 'file', path }
    return
  }
  await openNextFile(path)
}

const submitSave = async (options?: { quiet?: boolean }) => {
  flushEditor()
  if (!skillDoc.value || saving.value) return false
  if (!dirty.value) {
    if (!options?.quiet) showHint('没有需要保存的修改')
    return true
  }
  if (!canSave.value) {
    saveError.value = 'Skill 内容不能为空'
    return false
  }
  saving.value = true
  saveError.value = ''
  try {
    if (editingSupplement.value && repository.value) {
      await writeWebsiteRepositorySupplement(repository.value.host, markdown.value, loadedMarkdown.value)
    } else {
      await saveSkillFileContent(skillDoc.value.id, currentPath.value, markdown.value, { repositoryVersion: loadedRepositoryVersion.value })
    }
    if (unmounting) return true
    const doc = await getSkillDocument(skillDoc.value.id, props.siteHost)
    if (doc) {
      skillDoc.value = doc
      files.value = doc.files?.length ? doc.files : ['SKILL.md']
    }
    const mode = panelMode.value
    await loadFile(directoryFiles.value.includes(currentPath.value) ? currentPath.value : files.value[0])
    panelMode.value = editingSupplement.value ? 'preview' : mode
    emit('saved')
    if (!options?.quiet) showHint(isRepositorySkill.value ? '已保存本地补充' : '已保存')
    return true
  } catch (error) {
    saveError.value = errorMessage(error, '保存失败')
    if (unmounting) console.warn('[本地经验] 离开时保存失败', saveError.value)
    return false
  } finally {
    saving.value = false
  }
}

const resetSkill = async () => {
  if (!skillDoc.value || !canReset.value || saving.value) return
  flushEditor()
  const prompt = isRepositorySkill.value
    ? '清除图谱的本地补充？未保存的修改也会丢弃。'
    : '恢复默认内容？当前修改将被丢弃。'
  if (!window.confirm(prompt)) return
  saving.value = true
  saveError.value = ''
  try {
    if (repository.value && repositoryPath.value) await repositoryForHost(repository.value.host).reset(repositoryPath.value)
    else if (currentPath.value === 'SKILL.md') await resetSkillDocument(skillDoc.value.id)
    else await resetSkillFileContent(skillDoc.value.id, currentPath.value)
    const doc = await getSkillDocument(skillDoc.value.id, props.siteHost)
    if (doc) {
      skillDoc.value = doc
      files.value = doc.files?.length ? doc.files : ['SKILL.md']
    }
    await loadFile(directoryFiles.value.includes(currentPath.value) ? currentPath.value : files.value[0])
    if (isMarkdownPath(currentPath.value) || isSiteGraphPath(currentPath.value)) {
      panelMode.value = 'preview'
    }
    emit('saved')
    showHint(isRepositorySkill.value ? '已清除本地补充' : '已恢复默认')
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '恢复失败'
  } finally {
    saving.value = false
  }
}

const onPageKeydown = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault()
    void submitSave()
  }
}

watch(() => [props.skillId, props.siteHost, props.initialPath, props.initialMode], () => {
  panelMode.value = initialPanelMode()
  void loadSkill(true).catch(error => { loadError.value = errorMessage(error, '读取失败') })
})

watch(panelMode, async (next) => {
  if (next === 'source') {
    await nextTick()
    editorRef.value?.focus()
  } else {
    flushEditor()
    if (editingSupplement.value && dirty.value && !saving.value && !await submitSave()) {
      panelMode.value = 'source'
    }
  }
})

onMounted(async () => {
  window.addEventListener('keydown', onPageKeydown, true)
  const exists = agentSkillsState.items.some((item) => item.id === props.skillId)
  if (!exists) {
    loadError.value = 'Skill 不存在'
    return
  }
  try {
    await loadSkill(true)
    if (panelMode.value === 'source') {
      await nextTick()
      editorRef.value?.focus()
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '读取失败'
  }
})

onBeforeUnmount(() => {
  unmounting = true
  if (editingSupplement.value && dirty.value && !discardOnExit && !saving.value) void submitSave({ quiet: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onPageKeydown, true)
  if (hintTimer) clearTimeout(hintTimer)
})
</script>

<style scoped>
.skill-detail-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.skill-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: 6px;
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary);
  font-size: 13px;
  padding: 4px 6px;
  cursor: pointer !important;
  flex-shrink: 0;
}

.back-btn:hover {
  color: var(--text-primary);
  background: transparent;
}

.skill-detail-title {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.skill-path {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary, #64748b);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.title-id {
  font-size: 12px;
  font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui, -apple-system, sans-serif;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--text-tertiary, #94a3b8);
  white-space: nowrap;
  flex-shrink: 0;
}

.skill-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-primary, #334155) 6%, transparent);
  flex-shrink: 0;
  white-space: nowrap;
}

.skill-badge.builtin,
.skill-badge.installed {
  color: var(--text-secondary, #64748b);
  background: color-mix(in srgb, var(--text-primary, #334155) 6%, transparent);
}

.skill-badge.customized {
  color: #a16207;
  background: color-mix(in srgb, #ca8a04 12%, transparent);
}

.skill-badge.dirty {
  color: #c2410c;
  background: color-mix(in srgb, #ea580c 12%, transparent);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-inline-start: auto;
}

.action-btn {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
}

.action-btn:hover:not(:disabled) {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.action-btn.primary {
  background: var(--color-accent, #667eea);
  border-color: var(--color-accent, #667eea);
  color: #fff;
  padding: 4px 10px;
  font-size: 11px;
}

.action-btn.primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.action-btn.danger {
  color: #c2410c;
  border-color: color-mix(in srgb, #c2410c 35%, var(--border-color));
}

.action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.skill-detail-error {
  margin-top: 16px;
  color: #c2410c;
  font-size: 13px;
}

.skill-detail-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  margin-top: 0;
  overflow: hidden;
  background: transparent;
}

.skill-file-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.sidebar-label {
  height: 36px;
  min-height: 36px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  box-sizing: border-box;
}

.skill-file-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.edit-layout-toggle {
  --n: 2;
  --pad: 3px;
  position: relative;
  order: -1;
  display: inline-flex;
  padding: var(--pad);
  border: none;
  border-radius: 0.5rem;
  background: var(--platform-toggle-bg, var(--hover-bg, rgba(0, 0, 0, 0.04)));
  font-size: 11px;
}

.edit-layout-toggle .radio {
  flex: 1 1 0;
  min-width: 46px;
  text-align: center;
  position: relative;
  z-index: 2;
}

.edit-layout-toggle .radio input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.edit-layout-toggle .radio .name {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.55rem;
  border-radius: 0.4rem;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1.2;
  white-space: nowrap;
  user-select: none;
  transition: color 0.15s ease;
}

.edit-layout-toggle .radio .name:hover {
  color: var(--text-primary);
}

.edit-layout-toggle .radio input:checked + .name {
  font-weight: 600;
  color: var(--text-primary);
}

.edit-layout-toggle .radio input:focus-visible + .name {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.edit-layout-toggle .radio input:disabled + .name {
  cursor: default;
}

.edit-layout-toggle .slider {
  position: absolute;
  top: var(--pad);
  left: var(--pad);
  width: calc((100% - var(--pad) * 2) / var(--n));
  height: calc(100% - var(--pad) * 2);
  border-radius: 0.4rem;
  background: var(--platform-toggle-slider, var(--bg-secondary, #fff));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  pointer-events: none;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
}

[data-theme="dark"] .edit-layout-toggle .slider {
  background: #383838;
}

.edit-layout-toggle[data-selected-index="0"] .slider {
  transform: translateX(0);
}

.edit-layout-toggle[data-selected-index="1"] .slider {
  transform: translateX(100%);
}

.local-mode-switch {
  --pad: 2px;
  font-size: 12px;
}

.local-mode-switch .radio {
  min-width: 34px;
}

.local-mode-switch .radio .name {
  padding: 2px 6px;
}

.local-mode-switch .slider {
  box-shadow: none;
}

.skill-file-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.skill-edit-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.local-experience {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(100%, 720px);
  margin-inline: auto;
  padding: 24px clamp(16px, 4vw, 36px);
  box-sizing: border-box;
  font-size: 13px;
  color: var(--text-secondary);
}

.skill-graph-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.skill-graph-body :deep(.graph-panel) {
  flex: 1;
  min-height: 0;
}

.skill-graph-body .skill-preview-empty {
  padding: 24px 16px;
}

.skill-markdown-body {
  color: var(--text-primary);
}

.skill-markdown-body:not(.local-experience) {
  padding: 8px 12px 0;
}

.local-note-empty {
  margin-top: 12px;
  padding: 24px 16px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  text-align: center;
  color: var(--text-secondary);
}

.local-note-empty strong {
  color: var(--text-primary);
  font-weight: 600;
}

.local-note-empty p {
  margin: 6px 0 0;
  line-height: 1.6;
}

.skill-frontmatter {
  margin: 0 0 12px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border-color);
}

.skill-frontmatter-row {
  display: grid;
  grid-template-columns: minmax(0, min(32%, 124px)) minmax(0, 1fr);
  gap: 12px;
  padding: 3px 0;
  align-items: baseline;
}

.skill-frontmatter-key,
.skill-frontmatter-val {
  min-width: 0;
  margin: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.skill-frontmatter-key {
  font-size: 12px;
  color: var(--text-secondary);
}

.skill-frontmatter-val {
  font-size: 13px;
  color: var(--text-primary);
}

.skill-preview-empty {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 8px 0;
}

/* 万一仍有残留 thematic break，别顶着正文吓人 */
.skill-markdown-body :deep(.markstream-vue > .horizontal-rule-node:first-child),
.skill-markdown-body :deep(.markstream-vue > hr:first-child),
.skill-markdown-body :deep(.markstream-vue > .hr:first-child) {
  display: none;
}

.skill-markdown-body :deep(.markstream-vue) {
  --fade-duration: 0.24s;
  --ms-text-body: 13px;
  --ms-text-h1: 20px;
  --ms-text-h2: 17px;
  --ms-text-h3: 15px;
  --ms-text-h4: 14px;
  --ms-text-h5: 13px;
  --ms-text-h6: 13px;
  --ms-text-label: 11px;
  --ms-leading-body: 1.65;
  --ms-flow-paragraph-y: 0.55em;
  --ms-flow-list-y: 0.45em;
  --ms-flow-heading-1-mt: 0.75em;
  --ms-flow-heading-1-mb: 0.45em;
  --ms-flow-heading-2-mt: 0.7em;
  --ms-flow-heading-2-mb: 0.35em;
  --ms-flow-heading-3-mt: 0.6em;
  --ms-flow-heading-3-mb: 0.3em;
  --ms-flow-codeblock-y: 0.55em;
  --ms-flow-hr-y: 0.7em;
  --hr-border: color-mix(in srgb, var(--border-primary, #e2e8f0) 88%, transparent);
  --code-bg: color-mix(in srgb, var(--text-primary, #2d3748) 5.5%, var(--bg-secondary, #fff));
  --code-fg: var(--text-primary, #2d3748);
  --code-border: transparent;
  --diagram-bg: var(--code-bg);
  --diagram-header-bg: var(--code-bg);
  --ms-shadow-subtle: none;
  --vscode-editor-font-size: 12px;
  font-size: 13px;
  line-height: 1.65;
}

.skill-markdown-body :deep(.table-node__loading) {
  display: none;
}

.local-note-preview :deep(.markstream-vue) {
  --ms-text-body: 14px;
  --ms-leading-body: 1.75;
  font-size: 14px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.skill-markdown-body :deep(.mermaid-block-container),
.skill-markdown-body :deep(.infographic-block-container) {
  max-width: 100%;
  overflow: auto;
}

.panel-error {
  margin: 0;
  padding: 8px 14px 12px;
  font-size: 12px;
  color: #c2410c;
  flex-shrink: 0;
}

.panel-hint {
  margin: 0;
  padding: 8px 14px 12px;
  font-size: 12px;
  color: #059669;
  flex-shrink: 0;
}
</style>
