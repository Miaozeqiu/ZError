<template>
  <div class="question-list">
    <div class="list-header">
      <div class="header-content">
        <div class="breadcrumb-container">
          <div class="breadcrumb-path" v-if="folderPath.length > 0">
            <span 
              v-for="(item, index) in folderPath" 
              :key="item.id"
              class="breadcrumb-item"
            >
              <span class="breadcrumb-name">{{ item.name }}</span>
              <span v-if="index < folderPath.length - 1" class="breadcrumb-separator">></span>
            </span>
          </div>
          <h3 v-else>题目列表</h3>
        </div>
        <div class="header-right">
          <div class="question-count-info">
            共 {{ totalQuestions }} 道题目
          </div>
          <!-- 分页控制器 -->
          <div class="pagination-container" v-if="totalQuestions > 0">
            <div class="pagination">
              <button 
                class="pagination-btn prev-btn" 
                :disabled="currentPage <= 1"
                @click="goToPreviousPage"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
              </button>
              
              <span class="page-info">
                {{ currentPage }} / {{ Math.max(totalPages, 1) }}
              </span>
              
              <button 
                class="pagination-btn next-btn" 
                :disabled="currentPage >= totalPages"
                @click="goToNextPage"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9,6 15,12 9,18"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 搜索框 -->
      <div class="search-container">
        <div class="search-box">
          <input 
            type="text" 
            v-model="searchTerm"
            @input="handleSearch"
            @keyup.enter="performSearch"
            placeholder="搜索题目标题..."
            class="search-input"
          />
          <button 
            v-if="searchTerm" 
            @click="clearSearch" 
            class="clear-button"
          >
            ✕
          </button>
          <button 
            @click="showAddQuestionDialog" 
            class="add-question-button"
            title="添加题目"
          >
            <svg t="1760673866502" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7075" width="16" height="16">
              <path d="M188.8 135.7c-29.7 0-53.8 24.1-53.8 53.7v644.7c0 29.7 24.1 53.7 53.8 53.7h645.4c29.7 0 53.8-24.1 53.8-53.7V189.4c0-29.7-24.1-53.7-53.8-53.7H188.8z m-13-71.1h671.5c61.8 0 111.9 50.1 111.9 111.8v670.8c0 61.7-50.1 111.8-111.9 111.8H175.8C114 959 63.9 909 63.9 847.2V176.4c0-61.8 50.1-111.8 111.9-111.8z m0 0" p-id="7076" fill="currentColor"></path>
              <path d="M673 548H351c-19.8 0-36-16.2-36-36s16.2-36 36-36h322c19.8 0 36 16.2 36 36s-16.2 36-36 36z" p-id="7077" fill="currentColor"></path>
              <path d="M476 673V351c0-19.8 16.2-36 36-36s36 16.2 36 36v322c0 19.8-16.2 36-36 36s-36-16.2-36-36z" p-id="7078" fill="currentColor"></path>
            </svg>
            添加题目
          </button>
        </div>
        <div v-if="isSearchMode" class="search-info">
          搜索结果：{{ questions.length }} 条
        </div>
      </div>
    </div>
    
    <div class="list-content" v-if="!loading" @contextmenu.prevent="handleListRightClick">
      <div v-if="questions.length === 0" class="empty-state" @contextmenu.prevent="handleListRightClick">
        <div class="empty-icon">📝</div>
        <div class="empty-text">暂无题目</div>
        <div class="empty-subtext">选择一个文件夹查看题目</div>
      </div>
      
      <div v-else class="question-table-container" @contextmenu.prevent="handleListRightClick">
        <table class="question-table">
          <thead>
            <tr>
              <th class="col-checkbox">
                <input 
                  type="checkbox" 
                  :checked="isAllSelected"
                  :indeterminate="isIndeterminate"
                  @change="handleSelectAll"
                  class="select-all-checkbox"
                />
              </th>
              <th class="col-question">题目内容</th>
              <th class="col-answer">答案</th>
              <th class="col-type">类型</th>
              <th class="col-time">创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr 
              v-for="question in questions" 
              :key="question.id"
              class="question-row"
              :class="{ active: selectedQuestionId === question.id, selected: selectedQuestions.has(question.id) }"
              @click="handleQuestionClick(question)"
              @contextmenu.prevent.stop="handleRightClick($event, question)"
            >
              <td class="col-checkbox" @click.stop>
                <input 
                  type="checkbox" 
                  :checked="selectedQuestions.has(question.id)"
                  @change="handleQuestionSelect(question.id, $event)"
                  class="question-checkbox"
                />
              </td>
              <td class="col-question">
                <span v-if="isSearchMode && searchTerm" v-html="highlightSearchTerm(question.question)"></span>
                <span v-else>{{ question.question }}</span>
              </td>
              <td class="col-answer">
                <span v-if="isSearchMode && searchTerm" v-html="highlightSearchTerm(question.answer || '')"></span>
                <span v-else>{{ question.answer || '暂无答案' }}</span>
              </td>
              <td class="col-type">
                <span v-if="question.question_type" class="type-tag">{{ question.question_type }}</span>
                <span v-else class="no-type">-</span>
              </td>
              <td class="col-time">{{ formatTime(question.create_time) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <div v-else class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>

    <!-- 题目详情显示区域 -->
    <div v-if="selectedQuestionDetails" 
         class="question-detail-overlay" 
         :class="{ show: showDetailOverlay }"
         :style="{ width: overlayWidth + 'px' }">
      <!-- 拖拽条 -->
      <div class="resizer" 
           :class="{ active: isResizing }"
           @mousedown="startResize"
           @mouseover="showResizeCursor"
           @mouseleave="hideResizeCursor">
      </div>
      <div class="detail-header">
        <button class="back-btn" @click="closeDetail">
          <svg t="1760584170728" class="icon" viewBox="0 0 1536 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="13220" width="20" height="20"><path d="M981.418667 71.893333A60.245333 60.245333 0 0 1 1070.506667 152.746667l-3.925334 4.309333L711.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z" fill="#838B9F" opacity=".25" p-id="13221"></path><path d="M469.418667 71.893333A60.245333 60.245333 0 0 1 558.506667 152.746667l-3.925334 4.309333L199.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z" fill="#838B9F" p-id="13222"></path></svg>
        </button>
        <h4>题目详情</h4>
        <button class="edit-btn" @click="toggleEditMode" :title="isEditMode ? '取消编辑' : '编辑题目'">
          <svg v-if="!isEditMode" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="detail-content">
        <!-- 查看模式 -->
        <div v-if="!isEditMode">
          <div class="detail-item">
            <label>题目ID:</label>
            <span>{{ selectedQuestionDetails?.id }}</span>
          </div>
          <div class="detail-item">
            <label>题目内容:</label>
            <div class="question-content">{{ selectedQuestionDetails?.question }}</div>
          </div>
          <div class="detail-item">
            <label>答案:</label>
            <div class="answer-content">{{ selectedQuestionDetails?.answer }}</div>
          </div>
          <div class="detail-item">
            <label>题目类型:</label>
            <span class="type-tag">{{ selectedQuestionDetails?.question_type || '未分类' }}</span>
          </div>
          <div class="detail-item">
            <label>所属文件夹:</label>
            <span>{{ selectedQuestionDetails?.folder_name || '未分类' }}</span>
          </div>
          <div class="detail-item">
            <label>创建时间:</label>
            <span>{{ formatTime(selectedQuestionDetails?.create_time) }}</span>
          </div>
        </div>
        
        <!-- 编辑模式 -->
        <div v-else class="edit-form">
          <div class="form-group">
            <label>题目内容:</label>
            <textarea 
              v-model="editFormData.question" 
              class="edit-textarea"
              rows="4"
              placeholder="请输入题目内容..."
            ></textarea>
          </div>
          <div class="form-group">
            <label>答案:</label>
            <textarea 
              v-model="editFormData.answer" 
              class="edit-textarea"
              rows="6"
              placeholder="请输入答案..."
            ></textarea>
          </div>
          <div class="form-group">
            <label>题目类型:</label>
            <input 
              v-model="editFormData.question_type" 
              class="edit-input"
              placeholder="请输入题目类型..."
            />
          </div>
          <div class="edit-actions">
            <button @click="cancelEdit" class="cancel-btn">取消</button>
            <button @click="saveEdit" class="save-btn" :disabled="!isEditFormValid">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- 题目右键菜单 -->
  <QuestionContextMenu
    v-if="contextMenu.visible"
    :visible="contextMenu.visible"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :can-paste="canPaste"
    :has-selected-question="selectedQuestion !== null"
    :is-batch-mode="contextMenu.isBatchMode"
    :selected-count="selectedQuestions.size"
    @copy-question="copyQuestionToClipboard"
    @copy-answer="copyAnswerToClipboard"
    @copy="copyQuestion"
    @cut="cutQuestion"
    @paste="pasteQuestion"
    @batch-copy="batchCopyQuestions"
    @batch-cut="batchCutQuestions"
    @delete="deleteQuestion"
    @batch-delete="batchDeleteQuestions"
  />
  
  <!-- 题目编辑器 -->
  <QuestionEditor
    :visible="showAddQuestionModal"
    :selected-folder-id="selectedFolderId"
    @close="hideAddQuestionDialog"
    @submit="handleQuestionSubmit"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { databaseService, type AIResponse } from '../services/database';
import QuestionContextMenu from './QuestionContextMenu.vue';
import QuestionEditor from './QuestionEditor.vue';

interface Props {
  selectedFolderId?: string | null;
  collapseTrigger?: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'question-select': [question: AIResponse],
  'question-pasted': [],
  'question-added': []
}>();

const questions = ref<AIResponse[]>([]);
const loading = ref(false);
const selectedQuestionId = ref<number | null>(null);
const selectedQuestionDetails = ref<AIResponse | null>(null);
const showDetailOverlay = ref(false);
const folderPath = ref<{id: number, name: string}[]>([]);

// 在切换顶层 tab 时，收起题目详情面板
watch(() => props.collapseTrigger, () => {
  if (showDetailOverlay.value) {
    closeDetail();
  }
});

// 分页相关状态
const currentPage = ref(1);
const pageSize = ref(20); // 每页显示20条题目
const allQuestions = ref<AIResponse[]>([]); // 存储所有题目数据

// 搜索相关状态
const searchTerm = ref('');
const isSearchMode = ref(false);
const searchDebounceTimer = ref<number | null>(null);
const originalQuestions = ref<AIResponse[]>([]); // 保存原始题目列表

// 拖拽相关状态
const isResizing = ref(false);
const overlayWidth = ref(400); // 默认宽度400px
const startX = ref(0);
const startWidth = ref(0);

// 批量选择相关状态
const selectedQuestions = ref<Set<number>>(new Set());
const isAllSelected = ref(false);
const isIndeterminate = ref(false);

// 右键菜单相关状态
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  isBatchMode: false
});
const selectedQuestion = ref<AIResponse | null>(null);

