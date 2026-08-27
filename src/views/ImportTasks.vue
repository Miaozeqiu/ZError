<template>
  <div class="import-tasks-page">
    <div v-if="importTasks.length === 0" class="empty-state">
      <div class="empty-text">还没有导入任务</div>
      <div class="empty-subtext">在题库页点导入，选择「其他文件」，AI 会查看文件并写入指定文件夹</div>
    </div>

    <div v-else class="page-split">
      <ImportTaskSidebar
        :tasks="importTasks"
        :selected-id="selectedId"
        :finished-count="finishedCount"
        @select="selectedId = $event"
        @clear-finished="clearFinishedImportTasks"
      />

      <ImportTaskDetail
        :selected-task="selectedTask"
        :visible-steps="visibleSteps"
        @open-folder="emit('open-folder', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ImportTaskSidebar from './importTasks/ImportTaskSidebar.vue'
import ImportTaskDetail from './importTasks/ImportTaskDetail.vue'
import {
  clearFinishedImportTasks,
  importTasks,
  type ImportTask,
} from '../services/app/importTasks'

const emit = defineEmits<{
  'open-folder': [folderId: number]
}>()

const selectedId = ref<string | null>(null)

const finishedCount = computed(() =>
  importTasks.value.filter((task) => task.status === 'done' || task.status === 'failed').length
)

const selectedTask = computed(() =>
  importTasks.value.find((task) => task.id === selectedId.value) || null
)

const isActive = (task: ImportTask) => task.status !== 'done' && task.status !== 'failed'

const visibleSteps = computed(() =>
  (selectedTask.value?.steps || []).filter((step) => step.kind !== 'model')
)

watch(
  importTasks,
  (list) => {
    if (!list.length) {
      selectedId.value = null
      return
    }
    if (!selectedId.value || !list.some((task) => task.id === selectedId.value)) {
      selectedId.value = (list.find(isActive) || list[0]).id
    }
  },
  { immediate: true }
)

watch(
  () => importTasks.value[0]?.id,
  (id, previous) => {
    const newest = importTasks.value[0]
    if (id && id !== previous && newest && isActive(newest)) {
      selectedId.value = id
    }
  }
)
</script>

<style scoped>
.import-tasks-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #fff);
}

.page-split {
  flex: 1;
  min-height: 0;
  display: flex;
}

.empty-state {
  color: var(--text-secondary, #718096);
  font-size: 13px;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
}

.empty-text {
  font-size: 14px;
  color: var(--text-primary, #2d3748);
  margin-bottom: 6px;
}

.empty-subtext {
  font-size: 12px;
  line-height: 1.5;
  max-width: 320px;
}
</style>
