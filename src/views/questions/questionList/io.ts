/** 导入 / 导出。识别导入走 Agent，解析走 utils/question。 */
import { computed } from 'vue'
import { emit as tauriEmit } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { startFileImportChat } from '../../../services/agent/chat'
import { isTauriEnvironment } from '../../../services/app/environmentDetector'
import { settingsManager } from '../../../services/app/settings'
import { databaseService } from '../../../services/app/database'
import { modelConfigManager } from '../../../services/model/config'
import { generateExportData, type ExportFormat } from '../../../utils/question/exporter'
import { parseSoftwareExportedFile } from '../../../utils/question/importer'
import type { MenuItem } from '../../../components/ui/UnifiedContextMenu.vue'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'
import { hasSelectedFolder, parseFolderId, sortQuestionListByCreateTime } from './format'

export const bindQuestionListIo = (ctx: QuestionListCtx) => {
  const importMenuItems: MenuItem[] = [
    { id: 'import-zerror', label: '导入ZError导出的文件', action: 'import-zerror' },
    { id: 'import-other', label: '其他文件（AI 识别）', action: 'import-other' },
  ]
  const exportMenuItems: MenuItem[] = [
    { id: 'csv', label: '导出为 .csv', action: 'csv' },
    { id: 'xlsx', label: '导出为 .xlsx', action: 'xlsx' },
    { id: 'docx', label: '导出为 .docx', action: 'docx' },
    { id: 'pdf', label: '导出为 .pdf', action: 'pdf' },
    { id: 'txt', label: '导出为 .txt', action: 'txt' },
  ]

  const placeDropdownMenu = (el: HTMLElement | null, width = 196) => {
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: Math.max(10, rect.right - width), y: rect.bottom + 6 }
  }

  const agentImportInitialFolderId = computed(() => {
    const selected = parseFolderId(ctx.props.selectedFolderId || '')
    if (selected !== null && selected >= 0) return selected
    return settingsManager.get('questionSaveFolderId') ?? 0
  })

  const toggleImportMenu = () => {
    if (ctx.importMenuOpen.value) {
      ctx.importMenuOpen.value = false
      return
    }
    ctx.importMenuPos.value = placeDropdownMenu(ctx.importButtonRef.value, 232)
    ctx.importMenuOpen.value = true
  }

  const importOtherFileWithAgent = async () => {
    if (!isTauriEnvironment()) {
      alert('此功能仅在 Tauri 应用中可用')
      return
    }
    if (!modelConfigManager.getSelectedTextModel() && !modelConfigManager.getSelectedModel()) {
      alert('请先在设置里选择一个文本模型，再使用 AI 识别导入')
      return
    }
    try {
      const selected = await open({
        title: '选择要识别的文件',
        multiple: false,
        directory: false,
        filters: [{
          name: '题目文件',
          extensions: ['txt', 'md', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pdf'],
        }],
      })
      if (!selected) return
      ctx.pendingAgentImportPath.value = Array.isArray(selected) ? selected[0] : selected
      ctx.agentImportPickerVisible.value = true
    } catch (error) {
      console.error('选择文件失败:', error)
    }
  }

  const cancelAgentImportFolder = () => {
    ctx.agentImportPickerVisible.value = false
    ctx.pendingAgentImportPath.value = null
  }

  const confirmAgentImportFolder = (folderId: number, folderName: string, folderPath: string) => {
    const filePath = ctx.pendingAgentImportPath.value
    ctx.agentImportPickerVisible.value = false
    ctx.pendingAgentImportPath.value = null
    if (!filePath) return
    void startFileImportChat({ filePath, folderId, folderName, folderPath })
    window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  }

  const importSoftwareExportedFile = async () => {
    if (!isTauriEnvironment()) {
      alert('此功能仅在 Tauri 应用中可用')
      ctx.importMenuOpen.value = false
      return
    }
    try {
      const selected = await open({
        title: '选择要导入的文件',
        multiple: false,
        directory: false,
        filters: [{ name: '支持的文件', extensions: ['csv', 'xlsx', 'docx', 'txt', 'pdf'] }],
      })
      if (selected) {
        const path = Array.isArray(selected) ? selected[0] : selected
        ctx.loading.value = true
        try {
          const items = await parseSoftwareExportedFile(path)
          await tauriEmit('open-import-dialog', { items })
        } catch (error) {
          console.error('解析文件失败:', error)
          alert('解析文件失败: ' + (error as Error).message)
        } finally {
          ctx.loading.value = false
        }
      }
    } catch (error) {
      console.error('打开文件失败:', error)
    }
    ctx.importMenuOpen.value = false
  }

  const handleImportMenuClick = (item: MenuItem) => {
    ctx.importMenuOpen.value = false
    if (item.action === 'import-zerror') void importSoftwareExportedFile()
    else if (item.action === 'import-other') void importOtherFileWithAgent()
  }

  const toggleExportMenu = () => {
    if (ctx.exportMenuOpen.value) {
      ctx.exportMenuOpen.value = false
      return
    }
    ctx.exportMenuPos.value = placeDropdownMenu(ctx.exportButtonRef.value, 168)
    ctx.exportMenuOpen.value = true
  }

  const getExportQuestions = async () => {
    if (ctx.isSearchMode.value) {
      return sortQuestionListByCreateTime(ctx.questions.value, ctx.createTimeSortOrder.value)
    }
    if (ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
      return sortQuestionListByCreateTime(await databaseService.getPendingCorrectionQuestions(), ctx.createTimeSortOrder.value)
    }
    if (hasSelectedFolder(ctx.props.selectedFolderId) && ctx.props.selectedFolderId !== PENDING_CORRECTION_FOLDER_ID) {
      const folderIdNum = parseFolderId(ctx.props.selectedFolderId || '')
      if (folderIdNum !== null) {
        return sortQuestionListByCreateTime(
          await databaseService.getQuestionsFromFolderAndSubfolders(folderIdNum),
          ctx.createTimeSortOrder.value,
        )
      }
    }
    return sortQuestionListByCreateTime(await databaseService.getAIResponses(), ctx.createTimeSortOrder.value)
  }

  const exportFile = async (format: 'csv' | 'xlsx' | 'docx' | 'pdf' | 'txt') => {
    ctx.exportMenuOpen.value = false
    if (ctx.totalQuestions.value === 0 && ctx.questions.value.length === 0) {
      alert('当前没有题目可导出')
      return
    }
    if (!isTauriEnvironment()) {
      alert('此功能仅在 Tauri 应用中可用')
      return
    }
    try {
      const currentDate = new Date().toISOString().split('T')[0]
      const folderName = ctx.folderPath.value.length
        ? ctx.folderPath.value[ctx.folderPath.value.length - 1].name
        : '题目列表'
      const filePath = await save({
        title: '导出题目',
        filters: [{ name: format.toUpperCase() + ' 文件', extensions: [format] }],
        defaultPath: `${folderName}_${currentDate}.${format}`,
      })
      if (!filePath) return
      ctx.loading.value = true
      const data = await generateExportData(await getExportQuestions(), format as ExportFormat)
      await writeFile(filePath, data)
      alert(`导出成功！文件已保存至: ${filePath}`)
    } catch (error) {
      console.error('导出失败:', error)
      alert(`导出失败: ${(error as Error).message}`)
    } finally {
      ctx.loading.value = false
    }
  }

  const handleExportMenuClick = (item: MenuItem) => {
    ctx.exportMenuOpen.value = false
    if (item.action) void exportFile(item.action as ExportFormat)
  }

  Object.assign(ctx.ops, { importSoftwareExportedFile, importOtherFileWithAgent, exportFile })
  return {
    importMenuItems,
    exportMenuItems,
    placeDropdownMenu,
    toggleImportMenu,
    handleImportMenuClick,
    agentImportInitialFolderId,
    importOtherFileWithAgent,
    cancelAgentImportFolder,
    confirmAgentImportFolder,
    importSoftwareExportedFile,
    toggleExportMenu,
    handleExportMenuClick,
    getExportQuestions,
    exportFile,
  }
}
