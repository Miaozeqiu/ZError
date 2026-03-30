<template>
  <div v-if="visible" class="dialog-overlay" @click="$emit('cancel')">
    <div class="dialog-panel folder-picker-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">选择文件夹</h3>
        <button class="btn-confirm" :disabled="selectedFolderId === null" @click="handleConfirm">确认</button>

      </div>
      <div class="dialog-body">
        <div class="tree-wrap">
          <FileTree
            :initial-selected-id="initialSelectedId"
            :highlight-folder-id="currentSaveFolderId"
            selection-mode="leaf-only"
            @folder-select="handleFolderSelect"
          />

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import FileTree from './questions/FileTree.vue'
import { databaseService } from '../services/database'

const props = defineProps<{
  visible: boolean
  initialFolderId?: number | null
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [folderId: number, folderName: string, folderPath: string]
}>()

const initialSelectedId = computed(() =>
  props.initialFolderId != null ? String(props.initialFolderId) : null
)

const currentSaveFolderId = computed(() =>
  props.initialFolderId != null ? String(props.initialFolderId) : null
)

const selectedFolderId = ref<number | null>(null)

const selectedFolderName = ref('')
const selectedFolderPath = ref('')

// 每次打开时重置为初始值
watch(() => props.visible, (v) => {
  if (v) {
    selectedFolderId.value = null
    selectedFolderName.value = ''
    selectedFolderPath.value = ''
  }
})


const buildFolderPath = async (folderId: number): Promise<string> => {
  try {
    const folders = await databaseService.getFolders()
    const map = new Map(folders.map((f: any) => [f.id, f]))
    const parts: string[] = []
    let current: any = map.get(folderId)
    while (current) {
      if (current.id === 0) break // 跳过默认文件夹（id=0）
      parts.unshift(current.name)
      if (current.parent_id === null) break
      current = map.get(current.parent_id) ?? null
    }
    return parts.join(' / ') || selectedFolderName.value
  } catch (e) {
    console.error('[buildFolderPath] 错误:', e)
    return selectedFolderName.value
  }
}

const handleFolderSelect = async (folderId: number, folderName: string) => {
  selectedFolderId.value = folderId
  selectedFolderName.value = folderName
  selectedFolderPath.value = await buildFolderPath(folderId)
}

const handleConfirm = () => {
  if (selectedFolderId.value !== null) {
    emit('confirm', selectedFolderId.value, selectedFolderName.value, selectedFolderPath.value)
  }
}
</script>

<style>
@import '../styles/dialog.css';
</style>

<style scoped>
.folder-picker-panel {
  max-width: 400px;
  height: 500px;
  display: flex;
  flex-direction: column;
}

.tree-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.tree-wrap :deep(.tree-header) {
  display: none;
}

.tree-wrap :deep(.file-tree),
.tree-wrap :deep(.tree-content) {
  background-color: transparent;
}
</style>

