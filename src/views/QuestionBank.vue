<script setup lang="ts">
import { ref } from "vue";
import FileTree from "../components/FileTree.vue";
import QuestionList from "../components/QuestionList.vue";
import type { AIResponse } from "../services/database";

// 接收来自顶层 App 的折叠触发器，用于在切换 tab 时收起题目详情
const props = defineProps<{ collapseTrigger?: number }>();

const selectedFolderId = ref<string | null>(null);
const selectedFolderName = ref<string | null>(null);
const selectedQuestion = ref<AIResponse | null>(null);

// 分割器相关状态
const sidebarWidth = ref(300);
const isResizing = ref(false);

// 子组件引用
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
const questionListRef = ref<InstanceType<typeof QuestionList> | null>(null);

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
  
  const newWidth = event.clientX;
  const minWidth = 200;
  const maxWidth = window.innerWidth * 0.6; // 最大占屏幕宽度的60%
  
  if (newWidth >= minWidth && newWidth <= maxWidth) {
    sidebarWidth.value = newWidth;
  }
};

const stopResize = () => {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
};
</script>

<template>
  <div class="questions-layout">
    <!-- 文件树侧边栏 -->
    <div class="file-sidebar" :style="{ width: sidebarWidth + 'px' }">
      <!-- 刷新按钮 -->
      <div class="refresh-header">
        <button @click="handleRefresh" class="refresh-btn" title="刷新文件夹数据">
          <svg t="1761878935942" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5659" width="16" height="16">
            <path d="M379.392 870.4c-92.672-44.828-171.918-143.19-198.03-245.76-24.576-96.484-6.258-200.932 50.517-288.54 48.81-75.208 117.191-125.896 217.316-161.11 24.69-8.704 44.942-18.375 44.942-21.56 0-3.13-10.923-16.612-24.292-29.924-27.306-27.193-29.582-36.921-12.401-54.272 19.91-20.139 36.58-16.327 71.68 16.327 16.839 15.644 46.592 41.301 66.104 57.003 38.23 30.72 47.616 44.6 42.895 63.601-2.674 10.468-57.856 82.774-98.816 129.48-19.229 21.902-32.086 27.59-46.82 20.82a44.373 44.373 0 0 1-17.75-16.497c-7.11-13.54-0.682-27.762 28.787-63.374 10.808-13.085 19.74-25.6 19.74-27.705 0-7.794-25.657-10.013-54.955-4.722-51.257 9.216-96.825 34.987-141.994 80.213-22.528 22.585-45.227 50.745-52.167 64.683-48.925 98.361-46.536 211.797 6.371 302.763 24.462 41.927 81.237 95.858 122.937 116.622 96.825 48.242 204.345 45.397 294.684-7.737C806.4 737.166 867.556 601.26 842.183 480.825c-8.704-41.529-34.36-98.247-59.278-131.3-22.699-30.037-28.274-43.235-24.633-58.026 3.925-15.759 26.34-24.406 42.382-16.27 28.445 14.279 82.375 99.669 99.84 157.98 13.938 46.364 12.686 155.079-2.275 203.947-13.085 42.666-46.251 108.373-69.632 138.069-24.178 30.72-78.507 75.207-116.054 95.232-59.164 31.403-143.417 46.08-213.56 37.205-46.308-5.86-70.145-13.312-119.581-37.262z" p-id="5660"></path>
          </svg>
          <span>刷新</span>
        </button>
      </div>
      
      <FileTree 
        ref="fileTreeRef"
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

.refresh-header {
  padding: 8px 12px;
  background-color: var(--bg-secondary, #ffffff);
  border-bottom: 1px solid var(--border-primary, #e5e5e5);
  flex-shrink: 0;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: var(--bg-primary, #f8f9fa);
  border: 1px solid var(--border-primary, #e5e5e5);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary, #333333);
  transition: all 0.2s ease;
  width: 100%;
  justify-content: center;
}

.refresh-btn:hover {
  background-color: var(--bg-hover, #e9ecef);
  border-color: var(--border-hover, #d0d7de);
}

.refresh-btn:active {
  background-color: var(--bg-active, #dee2e6);
  transform: translateY(1px);
}

.refresh-btn .icon {
  fill: var(--text-primary, #333333);
  transition: transform 0.2s ease;
}

.refresh-btn:hover .icon {
  transform: rotate(180deg);
}

.refresh-btn span {
  font-weight: 500;
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