// 编辑模式相关状态
const isEditMode = ref(false);
const editFormData = ref({
  question: '',
  answer: '',
  question_type: ''
});

// 计算属性
const isEditFormValid = computed(() => {
  return editFormData.value.question.trim() !== '' && editFormData.value.answer.trim() !== '';
});

// 剪贴板相关状态
const clipboard = ref<{
  question?: AIResponse | null;
  questions?: AIResponse[];
  operation: 'copy' | 'cut' | null;
}>({
  question: null,
  questions: [],
  operation: null
});

// 添加题目对话框相关状态
const showAddQuestionModal = ref(false);

const canPaste = computed(() => {
  return !!(clipboard.value.question !== null || (clipboard.value.questions && clipboard.value.questions.length > 0));
});

// 分页相关计算属性
const totalQuestions = computed(() => allQuestions.value.length);
const totalPages = computed(() => Math.ceil(totalQuestions.value / pageSize.value));

// 当前页显示的题目
const paginatedQuestions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return allQuestions.value.slice(start, end);
});

// 监听分页数据变化，更新显示的题目
watch(paginatedQuestions, (newQuestions) => {
  questions.value = newQuestions;
}, { immediate: true });

// 分页控制方法
const goToPreviousPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--;
  }
};

const goToNextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
  }
};

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
};





