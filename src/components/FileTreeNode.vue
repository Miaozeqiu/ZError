<template>
  <div class="file-tree-node">
    <div 
      class="node-content" 
      :class="{ 
        'selected': isSelected, 
        'folder': node.type === 'folder',
        'file': node.type === 'file',
        'dragging': isDragging,
        'drag-over': isDragOver,
        'drag-over-top': dragPosition === 'top',
        'drag-over-bottom': dragPosition === 'bottom',
        'drag-over-center': dragPosition === 'center'
      }"
      :style="{ paddingLeft: (level * 16) + 'px' }"
      :draggable="node.type === 'folder' && !isRenaming"
      @click="handleClick"
      @contextmenu.prevent="handleRightClick"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragenter="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <!-- 层级连接线 -->
      <div class="level-lines">
        <div 
          v-for="i in level" 
          :key="i"
          class="level-line"
          :style="{ left: ((i - 1) * 16 + 8) + 'px' }"
        ></div>
        <!-- 当前节点的连接线 -->
        <div 
          v-if="level > 0"
          class="current-level-line"
          :style="{ left: ((level - 1) * 16 + 8) + 'px' }"
        ></div>
      </div>
      
      <!-- 展开/折叠箭头 -->
      <span 
        v-if="node.type === 'folder'" 
        class="expand-arrow"
        :class="{ 'expanded': isExpanded }"
        @click="handleArrowClick"
      >
        <!-- 有子文件夹时显示箭头 -->
        <svg v-if="hasChildren" aria-hidden="true" focusable="false" class="octicon octicon-chevron-right" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;">
          <path d="M4.7 10c-.2 0-.4-.1-.5-.2-.3-.3-.3-.8 0-1.1L6.9 6 4.2 3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l3.3 3.2c.3.3.3.8 0 1.1L5.3 9.7c-.2.2-.4.3-.6.3Z"></path>
        </svg>
        <!-- 没有子文件夹时显示圆点 -->
        <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="vertical-align: text-bottom;">
          <circle cx="6" cy="6" r="2" />
        </svg>
      </span>
      <span v-else class="expand-arrow-placeholder"></span>
      
      <!-- 文件/文件夹图标 -->
      <span class="node-icon">
        <template v-if="node.type === 'folder'">
          <!-- 有子文件夹时根据展开状态显示不同图标 -->
          <template v-if="hasChildren">
            <svg v-if="isExpanded" aria-hidden="true" focusable="false" class="octicon octicon-file-directory-open-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;">
              <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z"></path>
            </svg>
            <svg v-else aria-hidden="true" focusable="false" class="octicon octicon-file-directory-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;">
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
            </svg>
          </template>
          <!-- 没有子文件夹时始终显示关闭状态图标 -->
          <template v-else>
            <svg aria-hidden="true" focusable="false" class="octicon octicon-file-directory-fill" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;">
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
            </svg>
          </template>
        </template>
        <template v-else>
          <svg width="16" height="16" viewBox="0 0 16 16" class="file-icon">
            <path 
              fill="currentColor" 
              :d="getFileIconPath(node.name)"
            />
          </svg>
        </template>
      </span>
      
      <!-- 文件/文件夹名称 -->
      <span v-if="!isRenaming" class="node-name">{{ node.name }}</span>
      
      <!-- 重命名输入框 -->
      <input 
        v-else
        ref="renameInput"
        v-model="renameValue"
        class="rename-input"
        @blur="handleRenameBlur"
        @keydown.enter="handleRenameEnter"
        @keydown.esc="handleRenameEsc"
        @click.stop
        @mousedown.stop
        @selectstart.stop
      />
      
      <!-- 题目数量显示 -->
      <span v-if="node.type === 'folder' && node.totalQuestionCount !== undefined" class="question-count">
        {{ node.totalQuestionCount }}
      </span>
    </div>
    
    <!-- 子节点 -->
    <div v-if="node.type === 'folder' && isExpanded && node.children" class="children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        :dragged-node-id="draggedNodeId"
        :expanded-folders="expandedFolders"
        :renaming-node-id="renamingNodeId"
        :rename-value="renameValue"
        @select="(id) => emit('select', id)"
        @context-menu="(data) => emit('context-menu', data)"
        @expand-folder="(id) => emit('expand-folder', id)"
        @move-folder="(data) => emit('move-folder', data)"
        @drag-start="(nodeId) => emit('drag-start', nodeId)"
        @drag-end="() => emit('drag-end')"
        @rename-save="(nodeId, newName) => emit('rename-save', nodeId, newName)"
        @rename-cancel="() => emit('rename-cancel')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface TreeNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  questionCount?: number;
  totalQuestionCount?: number;
}

