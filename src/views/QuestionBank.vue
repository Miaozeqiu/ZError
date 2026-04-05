<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import FileTree from "./questions/FileTree.vue";
import QuestionList from "./questions/QuestionList.vue";
import type { AIResponse } from "../services/database";
import { useSettingsManager } from "../composables/useSettingsManager";

// 接收来自顶层 App 的折叠触发器，用于在切换 tab 时收起题目详情
const props = defineProps<{
  collapseTrigger?: number;
  focusFolderId?: number | null;
  focusFolderRequestKey?: number;
}>();

const { settings, setSetting, saveSettings } = useSettingsManager();

const selectedFolderId = ref<string | null>(null);
const selectedFolderName = ref<string | null>(null);
const selectedFolderPath = ref<{ id: number, name: string }[]>([]);
const selectedQuestion = ref<AIResponse | null>(null);
const currentSaveFolderId = computed(() => settings.value.questionSaveFolderId != null ? String(settings.value.questionSaveFolderId) : null);

// 分割器相关状态
const sidebarWidth = ref(300);
const isResizing = ref(false);

// 子组件引用
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null);
const questionListRef = ref<InstanceType<typeof QuestionList> | null>(null);
const layoutRef = ref<HTMLElement | null>(null);
const fileSidebarRef = ref<HTMLElement | null>(null);
const questionPanelRef = ref<HTMLElement | null>(null);
const sidebarScrollbarRef = ref<HTMLElement | null>(null);
const sidebarScrollbarThumbRef = ref<HTMLElement | null>(null);
const panelScrollbarRef = ref<HTMLElement | null>(null);
const panelScrollbarThumbRef = ref<HTMLElement | null>(null);

type ScrollbarPaneKey = 'sidebar' | 'panel';

const scrollbarVisible = ref<Record<ScrollbarPaneKey, boolean>>({
  sidebar: false,
  panel: false
});

const paneSelectors: Record<ScrollbarPaneKey, string> = {
  sidebar: '.tree-content',
  panel: '.list-content'
};

const paneWrapRefs: Record<ScrollbarPaneKey, typeof fileSidebarRef> = {
  sidebar: fileSidebarRef,
  panel: questionPanelRef
};

const paneScrollbarRefs: Record<ScrollbarPaneKey, typeof sidebarScrollbarRef> = {
  sidebar: sidebarScrollbarRef,
  panel: panelScrollbarRef
};

const paneThumbRefs: Record<ScrollbarPaneKey, typeof sidebarScrollbarThumbRef> = {
  sidebar: sidebarScrollbarThumbRef,
  panel: panelScrollbarThumbRef
};

const paneHideTimers: Record<ScrollbarPaneKey, ReturnType<typeof setTimeout> | null> = {
  sidebar: null,
  panel: null
};

const paneCleanupMap = new Map<ScrollbarPaneKey, () => void>();

const getPaneContent = (key: ScrollbarPaneKey) => {
  return paneWrapRefs[key].value?.querySelector(paneSelectors[key]) as HTMLElement | null;
};

const hideScrollbar = (key: ScrollbarPaneKey) => {
  scrollbarVisible.value[key] = false;
  if (paneHideTimers[key]) {
    clearTimeout(paneHideTimers[key]);
    paneHideTimers[key] = null;
  }
};

const showScrollbar = (key: ScrollbarPaneKey) => {
  const content = getPaneContent(key);
  if (!content || content.scrollHeight <= content.clientHeight + 1) {
    hideScrollbar(key);
    return;
  }

  scrollbarVisible.value[key] = true;
  if (paneHideTimers[key]) clearTimeout(paneHideTimers[key]);
  paneHideTimers[key] = setTimeout(() => {
    scrollbarVisible.value[key] = false;
  }, 1500);
};

const updateScrollbarThumb = (key: ScrollbarPaneKey) => {
  const content = getPaneContent(key);
  const thumb = paneThumbRefs[key].value;
  const bar = paneScrollbarRefs[key].value;
  if (!content || !thumb || !bar) return;

  const ratio = content.clientHeight / content.scrollHeight;
  if (!Number.isFinite(ratio) || ratio >= 1) {
    thumb.style.height = '0px';
    thumb.style.transform = 'translateY(0)';
    hideScrollbar(key);
    return;
  }

  const thumbHeight = Math.max(ratio * bar.clientHeight, 32);
  const maxThumbTop = Math.max(bar.clientHeight - thumbHeight, 0);
  const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 1);
  const thumbTop = (content.scrollTop / maxScrollTop) * maxThumbTop;

  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
};

const handlePaneScroll = (key: ScrollbarPaneKey) => {
  updateScrollbarThumb(key);
  showScrollbar(key);
};

const onScrollbarMousedown = (key: ScrollbarPaneKey, event: MouseEvent) => {
  const thumb = paneThumbRefs[key].value;
  const content = getPaneContent(key);
  const bar = paneScrollbarRefs[key].value;
  if (!thumb || !content || !bar) return;

  const dragStartY = event.clientY;
  const dragStartScrollTop = content.scrollTop;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const thumbHeight = thumb.clientHeight;
    const barHeight = bar.clientHeight;
    const maxThumbTravel = Math.max(barHeight - thumbHeight, 1);
    const delta = moveEvent.clientY - dragStartY;
    const scrollRatio = delta / maxThumbTravel;
    content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  event.preventDefault();
  showScrollbar(key);
};