const loadQuestions = async (folderId?: string | null) => {
  try {
    loading.value = true;
    
    console.log('QuestionList: loadQuestions 被调用', { folderId, type: typeof folderId });
    
    // 清除搜索状态
    if (isSearchMode.value) {
      searchTerm.value = '';
      isSearchMode.value = false;
      originalQuestions.value = [];
    }
    
    // 重置分页到第一页
    currentPage.value = 1;
    
    if (folderId && folderId !== 'error') {
      const folderIdNum = parseInt(folderId);
      console.log('QuestionList: 解析文件夹ID', { original: folderId, parsed: folderIdNum });
      
      // 获取文件夹路径
      try {
        folderPath.value = await databaseService.getFolderPath(folderIdNum);
        console.log('获取文件夹路径:', folderPath.value);
      } catch (error) {
        console.error('获取文件夹路径失败:', error);
        folderPath.value = [];
      }
      
      // 使用新的方法获取文件夹及其所有子文件夹的题目
      allQuestions.value = await databaseService.getQuestionsFromFolderAndSubfolders(folderIdNum);
    } else {
      console.log('QuestionList: 获取所有题目');
      folderPath.value = [];
      // 如果没有选择文件夹，显示所有题目
      allQuestions.value = await databaseService.getAIResponses();
    }
    
    console.log('题目加载成功:', allQuestions.value.length);
  } catch (error) {
    console.error('加载题目失败:', error);
    allQuestions.value = [];
    folderPath.value = [];
  } finally {
    loading.value = false;
  }
};

// 刷新当前分页数据（不重置页码），并暴露给父组件调用
const refreshData = async () => {
  try {
    loading.value = true;

    // 如果处于搜索模式，重新执行一次搜索以刷新结果
    if (isSearchMode.value && searchTerm.value.trim()) {
      await performSearch();
      return;
    }

    const savedPage = currentPage.value;

    if (props.selectedFolderId && props.selectedFolderId !== 'error') {
      const folderIdNum = parseInt(props.selectedFolderId);
      try {
        folderPath.value = await databaseService.getFolderPath(folderIdNum);
      } catch (error) {
        console.error('获取文件夹路径失败:', error);
        folderPath.value = [];
      }
      allQuestions.value = await databaseService.getQuestionsFromFolderAndSubfolders(folderIdNum);
    } else {
      folderPath.value = [];
      allQuestions.value = await databaseService.getAIResponses();
    }

    // 恢复到刷新前的页码（若超出范围则回退到最后一页）
    const pages = Math.max(1, Math.ceil(allQuestions.value.length / pageSize.value));
    currentPage.value = Math.min(savedPage, pages);
  } catch (error) {
    console.error('刷新题目失败:', error);
  } finally {
    loading.value = false;
  }
};