interface Props {
  node: TreeNode;
  level: number;
  selectedId: string | null;
  draggedNodeId: string | null;
  expandedFolders: Set<string>;
  renamingNodeId?: string | null;
  renameValue?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [id: string];
  'context-menu': [{ node: TreeNode; x: number; y: number }];
  'expand-folder': [id: string];
  'move-folder': [{ sourceId: string; targetId: string; position: 'before' | 'after' | 'inside' }];
  'drag-start': [nodeId: string];
  'drag-end': [];
  'rename-save': [nodeId: string, newName: string];
  'rename-cancel': [];
}>();

const isExpanded = computed(() => props.expandedFolders.has(props.node.id));
const isDragging = ref(false);
const isDragOver = ref(false);
const dragPosition = ref<'top' | 'center' | 'bottom' | null>(null);
const dragExpandTimer = ref<number | null>(null); // 拖拽展开定时器

const isSelected = computed(() => props.selectedId === props.node.id);

// 重命名相关
const isRenaming = computed(() => props.renamingNodeId === props.node.id);
const renameInput = ref<HTMLInputElement | null>(null);
const renameValue = ref(props.renameValue || props.node.name);

// 监听重命名状态变化，自动聚焦输入框
watch(isRenaming, async (newVal) => {
  if (newVal) {
    renameValue.value = props.renameValue || props.node.name;
    await nextTick();
    if (renameInput.value) {
      renameInput.value.focus();
      renameInput.value.select();
    }
  }
});

// 重命名事件处理
const handleRenameBlur = () => {
  if (renameValue.value.trim() && renameValue.value !== props.node.name) {
    emit('rename-save', props.node.id, renameValue.value.trim());
  } else {
    emit('rename-cancel');
  }
};

const handleRenameEnter = () => {
  if (renameValue.value.trim() && renameValue.value !== props.node.name) {
    emit('rename-save', props.node.id, renameValue.value.trim());
  } else {
    emit('rename-cancel');
  }
};

const handleRenameEsc = () => {
  emit('rename-cancel');
};

// 检查是否有子节点
const hasChildren = computed(() => {
  return props.node.children && props.node.children.length > 0;
});



const handleClick = () => {
  emit('select', props.node.id);
  // 点击文件夹时自动展开并触发展开事件
  if (props.node.type === 'folder' && hasChildren.value && !isExpanded.value) {
    emit('expand-folder', props.node.id);
  }
};

const handleArrowClick = (event: MouseEvent) => {
  event.stopPropagation(); // 阻止事件冒泡
  if (props.node.type === 'folder' && hasChildren.value) {
    emit('expand-folder', props.node.id);
  }
};

const handleRightClick = (event: MouseEvent) => {
  emit('context-menu', {
    node: props.node,
    x: event.clientX,
    y: event.clientY
  });
};

const getFileIconPath = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  // 根据文件扩展名返回不同的SVG路径
  switch (ext) {
    case 'vue':
      return 'M2 2l2 12h8l2-12H2zm1.5 1h9l-1.5 9H5L3.5 3z';
    case 'ts':
    case 'js':
      return 'M1 1v14h14V1H1zm12 12H3V3h10v10z';
    case 'json':
      return 'M6 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zm0 1h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z';
    case 'html':
      return 'M1 1v14h14V1H1zm12 12H3V3h10v10zM5 5v2h2V5H5zm4 0v2h2V5H9zM5 9v2h6V9H5z';
    case 'css':
      return 'M2 2v12h12V2H2zm10 10H4V4h8v8z';
    case 'md':
      return 'M2 3v10h12V3H2zm10 8H4V5h8v6z';
    default:
      return 'M4 1h8l2 2v10l-2 2H4l-2-2V3l2-2zm0 1L3 3v10l1 1h8l1-1V3l-1-1H4z';
  }
};

