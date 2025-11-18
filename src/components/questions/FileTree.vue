<template>
  <div class="file-tree">
    <div class="tree-header">
      <h3>题目管理器</h3>
    </div>
    <div class="tree-content" @click="hideContextMenu" @contextmenu="handleTreeContentRightClick">
      <template v-if="loading">
        <div class="loading">加载中...</div>
      </template>
      <template v-else-if="treeData && treeData.length > 0">
        <FileTreeNode
          v-for="item in treeData"
          :key="item.id"
          :node="item"
          :level="0"
          :selected-id="selectedId"
          :dragged-node-id="draggedNodeId"
          :expanded-folders="expandedFolders"
          :renaming-node-id="renamingNodeId"
          :rename-value="renameInputValue"
          @select="handleSelect"
          @context-menu="handleContextMenu"
          @expand-folder="handleExpandFolder"
          @move-folder="handleMoveFolder"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
          @rename-save="handleRenameSave"
          @rename-cancel="cancelRename"
        />
      </template>
      <template v-else>
        <div class="empty">暂无数据</div>
      </template>
    </div>
    
    <!-- 右键菜单 -->
    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :is-default-folder="contextMenu.node?.id === '0'"
      :is-blank-area="contextMenu.node?.id === '0' && contextMenu.node?.name === '根目录'"
      @new-folder="handleNewFolder"
      @rename="handleRename"
      @delete="handleDelete"
    />
    
    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      :visible="deleteDialog.visible"
      :folder-name="deleteDialog.folderName"
      :has-parent="deleteDialog.hasParent"
      v-model:delete-questions="deleteDialog.deleteQuestions"
      @confirm="handleDeleteConfirm"
      @cancel="handleDeleteCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import FileTreeNode from './FileTreeNode.vue';
import ContextMenu from './ContextMenu.vue';
import DeleteConfirmDialog from './DeleteConfirmDialog.vue';
import { databaseService, type Folder } from '../../services/database';

interface TreeNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  questionCount?: number;
  totalQuestionCount?: number;
}

const selectedId = ref<string | null>(null);
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  node: null as TreeNode | null
});

// 重命名相关状态
const renamingNodeId = ref<string | null>(null);
const renameInputValue = ref('');

// 删除确认弹窗状态
const deleteDialog = reactive({
  visible: false,
  folderName: '',
  folderId: null as number | null,
  hasParent: false,
  deleteQuestions: false
});

// 全局拖拽状态管理
const draggedNodeId = ref<string | null>(null);

// 展开状态管理
const expandedFolders = ref<Set<string>>(new Set());

const treeData = ref<TreeNode[]>([]);
const loading = ref(true);

// 递归计算文件夹及其所有子文件夹的题目总数
const calculateTotalQuestionCount = (node: TreeNode): number => {
  let totalCount = node.questionCount || 0;
  
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      totalCount += calculateTotalQuestionCount(child);
    }
  }
  
  return totalCount;
};