const bindPaneScrollbar = (key: ScrollbarPaneKey) => {
  paneCleanupMap.get(key)?.();

  const content = getPaneContent(key);
  if (!content) return;

  const onScroll = () => handlePaneScroll(key);
  const onPointerEnter = () => showScrollbar(key);
  const onPointerLeave = () => {
    updateScrollbarThumb(key);
  };

  content.addEventListener('scroll', onScroll, { passive: true });
  content.addEventListener('mouseenter', onPointerEnter);
  content.addEventListener('mouseleave', onPointerLeave);

  const resizeObserver = new ResizeObserver(() => updateScrollbarThumb(key));
  resizeObserver.observe(content);

  const mutationObserver = new MutationObserver(() => {
    requestAnimationFrame(() => updateScrollbarThumb(key));
  });
  mutationObserver.observe(content, { childList: true, subtree: true, characterData: true });

  requestAnimationFrame(() => updateScrollbarThumb(key));

  paneCleanupMap.set(key, () => {
    content.removeEventListener('scroll', onScroll);
    content.removeEventListener('mouseenter', onPointerEnter);
    content.removeEventListener('mouseleave', onPointerLeave);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  });
};

const initCustomScrollbars = async () => {
  await nextTick();
  bindPaneScrollbar('sidebar');
  bindPaneScrollbar('panel');
  requestAnimationFrame(() => {
    updateScrollbarThumb('sidebar');
    updateScrollbarThumb('panel');
  });
};

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

// 处理题目修改后的文件夹数据刷新
const handleQuestionUpdated = () => {
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

const handleSetSaveFolder = async (folderId: number, folderName: string, folderPath: string) => {
  try {
    setSetting('questionSaveDir', folderPath || folderName);
    setSetting('questionSaveFolderId', folderId);
    await saveSettings();
  } catch (error) {
    console.error('设置题目保存文件夹失败:', error);
  }
};

watch(
  () => [props.focusFolderId, props.focusFolderRequestKey] as const,
  async ([folderId]) => {
    if (folderId === null || folderId === undefined) {
      return;
    }

    await nextTick();
    await fileTreeRef.value?.focusFolder(folderId);
  }
);

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

const handleWindowResize = () => {
  updateScrollbarThumb('sidebar');
  updateScrollbarThumb('panel');
};

watch(() => selectedFolderId.value, () => {
  initCustomScrollbars();
});

watch(() => props.collapseTrigger, () => {
  initCustomScrollbars();
});

onMounted(() => {
  initCustomScrollbars();
  window.addEventListener('resize', handleWindowResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize);
  paneCleanupMap.forEach(cleanup => cleanup());
  paneCleanupMap.clear();
  (Object.keys(paneHideTimers) as ScrollbarPaneKey[]).forEach((key) => {
    if (paneHideTimers[key]) {
      clearTimeout(paneHideTimers[key]);
      paneHideTimers[key] = null;
    }
  });
});
</script>

<template>
  <div class="questions-layout" ref="layoutRef">
    <!-- 文件树侧边栏 -->
    <div class="file-sidebar" ref="fileSidebarRef" :style="{ width: sidebarWidth + 'px' }">
      <FileTree 
        ref="fileTreeRef"
        :current-folder-path="selectedFolderPath"
        :highlight-folder-id="currentSaveFolderId"
        :show-set-save-folder-action="true"
        @folder-select="handleFolderSelect" 
        @expand-folder="handleExpandFolder"
        @set-save-folder="handleSetSaveFolder"
      />
      <div
        class="custom-scrollbar"
        :class="{ 'is-visible': scrollbarVisible.sidebar }"
        ref="sidebarScrollbarRef"
        @mousedown="onScrollbarMousedown('sidebar', $event)"
      >
        <div class="custom-scrollbar-thumb" ref="sidebarScrollbarThumbRef"></div>
      </div>
    </div>
    
    <!-- 分割器 -->
    <div 
      class="resizer" 
      @mousedown="startResize"
      :class="{ 'resizing': isResizing }"
    ></div>
    
    <!-- 题目列表 -->
    <div class="question-panel" ref="questionPanelRef">
      <QuestionList 
        ref="questionListRef"
        :selected-folder-id="selectedFolderId"
        :collapse-trigger="props.collapseTrigger"
        @question-select="handleQuestionSelect"
        @question-pasted="handleQuestionPasted"
        @question-added="handleQuestionAdded"
        @question-updated="handleQuestionUpdated"
        @refresh="handleRefresh"
        @folder-path-change="p => selectedFolderPath = p"
      />
      <div
        class="custom-scrollbar"
        :class="{ 'is-visible': scrollbarVisible.panel }"
        ref="panelScrollbarRef"
        @mousedown="onScrollbarMousedown('panel', $event)"
      >
        <div class="custom-scrollbar-thumb" ref="panelScrollbarThumbRef"></div>
      </div>
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
  position: relative;
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
  position: relative;
  margin-bottom: 5px;
  margin-right: 5px;
  border-radius: 4px;
  flex: 1;
  background-color: var(--bg-primary, #ffffff);
  /* border-right: 1px solid var(--border-primary, #e5e5e5); */
  overflow: hidden;
}

:deep(.tree-content),
:deep(.list-content) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

:deep(.tree-content::-webkit-scrollbar),
:deep(.list-content::-webkit-scrollbar),
:deep(.tree-content::-webkit-scrollbar-button),
:deep(.list-content::-webkit-scrollbar-button) {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}
</style>