// 拖拽事件处理函数
const handleDragStart = (event: DragEvent) => {
  console.log(`FileTreeNode[${props.node.id}]: dragstart 事件触发`, {
    nodeId: props.node.id,
    nodeName: props.node.name,
    nodeType: props.node.type
  });
  
  if (props.node.type !== 'folder') {
    event.preventDefault();
    return;
  }
  
  isDragging.value = true;
  
  // 立即发送 drag-start 事件到父组件
  console.log(`FileTreeNode[${props.node.id}]: 即将 emit drag-start 事件`, props.node.id);
  emit('drag-start', props.node.id);
  console.log(`FileTreeNode[${props.node.id}]: drag-start 事件已发送`);
  
  // 简化拖拽数据传输 - 只设置必要的数据
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', props.node.id);
    
    event.dataTransfer.setData('application/json', JSON.stringify({
      id: props.node.id,
      name: props.node.name,
      type: props.node.type
    }));
    
    console.log(`FileTreeNode[${props.node.id}]: 拖拽数据已设置`, {
      id: props.node.id,
      name: props.node.name,
      type: props.node.type
    });
  }
};

const handleDragEnd = () => {
  console.log('FileTreeNode: dragend 事件触发', {
    nodeId: props.node.id,
    draggedNodeId: props.draggedNodeId
  });
  
  isDragging.value = false;
  isDragOver.value = false;
  dragPosition.value = null;
  
  // 通过 emit 通知父组件清理拖拽状态
  emit('drag-end');
  
  console.log('FileTreeNode: 通知父组件清理拖拽状态');
};

const handleDragOver = (event: DragEvent) => {
  // 总是阻止默认行为，这样才能正确控制光标
  event.preventDefault();
  event.stopPropagation();
  
  console.log(`FileTreeNode[${props.node.id}]: dragover 事件触发`, { 
    draggedNodeId: props.draggedNodeId, 
    currentNodeId: props.node.id,
    currentNodeName: props.node.name,
    componentInstance: `FileTreeNode-${props.node.id}`,
    dataTransfer: event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  });
  
  if (!props.draggedNodeId || props.draggedNodeId === props.node.id) {
    // 不能拖拽到自己身上
    console.log(`FileTreeNode[${props.node.id}]: dragover 被阻止 - draggedNodeId=${props.draggedNodeId}, currentId=${props.node.id}`);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
      console.log('FileTreeNode: 设置 dropEffect 为 none (不能拖拽到自己)');
    }
    return;
  }
  
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const y = event.clientY - rect.top;
  const height = rect.height;
  
  // 根据鼠标位置确定放置位置
  if (y < height * 0.25) {
    dragPosition.value = 'top';
  } else if (y > height * 0.75) {
    dragPosition.value = 'bottom';
  } else {
    dragPosition.value = 'center';
  }
  
  isDragOver.value = true;
  
  // 拖拽自动展开逻辑
  if (props.node.type === 'folder' && 
      hasChildren.value && 
      !isExpanded.value && 
      dragPosition.value === 'center') {
    
    // 如果还没有设置定时器，则设置一个延迟展开
    if (!dragExpandTimer.value) {
      console.log(`FileTreeNode[${props.node.id}]: 设置拖拽展开定时器`);
      dragExpandTimer.value = window.setTimeout(() => {
        console.log(`FileTreeNode[${props.node.id}]: 拖拽展开定时器触发，展开文件夹`);
        emit('expand-folder', props.node.id);
        dragExpandTimer.value = null;
      }, 300); // 800ms 延迟
    }
  } else {
    // 如果不是拖拽到文件夹中心，清除定时器
    if (dragExpandTimer.value) {
      console.log(`FileTreeNode[${props.node.id}]: 清除拖拽展开定时器`);
      clearTimeout(dragExpandTimer.value);
      dragExpandTimer.value = null;
    }
  }
  
  // 设置允许移动的光标
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
    console.log('FileTreeNode: 设置 dropEffect 为 move', {
      position: dragPosition.value,
      targetNode: props.node.name,
      afterSet: event.dataTransfer.dropEffect
    });
  }
};

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  
  console.log('FileTreeNode: dragenter 事件触发', { 
    nodeId: props.node.id,
    nodeName: props.node.name,
    draggedNodeId: props.draggedNodeId
  });
  
  // 确保 dropEffect 正确设置
  if (event.dataTransfer && props.draggedNodeId && props.draggedNodeId !== props.node.id) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleDragLeave = (event: DragEvent) => {
  console.log('FileTreeNode: dragleave 事件触发', { 
    nodeId: props.node.id,
    draggedNodeId: props.draggedNodeId,
    relatedTarget: event.relatedTarget
  });
  
  // 检查是否真正离开了元素（而不是进入子元素）
  const currentElement = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as HTMLElement;
  
  if (!currentElement.contains(relatedTarget)) {
    isDragOver.value = false;
    dragPosition.value = null;
    console.log('FileTreeNode: 真正离开元素，清理拖拽状态');
    
    // 清除拖拽展开定时器
    if (dragExpandTimer.value) {
      console.log(`FileTreeNode[${props.node.id}]: 拖拽离开，清除展开定时器`);
      clearTimeout(dragExpandTimer.value);
      dragExpandTimer.value = null;
    }
  }
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  
  console.log(`FileTreeNode[${props.node.id}]: drop 事件触发`, { 
    draggedNodeId: props.draggedNodeId, 
    targetNodeId: props.node.id,
    position: dragPosition.value
  });
  
  if (!props.draggedNodeId || props.draggedNodeId === props.node.id) {
    console.log('FileTreeNode: drop 被阻止 - 无效的拖拽源或拖拽到自己');
    return;
  }
  
  // 清除拖拽展开定时器
  if (dragExpandTimer.value) {
    console.log(`FileTreeNode[${props.node.id}]: drop 时清除展开定时器`);
    clearTimeout(dragExpandTimer.value);
    dragExpandTimer.value = null;
  }
  
  let position: 'before' | 'after' | 'inside';
  
  if (dragPosition.value === 'top') {
    position = 'before';
  } else if (dragPosition.value === 'bottom') {
    position = 'after';
  } else {
    position = 'inside';
  }
  
  console.log('FileTreeNode: 触发 move-folder 事件', {
    sourceId: props.draggedNodeId,
    targetId: props.node.id,
    position
  });
  
  emit('move-folder', {
    sourceId: props.draggedNodeId,
    targetId: props.node.id,
    position
  });
  
  // 清理拖拽状态
  isDragOver.value = false;
  dragPosition.value = null;
};
</script>