defineExpose({
  refreshData
});

const handleQuestionClick = (question: AIResponse) => {
  console.log('点击题目，开始动画');
  
  // 如果已经有详情面板显示，直接更新内容，不触发动画
  if (selectedQuestionDetails.value) {
    selectedQuestionId.value = question.id;
    selectedQuestionDetails.value = question;
  } else {
    // 如果没有详情面板，显示面板并触发动画
    selectedQuestionId.value = question.id;
    selectedQuestionDetails.value = question;
    showDetailOverlay.value = false; // 先设置为 false
    // 使用 nextTick 确保 DOM 元素创建后再触发动画
    nextTick(() => {
      console.log('DOM 更新完成，触发动画');
      // 再使用 setTimeout 确保浏览器渲染了初始状态
      setTimeout(() => {
        showDetailOverlay.value = true;
      }, 10);
    });
  }
  
  emit('question-select', question);
};

const closeDetail = () => {
  showDetailOverlay.value = false;
  isEditMode.value = false; // 关闭详情时退出编辑模式
  // 等待动画完成后再清除数据
  setTimeout(() => {
    selectedQuestionId.value = null;
    selectedQuestionDetails.value = null;
  }, 300); // 与 CSS transition 时间一致
};

// 编辑模式相关方法
const toggleEditMode = () => {
  if (!selectedQuestionDetails.value) return;
  
  if (!isEditMode.value) {
    // 进入编辑模式，初始化表单数据
    editFormData.value = {
      question: selectedQuestionDetails.value.question || '',
      answer: selectedQuestionDetails.value.answer || '',
      question_type: selectedQuestionDetails.value.question_type || ''
    };
    isEditMode.value = true;
  } else {
    // 退出编辑模式
    isEditMode.value = false;
  }
};

const cancelEdit = () => {
  isEditMode.value = false;
  // 清空表单数据
  editFormData.value = {
    question: '',
    answer: '',
    question_type: ''
  };
};

const saveEdit = async () => {
  if (!selectedQuestionDetails.value || !isEditFormValid.value) return;
  
  try {
    loading.value = true;
    
    // 更新题目数据
    const updatedQuestion = {
      ...selectedQuestionDetails.value,
      question: editFormData.value.question.trim(),
      answer: editFormData.value.answer.trim(),
      question_type: editFormData.value.question_type.trim()
    };
    
    // 调用数据库服务更新题目
    await databaseService.updateQuestion(updatedQuestion.id, {
      question: updatedQuestion.question,
      answer: updatedQuestion.answer,
      question_type: updatedQuestion.question_type
    });
    
    // 更新本地数据
    selectedQuestionDetails.value = updatedQuestion;
    
    // 更新题目列表中的对应项
    const questionIndex = questions.value.findIndex(q => q.id === updatedQuestion.id);
    if (questionIndex !== -1) {
      questions.value[questionIndex] = updatedQuestion;
    }
    
    // 退出编辑模式
    isEditMode.value = false;
    
    console.log('题目更新成功');
  } catch (error) {
    console.error('更新题目失败:', error);
  } finally {
    loading.value = false;
  }
};

const formatTime = (timeStr?: string): string => {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (error) {
    console.error('时间格式化错误:', error);
    return timeStr;
  }
};

// 批量选择相关方法
const handleQuestionSelect = (questionId: number, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    selectedQuestions.value.add(questionId);
  } else {
    selectedQuestions.value.delete(questionId);
  }
  updateSelectAllState();
};

const handleSelectAll = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    // 全选
    questions.value.forEach(question => {
      selectedQuestions.value.add(question.id);
    });
  } else {
    // 取消全选
    selectedQuestions.value.clear();
  }
  updateSelectAllState();
};

const updateSelectAllState = () => {
  const totalQuestions = questions.value.length;
  const selectedCount = selectedQuestions.value.size;
  
  if (selectedCount === 0) {
    isAllSelected.value = false;
    isIndeterminate.value = false;
  } else if (selectedCount === totalQuestions) {
    isAllSelected.value = true;
    isIndeterminate.value = false;
  } else {
    isAllSelected.value = false;
    isIndeterminate.value = true;
  }
};