// 构建文件夹树结构
const buildFolderTree = (folders: Folder[], folderStats: {folderId: number, folderName: string, questionCount: number}[]): TreeNode[] => {
  const folderMap = new Map<number, TreeNode>();
  const statsMap = new Map<number, number>();
  
  console.log('Debug: buildFolderTree 输入参数:', { folders, folderStats });
  
  // 创建统计映射，使用folderId作为key
  folderStats.forEach(stat => {
    statsMap.set(stat.folderId, stat.questionCount);
  });
  
  // 创建所有文件夹节点
  folders.forEach(folder => {
    // 确保 id 存在且有效（注意：id可能为0，所以不能用!folder.id判断）
    if (folder.id !== null && folder.id !== undefined) {
      console.log('Debug: 处理文件夹:', folder);
      folderMap.set(folder.id, {
        id: folder.id.toString(),
        name: folder.name,
        type: 'folder',
        children: [],
        questionCount: statsMap.get(folder.id) || 0
      });
    }
  });
  
  const rootNodes: TreeNode[] = [];
  
  // 构建树结构
  folders.forEach(folder => {
    // 确保 folder.id 存在且在 folderMap 中（注意：id可能为0）
    if ((folder.id !== null && folder.id !== undefined) && folderMap.has(folder.id)) {
      const node = folderMap.get(folder.id)!;
      
      console.log('Debug: 构建树结构 - 处理文件夹:', folder.name, 'parent_id:', folder.parent_id);
      
      // 修复根节点判断逻辑：ParentId 为 null、undefined、0 都视为根节点
      // 特别注意：默认文件夹的ParentId是0，应该被视为根节点
      const isRootNode = folder.parent_id === null || folder.parent_id === undefined || folder.parent_id === 0;
      
      console.log('Debug: 文件夹', folder.name, 'parent_id:', folder.parent_id, 'isRootNode:', isRootNode);
      
      if (isRootNode) {
        // 根节点
        console.log('Debug: 添加根节点:', folder.name);
        rootNodes.push(node);
      } else {
        // 子节点
        const parent = folderMap.get(folder.parent_id!);
        if (parent && parent.children) {
          parent.children.push(node);
        } else {
          // 如果找不到父节点，将其作为根节点处理
          console.log('Debug: 找不到父节点，作为根节点处理:', folder.name);
          rootNodes.push(node);
        }
      }
    }
  });
  
  // 递归计算每个节点的总题目数量（包含子文件夹）
  const updateTotalQuestionCount = (node: TreeNode) => {
    if (node.children && node.children.length > 0) {
      // 先递归处理子节点
      node.children.forEach(updateTotalQuestionCount);
      // 然后计算当前节点的总数（自身 + 所有子文件夹）
      node.totalQuestionCount = calculateTotalQuestionCount(node);
    } else {
      // 叶子节点，总数就是自身的题目数
      node.totalQuestionCount = node.questionCount || 0;
    }
  };
  
  // 更新所有节点的总题目数量
  rootNodes.forEach(updateTotalQuestionCount);
  
  return rootNodes;
};

// 加载数据库数据
const loadData = async () => {
  try {
    loading.value = true;
    await databaseService.connect();
    
    const [folders, folderStats] = await Promise.all([
      databaseService.getFolders(),
      databaseService.getFolderStats()
    ]);
    
    console.log('Debug: 获取到的文件夹数据:', folders);
    console.log('Debug: 获取到的统计数据:', folderStats);
    
    const newTreeData = buildFolderTree(folders, folderStats);
    console.log('文件夹数据加载成功:', newTreeData);
    
    // 使用 nextTick 确保响应式更新正确执行
    await nextTick();
    treeData.value = newTreeData;
  } catch (error) {
    console.error('加载数据失败:', error);
    // 如果数据库连接失败，显示错误信息
    await nextTick();
    treeData.value = [{
      id: 'error',
      name: '数据库连接失败',
      type: 'folder',
      children: []
    }];
  } finally {
    loading.value = false;
  }
};

const emit = defineEmits<{
  'folder-select': [folderId: number, folderName: string];
  select: [id: string];
  'context-menu': [{ node: TreeNode; x: number; y: number }];
  'expand-folder': [id: string]
}>();