<style scoped>
.file-tree-node {
  user-select: none;
  position: relative;
}

.node-content {
  display: flex;
  align-items: center;
  height: 32px;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 13px;
  transition: background-color 0.1s;
  white-space: nowrap;
  position: relative;
  padding-right: 8px;
  border-radius: 6px;
}

.node-content:hover {
  background-color: var(--hover-bg);
  cursor: pointer;
}

.node-content.dragging {
  opacity: 0.5;
  background-color: var(--active-bg);
  cursor: default !important;
}

.node-content.selected {
  background-color: var(--active-bg);
  color: var(--text-primary);
}

.node-content.selected:focus {
  background-color: #0e639c;
}

/* 层级连接线 */
.level-lines {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  pointer-events: none;
}

.level-line {
  position: absolute;
  top: 0;
  width: 0.5px;
  height: 100%;
  background-color: #c2c2c2;
}

.current-level-line {
  position: absolute;
  top: 0;
  width: 0.5px;
  height: 50%;
  background-color: #c2c2c2;
}

/* 展开箭头 */
.expand-arrow {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #cccccc;
  transition: transform 0.2s ease;
}

.expand-arrow.expanded {
  transform: rotate(90deg);
}

.expand-arrow:hover {
  color: #cccccc;
}

.arrow-icon,
.octicon-chevron-right {
  transition: transform 0.2s ease;
}

.expand-arrow-placeholder {
  width: 16px;
  height: 16px;
}

/* 图标样式 */
.node-icon {
  margin: 0 6px 0 4px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.folder-icon,
.octicon-file-directory-fill,
.octicon-file-directory-open-fill {
  color: #f8b62b;
}


.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 0;
  font-weight: 400;
  letter-spacing: 0.02em;
}

.rename-input {
  flex: 1;
  background: #ffffff;
  border: 1px solid #0969da;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 12px;
  font-family: inherit;
  color: #24292f;
  outline: none;
  margin-left: 0;
}

.rename-input:focus {
  border-color: #0969da;
  box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.3);
}

.question-count {
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  border: 1px solid var(--border-secondary);
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
}

/* 拖拽相关样式 */
.node-content.dragging {
  opacity: 0.5;
  background-color: var(--active-bg);
  cursor: default !important;
}

.node-content.drag-over {
  background-color: var(--hover-bg);
}

.node-content.drag-over-top::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background-color: var(--primary-color);
  border-radius: 1px;
  pointer-events: none;
}

.node-content.drag-over-bottom::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background-color: var(--primary-color);
  border-radius: 1px;
  pointer-events: none;
}

.node-content.drag-over-center {
  background-color: var(--hover-bg);
  /* border: 2px dashed #0969da; */
  border-radius: 6px;
}

.node-content[draggable="true"] {
  cursor: pointer;
  -webkit-user-drag: element;
}

.node-content[draggable="true"]:active {
  cursor: pointer;
}


</style>