// 监听题目列表变化，更新选择状态
watch(questions, () => {
  // 清除不存在的题目选择状态
  const existingIds = new Set(questions.value.map(q => q.id));
  const toRemove: number[] = [];
  selectedQuestions.value.forEach(id => {
    if (!existingIds.has(id)) {
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => selectedQuestions.value.delete(id));
  
  updateSelectAllState();
});

// 拖拽相关方法
const startResize = (e: MouseEvent) => {
  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = overlayWidth.value;
  
  // 添加全局事件监听
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  
  // 添加拖拽时的全局样式
  document.body.classList.add('resizing');
  
  // 防止文本选择
  e.preventDefault();
};

const handleResize = (e: MouseEvent) => {
  if (!isResizing.value) return;
  
  const deltaX = startX.value - e.clientX; // 向左拖拽为正值
  const newWidth = startWidth.value + deltaX;
  
  // 设置最小和最大宽度限制
  const minWidth = 300;
  const maxWidth = window.innerWidth * 0.8;
  
  overlayWidth.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
};

const stopResize = () => {
  isResizing.value = false;
  
  // 移除全局事件监听
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  
  // 移除拖拽时的全局样式
  document.body.classList.remove('resizing');
  document.body.style.cursor = '';
};

const showResizeCursor = () => {
  if (!isResizing.value) {
    document.body.style.cursor = 'ew-resize';
  }
};

const hideResizeCursor = () => {
  if (!isResizing.value) {
    document.body.style.cursor = '';
  }
};

// 监听选中的文件夹变化
watch(() => props.selectedFolderId, (newFolderId) => {
  loadQuestions(newFolderId);
}, { immediate: true });

// 搜索相关方法
const handleSearch = () => {
  // 清除之前的防抖定时器
  if (searchDebounceTimer.value) {
    clearTimeout(searchDebounceTimer.value);
  }
  
  // 设置新的防抖定时器
  searchDebounceTimer.value = setTimeout(() => {
    performSearch();
  }, 300) as unknown as number;
};

const performSearch = async () => {
  if (!searchTerm.value.trim()) {
    clearSearch();
    return;
  }
  
  try {
    loading.value = true;
    isSearchMode.value = true;
    
    // 如果还没有保存原始数据，先保存
    if (originalQuestions.value.length === 0 && questions.value.length > 0) {
      originalQuestions.value = [...questions.value];
    }
    
    // 获取当前选中的文件夹ID
    const currentFolderId = props.selectedFolderId ? parseInt(props.selectedFolderId) : undefined;
    
    // 执行搜索
    questions.value = await databaseService.searchQuestionsByTitle(searchTerm.value.trim(), currentFolderId);
    
    console.log(`搜索"${searchTerm.value}"找到 ${questions.value.length} 条结果`);
  } catch (error) {
    console.error('搜索失败:', error);
  } finally {
    loading.value = false;
  }
};

const clearSearch = () => {
  searchTerm.value = '';
  isSearchMode.value = false;
  
  // 清除防抖定时器
  if (searchDebounceTimer.value) {
    clearTimeout(searchDebounceTimer.value);
    searchDebounceTimer.value = null;
  }
  
  // 恢复原始题目列表
  if (originalQuestions.value.length > 0) {
    questions.value = [...originalQuestions.value];
    originalQuestions.value = [];
  } else {
    // 如果没有原始数据，重新加载
    loadQuestions(props.selectedFolderId);
  }
};

// 高亮搜索关键词
const highlightSearchTerm = (text: string): string => {
  if (!searchTerm.value.trim()) {
    return text;
  }
  
  const term = searchTerm.value.trim();
  const regex = new RegExp(`(${term})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 右键菜单处理函数
const handleRightClick = (event: MouseEvent, question: AIResponse) => {
  event.preventDefault();
  
  // 如果有批量选中的题目，显示批量操作菜单
  if (selectedQuestions.value.size > 0) {
    // 如果右键的题目不在选中列表中，将其添加到选中列表
    if (!selectedQuestions.value.has(question.id)) {
      selectedQuestions.value.add(question.id);
      updateSelectAllState();
    }
    
    // 显示批量操作菜单
    selectedQuestion.value = null; // 清除单个选择
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      isBatchMode: true
    };
  } else {
    // 单个题目右键菜单
    selectedQuestion.value = question;
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      isBatchMode: false
    };
  }
};

// 处理列表空白处的右键菜单
const handleListRightClick = (event: MouseEvent) => {
  event.preventDefault();
  // 在空白处右键时，不选择任何题目
  selectedQuestion.value = null;
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    isBatchMode: false
  };
};

// 复制题目到剪贴板
const copyQuestionToClipboard = async () => {
  if (selectedQuestion.value) {
    try {
      await navigator.clipboard.writeText(selectedQuestion.value.question);
      console.log('题目已复制到剪贴板');
    } catch (error) {
      console.error('复制题目失败:', error);
    }
  }
  hideContextMenu();
};

// 复制答案到剪贴板
const copyAnswerToClipboard = async () => {
  if (selectedQuestion.value) {
    try {
      const answer = selectedQuestion.value.answer || '暂无答案';
      await navigator.clipboard.writeText(answer);
      console.log('答案已复制到剪贴板');
    } catch (error) {
      console.error('复制答案失败:', error);
    }
  }
  hideContextMenu();
};

// 批量复制题目
const batchCopyQuestions = () => {
  if (selectedQuestions.value.size > 0) {
    const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
    clipboard.value = {
      questions: selectedQuestionsList,
      operation: 'copy'
    };
    console.log(`已复制 ${selectedQuestionsList.length} 个题目，可以粘贴到其他文件夹`);
  }
  hideContextMenu();
};

// 批量剪切题目
const batchCutQuestions = () => {
  if (selectedQuestions.value.size > 0) {
    const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
    clipboard.value = {
      questions: selectedQuestionsList,
      operation: 'cut'
    };
    console.log(`已剪切 ${selectedQuestionsList.length} 个题目，可以移动到其他文件夹`);
  }
  hideContextMenu();
};

// 删除单个题目
const deleteQuestion = async () => {
  if (!selectedQuestion.value) {
    hideContextMenu();
    return;
  }

  try {
    await databaseService.deleteQuestion(selectedQuestion.value.id);
    console.log('题目删除成功');
    // 重新加载题目列表
    await loadQuestions();
  } catch (error) {
    console.error('删除题目失败:', error);
    alert('删除题目失败: ' + (error as Error).message);
  }
  hideContextMenu();
};

// 批量删除题目
const batchDeleteQuestions = async () => {
  if (selectedQuestions.value.size === 0) {
    hideContextMenu();
    return;
  }

  const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
  const questionIds = selectedQuestionsList.map(q => q.id);

  if (confirm(`确定要删除选中的 ${questionIds.length} 个题目吗？此操作不可撤销。`)) {
    try {
      await databaseService.deleteQuestions(questionIds);
      console.log(`成功删除 ${questionIds.length} 个题目`);
      // 清空选中状态
      selectedQuestions.value.clear();
      // 重新加载题目列表
      await loadQuestions();
    } catch (error) {
      console.error('批量删除题目失败:', error);
      alert('批量删除题目失败: ' + (error as Error).message);
    }
  }
  hideContextMenu();
};

// 复制题目（用于粘贴到其他文件夹）
const copyQuestion = () => {
  if (selectedQuestion.value) {
    clipboard.value = {
      question: selectedQuestion.value,
      operation: 'copy'
    };
    console.log('题目已复制，可以粘贴到其他文件夹');
  }
  hideContextMenu();
};

// 剪切题目（用于移动到其他文件夹）
const cutQuestion = () => {
  if (selectedQuestion.value) {
    clipboard.value = {
      question: selectedQuestion.value,
      operation: 'cut'
    };
    console.log('题目已剪切，可以移动到其他文件夹');
  }
  hideContextMenu();
};

// 粘贴题目到当前文件夹
const pasteQuestion = async () => {
  if ((!clipboard.value.question && (!clipboard.value.questions || clipboard.value.questions.length === 0)) || !props.selectedFolderId) {
    hideContextMenu();
    return;
  }

  try {
    const targetFolderId = parseInt(props.selectedFolderId);
    
    // 处理批量粘贴
    if (clipboard.value.questions && clipboard.value.questions.length > 0) {
      if (clipboard.value.operation === 'copy') {
        // 批量复制操作
        for (const question of clipboard.value.questions) {
          await databaseService.copyQuestionToFolder(question.id, targetFolderId);
        }
        console.log(`已复制 ${clipboard.value.questions.length} 个题目到当前文件夹`);
      } else if (clipboard.value.operation === 'cut') {
        // 批量剪切操作
        for (const question of clipboard.value.questions) {
          await databaseService.moveQuestionToFolder(question.id, targetFolderId);
        }
        console.log(`已移动 ${clipboard.value.questions.length} 个题目到当前文件夹`);
        // 剪切后清空剪贴板
        clipboard.value = { question: null, questions: [], operation: null };
      }
    } 
    // 处理单个粘贴
    else if (clipboard.value.question) {
      if (clipboard.value.operation === 'copy') {
        // 复制操作：创建新题目
        await databaseService.copyQuestionToFolder(clipboard.value.question.id, targetFolderId);
        console.log('题目已复制到当前文件夹');
      } else if (clipboard.value.operation === 'cut') {
        // 剪切操作：移动题目
        await databaseService.moveQuestionToFolder(clipboard.value.question.id, targetFolderId);
        console.log('题目已移动到当前文件夹');
        // 剪切后清空剪贴板
        clipboard.value = { question: null, questions: [], operation: null };
      }
    }
    
    // 清除选中状态
    selectedQuestions.value.clear();
    updateSelectAllState();
    
    // 使用nextTick确保DOM更新完成后再刷新
    await nextTick();
    await loadQuestions(props.selectedFolderId);
    
    // 发射事件通知父组件刷新文件夹数据
    emit('question-pasted');
  } catch (error) {
    console.error('粘贴题目失败:', error);
  }
  
  hideContextMenu();
};

// 隐藏右键菜单
const hideContextMenu = () => {
  contextMenu.value.visible = false;
  selectedQuestion.value = null;
};

// 点击其他地方隐藏右键菜单
const handleClickOutside = (event: MouseEvent) => {
  if (contextMenu.value.visible) {
    // 检查点击的元素是否在右键菜单内
    const target = event.target as Element;
    const menuElement = document.querySelector('.context-menu');
    if (menuElement && menuElement.contains(target)) {
      return; // 如果点击在菜单内，不隐藏菜单
    }
    hideContextMenu();
  }
};

// 显示添加题目对话框
const showAddQuestionDialog = () => {
  showAddQuestionModal.value = true;
};

// 隐藏添加题目对话框
const hideAddQuestionDialog = () => {
  showAddQuestionModal.value = false;
};

// 处理题目提交
const handleQuestionSubmit = async (questionData: any) => {
  try {
    console.log('提交题目数据:', questionData);
    
    // 调用数据库服务保存题目
    await databaseService.addQuestion(questionData);
    
    // 关闭对话框
    hideAddQuestionDialog();
    
    // 重新加载题目列表
    await loadQuestions(props.selectedFolderId);
    
    // 发出事件通知父组件刷新文件夹统计
    emit('question-added');
    
    console.log('题目添加成功');
  } catch (error) {
    console.error('添加题目失败:', error);
  }
};

// 生命周期钩子
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.question-list {
  height: 100%;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* border-left: 1px solid #e5e5e5; */
}

.list-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 分页控制器样式 */
.pagination-container {
  display: flex;
  align-items: center;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px;
}

.pagination-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 2px;
}

.pagination-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.pagination-btn:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
  opacity: 0.5;
}

.page-info {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  min-width: 40px;
  text-align: center;
  padding: 0 4px;
}

.breadcrumb-container {
  flex: 1;
}

.breadcrumb-container h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.list-header h3 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.breadcrumb-path {
  font-size: 14px;
  font-weight: 600;
  color: #333333;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
}

.breadcrumb-name {
  color: var(--text-primary);
  font-weight: 600;
}

.breadcrumb-separator {
  margin: 0 8px;
  color: #666666;
  font-weight: normal;
}

.question-count-info {
  font-size: 12px;
  color: #666666;
  white-space: nowrap;
  margin-left: 16px;
}

/* 搜索框样式 */
.search-container {
  margin-top: 12px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  background-color: var(--bg-primary);
  transition: border-color 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--border-color);
  box-shadow: 0 0 0 3px var(--shadow-input);
}

.search-input::placeholder {
  color: var(--question-detail-search-placeholder);
}

.clear-button {
  padding: 6px 8px;
  background-color: var(--question-detail-clear-btn-bg);
  color: var(--question-detail-clear-btn-text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.2s ease;
  min-width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-button:hover {
  background-color: var(--question-detail-clear-btn-hover-bg);
  color: var(--question-detail-clear-btn-hover-text);
}

.add-question-button {
  padding: 8px 12px;
  background-color: var(--question-detail-add-btn-bg);
  color: var(--question-detail-add-btn-text);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}

.add-question-button svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.add-question-button:hover {
  background-color: var(--question-detail-add-btn-hover-bg);
}

.search-info {
  margin-top: 8px;
  font-size: 12px;
  color: var(--question-detail-search-info-text);
  font-style: italic;
}

/* 搜索高亮样式 */
.search-highlight {
  background-color: var(--question-detail-search-highlight-bg);
  color: var(--question-detail-search-highlight-text);
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: #666666;
  margin-bottom: 8px;
}

.empty-subtext {
  font-size: 14px;
  color: #999999;
}

.question-table-container {
  width: 100%;
  overflow-x: auto;
}

.question-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  position: relative;
  table-layout: fixed;
}

.question-table thead {
  background-color: var(--bg-secondary);
  border-bottom: 2px solid var(--border-primary);
}

.question-table th {
  padding: 12px 8px;
  text-align: left;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-primary);
  white-space: nowrap;
  position: relative;
}

/* 表头复选框列居中 */
.question-table th.col-checkbox {
  text-align: center;
  vertical-align: middle;
}

/* 表头的树形分割线 */
.question-table th:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--table-header-divider);
}

.question-table tbody tr {
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background-color 0.2s ease;
  position: relative;
}

.question-table tbody tr:hover {
  background-color: var(--hover-bg);
}

.question-table tbody tr.active {
  background-color: var(--active-bg);
  border-color: var(--active-border);
}

.question-table tbody tr.selected {
  background-color: var(--selected-bg);
}

.question-table td {
  padding: 12px 8px;
  vertical-align: middle;
  border-bottom: 1px solid var(--border-primary);
  position: relative;
}

/* 表格数据行的树形分割线 */
.question-table tbody tr td:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--table-divider);
  opacity: 0.6;
}

/* 悬停时的分割线效果 */
.question-table tbody tr:hover td:not(:last-child)::after {
  background: var(--table-divider-hover);
  opacity: 0.8;
}

/* 选中行的分割线效果 */
.question-table tbody tr.active td:not(:last-child)::after {
  background: var(--table-divider-active);
  opacity: 1;
}

/* 多选行的分割线效果 */
.question-table tbody tr.selected td:not(:last-child)::after {
  background: var(--table-divider-selected);
  opacity: 0.9;
}

.col-id {
  width: 80px;
  font-weight: 600;
  color: #007acc;
}

.col-question {
  min-width: 200px;
  max-width: 250px;
  word-break: break-word;
  line-height: 1.4;
}

.col-question span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.col-answer {
  min-width: 250px;
  max-width: 400px;
}

.col-answer span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.col-type {
  width: 100px;
}

.col-type span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.col-time {
  width: 140px;
  font-size: 12px;
  color: #666666;
}

.type-tag {
  padding: 2px 6px;
  background-color: #007acc;
  color: #ffffff;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}

.no-type {
  color: #999999;
  font-style: italic;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e5e5;
  border-top: 3px solid #007acc;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 14px;
  color: #666666;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 题目详情覆盖层样式 */
.question-detail-overlay {
  position: fixed; /* 改为 fixed 定位，脱离父容器 */
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh; /* 使用视口高度 */
  background-color: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  z-index: 1000; /* 提高 z-index */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 初始状态：完全隐藏在右侧 */
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 显示状态：滑入到正常位置 */
.question-detail-overlay.show {
  transform: translateX(0);
}

/* 拖拽条样式 */
.resizer {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background-color: transparent;
  cursor: ew-resize;
  z-index: 1001;
  transition: background-color 0.2s ease;
}

.resizer:hover {
  background-color: transparent;
}

.resizer.active {
  background-color: transparent;
}

/* 拖拽时的全局样式 */
body.resizing {
  cursor: ew-resize !important;
  user-select: none;
}

.detail-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--request-details-border);
  background-color: var(--bg-primary);
  gap: 12px;
}

.detail-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary); 
  flex: 1;
}

.back-btn, .edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn {
  transform: scaleX(-1);
}

.back-btn:hover, .edit-btn:hover {
  background-color: var(--hover-bg);
}

.edit-btn {
  color: var(--question-detail-edit-btn-text);
}

.edit-btn:hover {
  color: var(--question-detail-edit-btn-hover-text);
}

.back-icon {
  width: 16px;
  height: 16px;
  fill: var(--question-detail-back-icon-fill);
  transition: fill 0.2s;
}

.back-btn:hover .back-icon {
  fill: var(--question-detail-back-icon-hover-fill);
}

.detail-content {
  overflow: auto;
  flex: 1;
  padding: 20px;
}

.detail-item {
  margin-bottom: 16px;
}

.detail-item label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-item span {
  font-size: 14px;
  color: var(--text-primary);
}

.question-content {
  overflow-x: auto;
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
  /* border-left: 3px solid #007acc; */
}

.answer-content {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
}

.detail-item .type-tag {
  display: inline-block;
  padding: 4px 8px;
  background-color: var(--question-detail-type-tag-bg);
  color: var(--question-detail-type-tag-text);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

/* 编辑表单样式 */
.edit-form {
  padding: 20px 0;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #666666;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.edit-textarea {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: border-color 0.2s;
  resize: none;
  box-sizing: border-box;
}

.edit-textarea:focus {
  outline: none;
  border-color: rgb(236, 236, 236);
  box-shadow: 0 0 0 2px var(--shadow-input);
}

.edit-input {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.edit-input:focus {
  outline: none;
  border-color: var(--border-color);
  box-shadow: 0 0 0 2px var(--shadow-input);
}

.edit-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-primary);
}

.cancel-btn, .save-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn {
  background-color: var(--question-detail-cancel-btn-bg);
  color: var(--question-detail-cancel-btn-text);
  border: 1px solid var(--question-detail-cancel-btn-border);
}

.cancel-btn:hover {
  background-color: var(--question-detail-cancel-btn-hover-bg);
  color: var(--question-detail-cancel-btn-hover-text);
}

.save-btn {
  background-color: var(--question-detail-save-btn-bg);
  color: var(--question-detail-save-btn-text);
}

.save-btn:hover:not(:disabled) {
  background-color: var(--question-detail-save-btn-hover-bg);
}

.save-btn:disabled {
  background-color: var(--question-detail-save-btn-disabled-bg);
  cursor: not-allowed;
}

/* 复选框列样式 */
.col-checkbox {
  width: 40px;
  min-width: 40px;
  max-width: 40px;
  text-align: center;
  padding: 8px !important;
}

/* 复选框样式 */
.col-checkbox input[type="checkbox"] {
  width: 16px !important;
  height: 16px !important;
  min-width: 16px !important;
  min-height: 16px !important;
  max-width: 16px !important;
  max-height: 16px !important;
  background-color: var(--checkbox-bg);
  border: 1px solid var(--checkbox-border);
  border-radius: 3px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  position: relative;
  transition: all 0.2s ease;
  box-sizing: border-box;
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
  margin: 0;
  padding: 0;
}

.col-checkbox input[type="checkbox"]:hover {
  background-color: var(--checkbox-hover-bg);
  border-color: var(--checkbox-hover-border);
}

.col-checkbox input[type="checkbox"]:checked {
  background-color: var(--checkbox-checked-bg);
  border-color: var(--checkbox-checked-border);
}

.col-checkbox input[type="checkbox"]:checked::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 12px;
  font-weight: bold;
}


</style>