// 查找节点的辅助函数
const findNodeById = (targetId: string): TreeNode | null => {
  const findInNodes = (nodes: TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return node;
      }
      if (node.children) {
        const found = findInNodes(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return findInNodes(treeData.value);
};

const handleSelect = (id: string) => {
  try {
    selectedId.value = id;
    emit('select', id);
    
    // 如果选中的是文件夹，触发文件夹选择事件
    const node = findNodeById(id);
    if (node && node.type === 'folder') {
      console.log('FileTree: 选择文件夹', { id, name: node.name, parsedId: parseInt(id) });
      // 使用 nextTick 确保组件更新完成后再触发事件
      nextTick(() => {
        emit('folder-select', parseInt(id), node.name);
      });
    }
  } catch (error) {
    console.error('FileTree handleSelect error:', error);
  }
};

const handleContextMenu = (data: { node: TreeNode; x: number; y: number }) => {
  contextMenu.node = data.node;
  contextMenu.x = data.x;
  contextMenu.y = data.y;
  contextMenu.visible = true;
};

const handleExpandFolder = (id: string) => {
  // 切换展开状态
  if (expandedFolders.value.has(id)) {
    expandedFolders.value.delete(id);
  } else {
    expandedFolders.value.add(id);
  }
  emit('expand-folder', id);
};

const handleMoveFolder = async (data: { sourceId: string; targetId: string; position: 'before' | 'after' | 'inside' }) => {
  try {
    console.log('FileTree: 处理文件夹移动', data);
    
    const sourceIdNum = parseInt(data.sourceId);
    const targetIdNum = parseInt(data.targetId);
    
    console.log('FileTree: 移动参数', { sourceIdNum, targetIdNum, position: data.position });
    
    // 保存当前展开状态
    const currentExpandedState = new Set(expandedFolders.value);
    
    // 调用数据库服务移动文件夹，传递正确的参数
    await databaseService.moveFolder(sourceIdNum, targetIdNum, data.position);
    
    // 重新加载数据以更新UI
    await loadData();
    
    // 恢复展开状态
    expandedFolders.value = currentExpandedState;
    
    console.log('FileTree: 文件夹移动成功');
  } catch (error) {
    console.error('FileTree: 移动文件夹失败', error);
    // 这里可以添加用户友好的错误提示
  }
};



const hideContextMenu = () => {
  contextMenu.visible = false;
  contextMenu.node = null;
};

// 处理空白处右键菜单
const handleTreeContentRightClick = (event: MouseEvent) => {
  // 检查点击的目标是否是tree-content本身（空白处）
  const target = event.target as Element;
  if (target.classList.contains('tree-content') || target.classList.contains('empty') || target.classList.contains('loading')) {
    event.preventDefault();
    event.stopPropagation();
    
    // 显示只有"新建文件夹"的右键菜单
    // 使用根文件夹作为父节点（ID为'0'）
    contextMenu.node = {
      id: '0',
      name: '根目录',
      type: 'folder'
    };
    contextMenu.x = event.clientX;
    contextMenu.y = event.clientY;
    contextMenu.visible = true;
  }
};

// 开始重命名
const startRename = () => {
  if (contextMenu.node) {
    renamingNodeId.value = contextMenu.node.id;
    renameInputValue.value = contextMenu.node.name;
  }
  hideContextMenu();
};

// 取消重命名
const cancelRename = () => {
  renamingNodeId.value = null;
  renameInputValue.value = '';
};



// 创建新文件夹
const createNewFolder = async () => {
  if (!contextMenu.node) return;
  
  try {
    let parentId: number;
    
    // 如果是空白区域右键（根目录），使用0作为父ID
    if (contextMenu.node.name === '根目录') {
      parentId = 0;
    } else {
      parentId = parseInt(contextMenu.node.id);
      // 展开父文件夹（在创建前展开，避免闪烁）
      expandedFolders.value.add(contextMenu.node.id);
    }
    
    const newFolderName = '新建文件夹';
    
    // 保存当前展开状态
    const currentExpandedState = new Set(expandedFolders.value);
    
    // 调用数据库服务创建新文件夹
    const newFolderId = await databaseService.createFolder(newFolderName, parentId);
    
    // 重新加载数据以确保UI与数据库状态同步
    // 这样可以正确显示可能创建的"[未分类]"文件夹
    await loadData();
    
    // 恢复展开状态
    expandedFolders.value = currentExpandedState;
    
    // 自动开始重命名新文件夹
    await nextTick();
    renamingNodeId.value = newFolderId.toString();
    renameInputValue.value = newFolderName;
    
    console.log('新文件夹创建成功');
  } catch (error) {
    console.error('创建新文件夹失败:', error);
    // 如果创建失败，重新加载数据以保持一致性
    await loadData();
  }
  
  hideContextMenu();
};

// 右键菜单事件处理
const handleNewFolder = () => {
  createNewFolder();
};

const handleRename = () => {
  startRename();
};

const handleDelete = () => {
  if (!contextMenu.node) return;
  
  // 检查是否为默认文件夹（ID为0），如果是则不允许删除
  if (contextMenu.node.id === '0') {
    alert('默认文件夹不能被删除');
    hideContextMenu();
    return;
  }
  
  // 查找节点信息以确定是否有父节点
  const findNodeInfo = (nodes: TreeNode[], targetId: string): { node: TreeNode | null, hasParent: boolean } => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return { node, hasParent: false }; // 根节点
      }
      if (node.children) {
        for (const child of node.children) {
          if (child.id === targetId) {
            return { node: child, hasParent: true }; // 有父节点
          }
        }
        const result = findNodeInfo(node.children, targetId);
        if (result.node) {
          return { node: result.node, hasParent: true }; // 子节点都有父节点
        }
      }
    }
    return { node: null, hasParent: false };
  };
  
  const { hasParent } = findNodeInfo(treeData.value, contextMenu.node.id);
  
  // 设置删除弹窗状态
  deleteDialog.visible = true;
  deleteDialog.folderName = contextMenu.node.name;
  deleteDialog.folderId = parseInt(contextMenu.node.id);
  deleteDialog.hasParent = hasParent;
  deleteDialog.deleteQuestions = false; // 默认不删除题目
  
  hideContextMenu();
};

