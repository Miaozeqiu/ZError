<script setup lang="ts">
import { ref } from "vue";
import FileTree from "../components/questions/FileTree.vue";
import QuestionList from "../components/questions/QuestionList.vue";
import type { AIResponse } from "../services/database";

// 接收来自顶层 App 的折叠触发器，用于在切换 tab 时收起题目详情
const props = defineProps<{ collapseTrigger?: number }>();

const selectedFolderId = ref<string | null>(null);
const selectedFolderName = ref<string | null>(null);
const selectedFolderPath = ref<{ id: number, name: string }[]>([]);
const selectedQuestion = ref<AIResponse | null>(null);

// 分割器相关状态
const sidebarWidth = ref(300);
const isResizing = ref(false);

// 子组件引用
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
const questionListRef = ref<InstanceType<typeof QuestionList> | null>(null);
const layoutRef = ref<HTMLElement | null>(null);

const handleFolderSelect = async (folderId: number, folderName: string) => {
  try {
    selectedFolderId.value = folderId.toString();
    selectedFolderName.value = folderName;
    selectedQuestion.value = null; // 清除之前选中的题目
  } catch (error) {
    console.error('QuestionBank handleFolderSelect error:', error);
  }
};

const handleExpandFolder = (folderId: string) => {
  // 当文件夹展开时，加载该文件夹及其所有子文件夹的题目
  selectedFolderId.value = folderId;
  selectedQuestion.value = null; // 清除之前选中的题目
};

const handleQuestionSelect = (question: AIResponse) => {
  selectedQuestion.value = question;
};

// 处理题目粘贴后的文件夹数据刷新
const handleQuestionPasted = () => {
  // 刷新文件夹数据以更新题目数量
  if (fileTreeRef.value) {
    fileTreeRef.value.refreshData();
  }
};

// 处理题目添加后的文件夹数据刷新
const handleQuestionAdded = () => {
  // 刷新文件夹数据以更新题目数量
  if (fileTreeRef.value) {
    fileTreeRef.value.refreshData();
  }
};

// 手动刷新文件夹数据
const handleRefresh = () => {
  console.log('手动刷新文件夹数据');
  if (fileTreeRef.value) {
    fileTreeRef.value.refreshData();
  }
  // 同步刷新当前分页表格数据
  if (questionListRef.value) {
    questionListRef.value.refreshData();
  }
};

// 分割器拖拽功能
const startResize = (event: MouseEvent) => {
  isResizing.value = true;
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  event.preventDefault();
};

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) return;

  const rect = layoutRef.value?.getBoundingClientRect();
  const relativeX = rect ? event.clientX - rect.left : event.clientX;
  const minWidth = 200;
  const maxWidth = window.innerWidth * 0.6;

  if (relativeX >= minWidth && relativeX <= maxWidth) {
    sidebarWidth.value = relativeX;
  }
};

const stopResize = () => {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
};
</script>

<template>
  <div class="questions-layout" ref="layoutRef">
    <!-- 文件树侧边栏 -->
    <div class="file-sidebar" :style="{ width: sidebarWidth + 'px' }">
      
      <FileTree 
        ref="fileTreeRef"
        :current-folder-path="selectedFolderPath"
        @folder-select="handleFolderSelect" 
        @expand-folder="handleExpandFolder"
      />
    </div>
    
    <!-- 分割器 -->
    <div 
      class="resizer" 
      @mousedown="startResize"
      :class="{ 'resizing': isResizing }"
    ></div>
    
    <!-- 题目列表 -->
    <div class="question-panel">
      <QuestionList 
        ref="questionListRef"
        :selected-folder-id="selectedFolderId"
        :collapse-trigger="props.collapseTrigger"
        @question-select="handleQuestionSelect"
        @question-pasted="handleQuestionPasted"
        @question-added="handleQuestionAdded"
        @refresh="handleRefresh"
        @folder-path-change="p => selectedFolderPath = p"
      />
    </div>
  </div>
</template>

<style scoped>
.questions-layout {
  background-color: var(--bg-primary, #f4f4f4);
  display: flex;
  height: 100%;
  overflow: hidden;
}

.file-sidebar {
  margin-bottom: 5px;
  border-radius: 4px;
  min-width: 200px;
  max-width: 60vw;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.resizer {
  width: 4px;
  background-color: var(--bg-primary, #f4f4f4);
  cursor: ew-resize;
  flex-shrink: 0;
  transition: background-color 0.2s ease;
}

.resizer:hover {
  /* background-color: var(--color-primary, #007acc); */
}

.resizer.resizing {
  /* background-color: var(--color-primary, #007acc); */
}

.question-panel {
  margin-bottom: 5px;
  margin-right: 5px;
  border-radius: 4px;
  flex: 1;
  background-color: var(--bg-primary, #ffffff);
  /* border-right: 1px solid var(--border-primary, #e5e5e5); */
  overflow: hidden;
}
</style>