// 删除确认弹窗事件处理
const handleDeleteConfirm = async () => {
  if (!deleteDialog.folderId) return;
  
  try {
    // 调用数据库服务删除文件夹
    await databaseService.deleteFolder(deleteDialog.folderId, deleteDialog.deleteQuestions);
    
    // 重新加载数据
    await loadData();
    
    console.log('文件夹删除成功');
  } catch (error) {
    console.error('删除文件夹失败:', error);
    // 显示错误提示
    alert(error.message || '删除文件夹失败，请重试');
  }
  
  // 关闭弹窗
  deleteDialog.visible = false;
};

const handleDeleteCancel = () => {
  deleteDialog.visible = false;
};

// 点击其他地方隐藏右键菜单
const handleGlobalClick = () => {
  hideContextMenu();
};

onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  loadData();
});

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
});

// 暴露给父组件的方法
const refreshData = () => {
  loadData();
};

// 拖拽事件处理
const handleDragStart = (nodeId: string) => {
  console.log('FileTree: 拖拽开始', { nodeId });
  console.log('FileTree: 设置前 draggedNodeId.value =', draggedNodeId.value);
  draggedNodeId.value = nodeId;
  console.log('FileTree: 设置后 draggedNodeId.value =', draggedNodeId.value);
  
  // 强制触发响应式更新
  nextTick(() => {
    console.log('FileTree: nextTick 后 draggedNodeId.value =', draggedNodeId.value);
  });
};

const handleDragEnd = () => {
  console.log('FileTree: 拖拽结束', { draggedNodeId: draggedNodeId.value });
  // 延迟清理，确保其他事件能正确读取
  setTimeout(() => {
    draggedNodeId.value = null;
    console.log('FileTree: 拖拽状态已清理');
  }, 100);
};

// 处理重命名保存
const handleRenameSave = async (nodeId: string, newName: string) => {
  try {
    console.log('保存重命名:', { nodeId, newName });
    
    // 调用数据库服务重命名文件夹
    await databaseService.renameFolder(parseInt(nodeId), newName);
    
    // 直接更新树数据中的节点名称，避免重新加载
    const updateNodeName = (nodes: TreeNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          node.name = newName;
          return true;
        }
        if (node.children && updateNodeName(node.children)) {
          return true;
        }
      }
      return false;
    };
    
    updateNodeName(treeData.value);
    
    console.log('文件夹重命名成功');
  } catch (error) {
    console.error('重命名文件夹失败:', error);
    // 如果重命名失败，重新加载数据以保持一致性
    await loadData();
  }
  
  cancelRename();
};

// 使用 defineExpose 暴露方法给父组件
defineExpose({
  refreshData
});
</script>

<style scoped>
.file-tree {
  height: 100%;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tree-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
}

.tree-header h3 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
}

.tree-content {
  margin-left: 8px;
  margin-right: 8px;
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
</style>