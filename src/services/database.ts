import { invoke } from '@tauri-apps/api/core';
import { initializationService } from './initialization';
import { applyForgettingToNode, clampForgettingStage, effectiveMastery, reviewedAtFromDaysAgo, rolledRetentionForest } from '../utils/studyForgetting';

export interface Folder {
  id: number;
  name: string;
  parent_id?: number | null;
  created_at?: string;
}

export interface AIResponse {
  id: number;
  question: string;
  options?: string;
  answer?: string;
  question_type: string;
  folder_id: number;
  folder_name?: string;
  create_time: string;
  is_ai?: boolean;
  is_pending_correction?: boolean;
  importance?: number;
  mastery?: number;
  difficulty?: number;
}

export interface QuestionMetricBucket {
  importance: number;
  mastery: number;
  difficulty: number;
  count: number;
}

export interface PaginatedAIResponses {
  items: AIResponse[];
  total: number;
}

export interface PracticeRecord {
  id: number;
  question_id: number;
  user_answer: string;
  is_correct: boolean;
  note: string;
  source: string;
  create_time?: string;
}

export interface PracticeSummary {
  question_id: number;
  count: number;
  last_answer: string;
  last_correct: boolean;
  last_note: string;
  last_time?: string;
}

export interface StudySubject {
  id: number
  name: string
  description: string
  create_time?: string
  node_count: number
  progress: number
}

export interface StudyGraphNodeRow {
  id: number
  subject_id: number
  node_key: string
  name: string
  summary: string
  mastery: number
  importance?: number
  parent_id?: number | null
  sort_order: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
}

export interface StudyGraphEdgeRow {
  id: number
  subject_id: number
  from_id: number
  to_id: number
  relation: string
}

export interface StudyGraphPayload {
  subject: StudySubject
  nodes: StudyGraphNodeRow[]
  edges: StudyGraphEdgeRow[]
}

export interface StudyGraphNodeInput {
  key?: string
  name: string
  summary?: string
  parent_key?: string
  mastery?: number
}

export interface StudyGraphNodePatch {
  id: number
  name?: string
  summary?: string
  mastery?: number
  parent_id?: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
}

export interface StudyProgressUpdate {
  id?: number
  name?: string
  forgetting_stage?: number
  last_reviewed_at?: string
  mastery?: number
  days_ago?: number
}

export interface QuestionKnowledgeLink {
  question_id: number
  node_id: number
  node_name: string
  subject_id: number
  subject_name: string
}

export interface StudyActivity {
  id: number
  subject_id: number
  kind: 'learn' | 'review' | 'practice' | string
  names: string[]
  question_count: number
  correct_count: number
  create_time: string
}

export interface SplitSubjectPart {
  name: string
  description?: string
  node_ids: number[]
}

// 检测是否在 Tauri 环境中
const isTauriEnvironment = () => {
  if (typeof window === 'undefined') return false;
  const hasTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
  const hasTauriInternals = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__;
  const isTauriApp = typeof window !== 'undefined' && window.location.protocol === 'tauri:';
  return hasTauri || hasTauriInternals || isTauriApp;
};

// 模拟数据
let mockStudySubjects: StudySubject[] = []
const mockStudyGraphs = new Map<number, { nodes: StudyGraphNodeRow[]; edges: StudyGraphEdgeRow[] }>()
let mockQuestionKnowledge: { question_id: number; node_id: number }[] = []
let mockStudyActivity: StudyActivity[] = []
let mockActivityId = 1

const emitStudyActivityUpdated = (subjectId?: number) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('study-activity-updated', { detail: { subjectId } }))
}

const pushMockActivity = (input: Omit<StudyActivity, 'id'>) => {
  if (input.kind !== 'practice' && !input.names.length) return
  mockStudyActivity.unshift({
    ...input,
    id: mockActivityId++,
  })
}

const refreshMockSubjectProgress = (subjectId: number) => {
  const subject = mockStudySubjects.find((item) => item.id === subjectId)
  const graph = mockStudyGraphs.get(subjectId)
  if (!subject) return
  const nodes = graph?.nodes || []
  subject.node_count = nodes.length
  subject.progress = rolledRetentionForest(nodes)
}

const withForgettingGraph = (payload: StudyGraphPayload): StudyGraphPayload => {
  const nodes = payload.nodes.map((item) => applyForgettingToNode(item))
  const progress = rolledRetentionForest(nodes)
  return {
    ...payload,
    nodes,
    subject: { ...payload.subject, node_count: nodes.length, progress },
  }
}
let mockFolders: Folder[] = [
  { id: 0, name: '默认文件夹', parent_id: null, created_at: '2024-01-01' },
  { id: 1, name: 'JavaScript', parent_id: 0, created_at: '2024-01-01' },
  { id: 2, name: 'Python', parent_id: 0, created_at: '2024-01-02' },
  { id: 3, name: 'Vue.js', parent_id: 0, created_at: '2024-01-03' },
  { id: 4, name: 'React', parent_id: 0, created_at: '2024-01-04' },
];

let mockAIResponses: AIResponse[] = [
  {
    id: 1,
    question: '如何在JavaScript中实现深拷贝？',
    answer: '可以使用JSON.parse(JSON.stringify(obj))进行简单深拷贝，或使用lodash的cloneDeep方法，或手写递归函数处理复杂对象。',
    question_type: '编程问题',
    folder_id: 1,
    folder_name: 'JavaScript',
    create_time: '2024-01-01 10:00:00',
    is_ai: true
  },
  {
    id: 2,
    question: 'Python中的装饰器是什么？',
    answer: '装饰器是Python中的一种设计模式，允许在不修改原函数代码的情况下，为函数添加额外的功能。使用@符号语法糖来应用装饰器。',
    question_type: '概念解释',
    folder_id: 2,
    folder_name: 'Python',
    create_time: '2024-01-02 11:00:00',
    is_ai: true
  },
  {
    id: 3,
    question: 'Vue.js的响应式原理是什么？',
    answer: 'Vue.js使用Object.defineProperty()（Vue2）或Proxy（Vue3）来劫持对象属性的getter和setter，当数据变化时自动触发视图更新。',
    question_type: '原理解释',
    folder_id: 3,
    folder_name: 'Vue.js',
    create_time: '2024-01-03 12:00:00',
    is_ai: true
  },
  {
    id: 4,
    question: 'React Hooks的使用场景？',
    answer: 'React Hooks主要用于函数组件中管理状态和副作用，如useState管理状态，useEffect处理副作用，useContext共享数据等。',
    question_type: '使用指南',
    folder_id: 4,
    folder_name: 'React',
    create_time: '2024-01-04 13:00:00',
    is_ai: true
  },
  {
    id: 5,
    question: 'JavaScript闭包的应用？',
    answer: '闭包常用于数据封装、模块化编程、回调函数、防抖节流等场景。它能让内部函数访问外部函数的变量，即使外部函数已经执行完毕。',
    question_type: '编程问题',
    folder_id: 1,
    folder_name: 'JavaScript',
    create_time: '2024-01-05 14:00:00',
    is_ai: true
  }
];

class DatabaseService {
  private isTauri = false;

  constructor() {
    this.isTauri = isTauriEnvironment();
    console.log('数据库服务初始化，Tauri环境:', this.isTauri);
  }

  // 连接方法现在只是一个占位符，用于保持接口兼容
  async connect(): Promise<void> {
    if (!this.isTauri) {
      console.log('运行在浏览器环境，使用模拟数据');
      return;
    }
    // Tauri 环境下，数据库连接由后端自动管理
    console.log('Tauri环境，数据库由后端管理');
  }

  async ensureConnection(): Promise<void> {
    // 无需操作
  }

  async getFolders(): Promise<Folder[]> {
    if (!this.isTauri) {
      console.log('使用模拟文件夹数据');
      return mockFolders;
    }
    
    try {
      const folders = await invoke<any[]>('get_folders');
      return folders.map(f => ({
        id: f.id,
        name: f.name,
        parent_id: f.parent_id === 0 ? null : f.parent_id,
        created_at: f.create_time
      }));
    } catch (error) {
      console.error('获取文件夹失败:', error);
      return [];
    }
  }

  async getAIResponses(folderId?: number): Promise<AIResponse[]> {
    if (!this.isTauri) {
      console.log('使用模拟AI响应数据');
      if (folderId !== undefined) {
        return mockAIResponses.filter(response => response.folder_id === folderId);
      }
      return mockAIResponses;
    }
    
    try {
      // Rust Command: get_ai_responses(folder_id: Option<i64>)
      const responses = await invoke<any[]>('get_ai_responses', { folderId: folderId });
      return responses;
    } catch (error) {
      console.error('获取AI响应失败:', error);
      return [];
    }
  }

  async getPaginatedQuestions(params: {
    folderId?: number;
    pendingCorrectionOnly?: boolean;
    page: number;
    pageSize: number;
    sortOrder?: 'desc' | 'asc';
    importance?: number | null;
    mastery?: number | null;
    difficulty?: number | null;
  }): Promise<PaginatedAIResponses> {
    const {
      folderId,
      pendingCorrectionOnly = false,
      page,
      pageSize,
      sortOrder = 'desc',
      importance,
      mastery,
      difficulty,
    } = params;

    if (!this.isTauri) {
      let responses = [...mockAIResponses];

      if (pendingCorrectionOnly) {
        responses = responses.filter(response => !!response.is_pending_correction);
      } else if (folderId !== undefined) {
        responses = responses.filter(response => response.folder_id === folderId);
      }
      if (importance != null) {
        responses = responses.filter(response => (response.importance || 0) === importance);
      }
      if (mastery != null) {
        responses = responses.filter(response => (response.mastery || 0) === mastery);
      }
      if (difficulty != null) {
        responses = responses.filter(response => (response.difficulty || 0) === difficulty);
      }

      responses.sort((a, b) => {
        const aTime = new Date(a.create_time || '').getTime();
        const bTime = new Date(b.create_time || '').getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });

      const safePage = Math.max(1, page);
      const safePageSize = Math.max(1, pageSize);
      const start = (safePage - 1) * safePageSize;
      const end = start + safePageSize;

      return {
        items: responses.slice(start, end),
        total: responses.length,
      };
    }

    try {
      return await invoke<PaginatedAIResponses>('get_paginated_questions', {
        folderId: folderId ?? null,
        pendingCorrectionOnly,
        page,
        pageSize,
        sortOrder,
        importance: importance ?? null,
        mastery: mastery ?? null,
        difficulty: difficulty ?? null,
      });
    } catch (error) {
      console.error('分页获取题目失败:', error);
      return { items: [], total: 0 };
    }
  }

  // 获取文件夹及其所有子文件夹的题目
  async getQuestionsFromFolderAndSubfolders(folderId: number): Promise<AIResponse[]> {
    if (!this.isTauri) {
      return mockAIResponses.filter(response => response.folder_id === folderId);
    }
    
    try {
      // Rust Command: get_questions_recursive(folder_id: i64)
      const responses = await invoke<any[]>('get_questions_recursive', { folderId });
      return responses;
    } catch (error) {
      console.error('获取文件夹及子文件夹题目失败:', error);
      return [];
    }
  }

  async getPendingCorrectionQuestions(): Promise<AIResponse[]> {
    if (!this.isTauri) {
      return mockAIResponses.filter(response => !!response.is_pending_correction);
    }

    try {
      const responses = await invoke<any[]>('get_pending_correction_questions');
      return responses;
    } catch (error) {
      console.error('获取待修正题目失败:', error);
      return [];
    }
  }

  async getPendingCorrectionQuestionCount(): Promise<number> {
    if (!this.isTauri) {
      return mockAIResponses.filter(response => !!response.is_pending_correction).length;
    }

    try {
      return await invoke<number>('get_pending_correction_question_count');
    } catch (error) {
      console.error('获取待修正题目数量失败:', error);
      return 0;
    }
  }

  async setQuestionPendingCorrection(questionId: number, pending: boolean): Promise<void> {
    if (!this.isTauri) {
      const question = mockAIResponses.find(q => q.id === questionId);
      if (question) question.is_pending_correction = pending;
      return;
    }

    try {
      await invoke('set_question_pending_correction', { id: questionId, pending });
    } catch (error) {
      console.error('更新待修正状态失败:', error);
      throw error;
    }
  }

  async getFolderQuestionCount(folderId: number): Promise<number> {
    if (!this.isTauri) {
      return mockAIResponses.filter(response => response.folder_id === folderId).length;
    }
    
    try {
      const count = await invoke<number>('get_folder_question_count', { folderId });
      return count;
    } catch (error) {
      console.error('获取文件夹题目数量失败:', error);
      return 0;
    }
  }

  // 根据标题搜索题目（模糊搜索 + 文件夹过滤）
  async searchQuestionsByTitle(searchTerm: string, folderId?: number): Promise<AIResponse[]> {
    if (!this.isTauri) {
      console.log('使用模拟数据进行搜索');
      let filteredResponses = mockAIResponses;
      if (folderId !== undefined) {
        filteredResponses = filteredResponses.filter(response => response.folder_id === folderId);
      }
      return filteredResponses.filter(response => 
        response.question.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    try {
      console.log(`调用 Rust 模糊搜索: keyword=${searchTerm}, folderId=${folderId}`);
      
      // 对查询词进行中文分词
      let segQuery = searchTerm;
      try {
        const segmented = await invoke<string[]>('segment_text', { text: searchTerm });
        if (segmented && segmented.length > 0) {
          console.log('使用后端分词结果:', segmented);
          segQuery = segmented.join(' ');
        }
      } catch (e) {
        console.warn('后端分词失败或未实现，使用原始查询词:', e);
      }

      const results = await invoke<AIResponse[]>('search_questions_fuzzy', { 
        keyword: segQuery, 
        folderId: folderId !== undefined ? folderId : null 
      });
      
      console.log(`搜索"${searchTerm}"找到 ${results.length} 条记录`);
      return results;
    } catch (error) {
      console.error('搜索题目失败:', error);
      return [];
    }
  }

  // 这里的初始化现在由后端负责，前端方法留空或移除
  private async initializeTables(): Promise<void> {
    // Do nothing, handled by backend
  }

  // 获取文件夹路径（面包屑导航）
  async getFolderPath(folderId: number): Promise<{id: number, name: string}[]> {
    if (!this.isTauri) {
      const folder = mockFolders.find(f => f.id === folderId);
      if (!folder) return [];
      const path = [{id: folder.id, name: folder.name}];
      if (folder.parent_id !== null && folder.parent_id !== 0) {
        const parent = mockFolders.find(f => f.id === folder.parent_id);
        if (parent) {
          path.unshift({id: parent.id, name: parent.name});
        }
      }
      return path;
    }
    
    try {
      const path = await invoke<{id: number, name: string}[]>('get_folder_path', { folderId });
      return path;
    } catch (error) {
      console.error('获取文件夹路径失败:', error);
      return [];
    }
  }

  async getFolderStats(): Promise<{folderId: number, folderName: string, questionCount: number}[]> {
    if (!this.isTauri) {
      const stats = mockFolders.map(folder => ({
        folderId: folder.id,
        folderName: folder.name,
        questionCount: mockAIResponses.filter(response => response.folder_id === folder.id).length
      }));
      return stats.sort((a, b) => b.questionCount - a.questionCount);
    }
    
    try {
      // Rust 返回: folder_id, folder_name, question_count (snake_case)
      // 需要映射到 camelCase
      const stats = await invoke<any[]>('get_folder_stats');
      return stats.map(s => ({
        folderId: s.folder_id,
        folderName: s.folder_name,
        questionCount: s.question_count
      }));
    } catch (error) {
      console.error('获取文件夹统计失败:', error);
      return [];
    }
  }

  async getQuestionMetricStats(params: {
    folderId?: number;
    pendingCorrectionOnly?: boolean;
  } = {}): Promise<QuestionMetricBucket[]> {
    const { folderId, pendingCorrectionOnly = false } = params;
    if (!this.isTauri) {
      let responses = [...mockAIResponses];
      if (pendingCorrectionOnly) {
        responses = responses.filter((item) => !!item.is_pending_correction);
      } else if (folderId !== undefined) {
        responses = responses.filter((item) => item.folder_id === folderId);
      }
      const map = new Map<string, QuestionMetricBucket>();
      for (const item of responses) {
        const importance = item.importance || 0;
        const mastery = item.mastery || 0;
        const difficulty = item.difficulty || 0;
        const key = `${importance}-${mastery}-${difficulty}`;
        const current = map.get(key) || { importance, mastery, difficulty, count: 0 };
        current.count += 1;
        map.set(key, current);
      }
      return [...map.values()];
    }
    try {
      return await invoke<QuestionMetricBucket[]>('get_question_metric_stats', {
        folderId: folderId ?? null,
        pendingCorrectionOnly,
      });
    } catch (error) {
      console.error('获取题目指标统计失败:', error);
      return [];
    }
  }

  // 复制题目到指定文件夹
  async copyQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
    if (!this.isTauri) {
      const originalQuestion = mockAIResponses.find(q => q.id === questionId);
      if (!originalQuestion) throw new Error('题目不存在');
      const newQuestion: AIResponse = {
        ...originalQuestion,
        id: Math.max(...mockAIResponses.map(q => q.id)) + 1,
        folder_id: targetFolderId,
        create_time: new Date().toISOString()
      };
      mockAIResponses.push(newQuestion);
      return;
    }
    
    try {
      await invoke('copy_question', { questionId, targetFolderId });
    } catch (error) {
      console.error('复制题目失败:', error);
      throw error;
    }
  }

  // 移动题目到指定文件夹
  async moveQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
    if (!this.isTauri) {
      const question = mockAIResponses.find(q => q.id === questionId);
      if (!question) throw new Error('题目不存在');
      question.folder_id = targetFolderId;
      return;
    }
    
    try {
      await invoke('move_question', { questionId, targetFolderId });
    } catch (error) {
      console.error('移动题目失败:', error);
      throw error;
    }
  }

  // 添加新题目
  async addQuestion(questionData: { content: string; options?: string; answer: string; question_type?: string; folderId: string | number; isAi?: number; importance?: number; mastery?: number; difficulty?: number }): Promise<AIResponse> {
    const folderId = typeof questionData.folderId === 'string' ? parseInt(questionData.folderId) : questionData.folderId;
    
    if (!this.isTauri) {
      const newQuestion: AIResponse = {
        id: Math.max(...mockAIResponses.map(q => q.id)) + 1,
        question: questionData.content,
        options: questionData.options,
        answer: questionData.answer,
        question_type: questionData.question_type || '',
        folder_id: folderId,
        create_time: new Date().toISOString(),
        is_ai: !!questionData.isAi,
        importance: questionData.importance || 0,
        mastery: questionData.mastery || 0,
        difficulty: questionData.difficulty || 0,
      };
      mockAIResponses.push(newQuestion);
      return newQuestion;
    }
    
    try {
      // Rust Command: add_question(content, options, answer, question_type, folder_id, is_ai)
      const newQuestion = await invoke<AIResponse>('add_question', {
        content: questionData.content,
        options: questionData.options || null,
        answer: questionData.answer,
        questionType: questionData.question_type || null,
        folderId: folderId,
        isAi: questionData.isAi === 1,
        importance: questionData.importance ?? 0,
        mastery: questionData.mastery ?? 0,
        difficulty: questionData.difficulty ?? 0,
      });
      return newQuestion;
    } catch (error) {
      console.error('添加题目失败:', error);
      throw error;
    }
  }

  // 更新题目
  async updateQuestion(questionId: number, updateData: { question?: string; options?: string | null; answer?: string; question_type?: string; importance?: number; mastery?: number; difficulty?: number }): Promise<void> {
    if (!this.isTauri) {
      const question = mockAIResponses.find(q => q.id === questionId);
      if (!question) throw new Error('题目不存在');
      if (updateData.question) question.question = updateData.question;
      if (updateData.options) question.options = updateData.options;
      if (updateData.answer) question.answer = updateData.answer;
      if (updateData.question_type) question.question_type = updateData.question_type;
      if (updateData.importance != null) question.importance = updateData.importance;
      if (updateData.mastery != null) question.mastery = updateData.mastery;
      if (updateData.difficulty != null) question.difficulty = updateData.difficulty;
      if (updateData.question || updateData.options || updateData.answer || updateData.question_type) {
        question.is_pending_correction = false;
      }
      return;
    }
    
    try {
      // Rust Command: update_question(id, question, options, answer, question_type)
      await invoke('update_question', {
        id: questionId,
        question: updateData.question || null,
        options: updateData.options || null,
        answer: updateData.answer || null,
        questionType: updateData.question_type || null,
        importance: updateData.importance ?? null,
        mastery: updateData.mastery ?? null,
        difficulty: updateData.difficulty ?? null,
      });
    } catch (error) {
      console.error('更新题目失败:', error);
      throw error;
    }
  }

  // 删除题目
  async deleteQuestion(id: number): Promise<void> {
    if (!this.isTauri) {
      const index = mockAIResponses.findIndex(q => q.id === id);
      if (index !== -1) mockAIResponses.splice(index, 1);
      return;
    }
    
    try {
      await invoke('delete_question', { id });
    } catch (error) {
      console.error('删除题目失败:', error);
      throw error;
    }
  }

  // 批量删除题目
  async deleteQuestions(ids: number[]): Promise<void> {
    if (!this.isTauri) {
      mockAIResponses = mockAIResponses.filter(q => !ids.includes(q.id));
      return;
    }
    
    try {
      await invoke('delete_questions', { ids });
    } catch (error) {
      console.error('批量删除题目失败:', error);
      throw error;
    }
  }

  // 创建文件夹
  async createFolder(name: string, parentId: number = 0): Promise<number> {
    if (!this.isTauri) {
      const newId = Math.max(...mockFolders.map(f => f.id)) + 1;
      mockFolders.push({
        id: newId,
        name,
        parent_id: parentId,
        created_at: new Date().toISOString()
      });
      return newId;
    }
    
    try {
      const id = await invoke<number>('add_folder', { name, parentId });
      return id;
    } catch (error) {
      console.error('创建文件夹失败:', error);
      throw error;
    }
  }

  // 重命名文件夹
  async renameFolder(id: number, newName: string): Promise<void> {
    if (!this.isTauri) {
      const folder = mockFolders.find(f => f.id === id);
      if (folder) folder.name = newName;
      return;
    }
    
    try {
      await invoke('rename_folder', { id, newName });
    } catch (error) {
      console.error('重命名文件夹失败:', error);
      throw error;
    }
  }

  // 删除文件夹
  async deleteFolder(id: number, deleteQuestions: boolean): Promise<void> {
    if (!this.isTauri) {
      // 模拟逻辑：递归删除
      const getSubtree = (fid: number): number[] => {
        let subs = [fid];
        mockFolders.filter(f => f.parent_id === fid).forEach(sf => {
          subs = [...subs, ...getSubtree(sf.id)];
        });
        return subs;
      };
      
      const idsToDelete = getSubtree(id);
      if (deleteQuestions) {
        mockAIResponses = mockAIResponses.filter(q => !idsToDelete.includes(q.folder_id));
      } else {
        // 移到父文件夹，这里简化处理移到默认文件夹 (0)
        mockAIResponses.forEach(q => {
          if (idsToDelete.includes(q.folder_id)) q.folder_id = 0;
        });
      }
      
      mockFolders = mockFolders.filter(f => !idsToDelete.includes(f.id));
      return;
    }
    
    try {
      await invoke('delete_folder', { id, deleteQuestions });
    } catch (error) {
      console.error('删除文件夹失败:', error);
      throw error;
    }
  }

  async clearFolderQuestions(id: number): Promise<void> {
    if (!this.isTauri) {
      const getSubtree = (fid: number): number[] => {
        let subs = [fid];
        mockFolders.filter(f => f.parent_id === fid).forEach(sf => {
          subs = [...subs, ...getSubtree(sf.id)];
        });
        return subs;
      };

      const idsToClear = getSubtree(id);
      mockAIResponses = mockAIResponses.filter(q => !idsToClear.includes(q.folder_id));
      return;
    }

    try {
      await invoke('clear_folder_questions', { id });
    } catch (error) {
      console.error('清除文件夹题目失败:', error);
      throw error;
    }
  }

  async getQuestionsByIds(ids: number[]): Promise<AIResponse[]> {
    const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
    if (!unique.length) return []
    if (!this.isTauri) {
      return mockAIResponses.filter((item) => unique.includes(item.id))
    }
    try {
      return await invoke<AIResponse[]>('get_questions_by_ids', { ids: unique })
    } catch {
      const all = await this.getAIResponses()
      return all.filter((item) => unique.includes(item.id))
    }
  }

  async addPracticeRecord(input: {
    questionId: number
    userAnswer: string
    isCorrect: boolean
    note?: string
    source?: string
  }): Promise<PracticeRecord> {
    if (!this.isTauri) {
      const record: PracticeRecord = {
        id: Date.now(),
        question_id: input.questionId,
        user_answer: input.userAnswer,
        is_correct: input.isCorrect,
        note: input.note || '',
        source: input.source || 'agent',
        create_time: new Date().toISOString(),
      }
      const bySubject = new Map<number, string[]>()
      for (const link of mockQuestionKnowledge.filter((item) => item.question_id === input.questionId)) {
        for (const [subjectId, graph] of mockStudyGraphs) {
          const node = graph.nodes.find((item) => item.id === link.node_id)
          if (!node) continue
          const names = bySubject.get(subjectId) || []
          if (node.name) names.push(node.name)
          bySubject.set(subjectId, names)
        }
      }
      for (const [subjectId, names] of bySubject) {
        pushMockActivity({
          subject_id: subjectId,
          kind: 'practice',
          names,
          question_count: 1,
          correct_count: input.isCorrect ? 1 : 0,
          create_time: record.create_time || new Date().toISOString(),
        })
        emitStudyActivityUpdated(subjectId)
      }
      return record
    }
    const record = await invoke<PracticeRecord>('add_practice_record', {
      questionId: input.questionId,
      userAnswer: input.userAnswer,
      isCorrect: input.isCorrect,
      note: input.note || '',
      source: input.source || 'agent',
    })
    emitStudyActivityUpdated()
    return record
  }

  async updatePracticeNote(id: number, note: string): Promise<void> {
    if (!this.isTauri) return
    await invoke('update_practice_note', { id, note })
  }

  async getPracticeHistory(questionId: number, limit = 20): Promise<PracticeRecord[]> {
    if (!this.isTauri) return []
    return invoke<PracticeRecord[]>('get_practice_history', { questionId, limit })
  }

  async getPracticeSummaries(ids: number[]): Promise<PracticeSummary[]> {
    const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
    if (!unique.length) return []
    if (!this.isTauri) {
      return unique.map((id) => ({
        question_id: id,
        count: 0,
        last_answer: '',
        last_correct: false,
        last_note: '',
      }))
    }
    return invoke<PracticeSummary[]>('get_practice_summaries', { ids: unique })
  }

  async listStudySubjects(): Promise<StudySubject[]> {
    if (!this.isTauri) {
      mockStudySubjects.forEach((item) => refreshMockSubjectProgress(item.id))
      return mockStudySubjects.map((item) => ({ ...item }))
    }
    return invoke<StudySubject[]>('list_study_subjects')
  }

  async createStudySubject(name: string, description = ''): Promise<StudySubject> {
    if (!this.isTauri) {
      const subject: StudySubject = {
        id: Date.now(),
        name: name.trim(),
        description,
        create_time: new Date().toISOString(),
        node_count: 0,
        progress: 0,
      }
      mockStudySubjects.unshift(subject)
      return { ...subject }
    }
    return invoke<StudySubject>('create_study_subject', { name, description })
  }

  async renameStudySubject(id: number, name?: string, description?: string): Promise<StudySubject> {
    if (!this.isTauri) {
      const subject = mockStudySubjects.find((item) => item.id === id)
      if (!subject) throw new Error('学习科目不存在')
      if (name?.trim()) subject.name = name.trim()
      if (description != null) subject.description = description
      return { ...subject }
    }
    return invoke<StudySubject>('rename_study_subject', { id, name, description })
  }

  async deleteStudySubject(id: number): Promise<void> {
    if (!this.isTauri) {
      mockStudySubjects = mockStudySubjects.filter((item) => item.id !== id)
      mockStudyGraphs.delete(id)
      return
    }
    await invoke('delete_study_subject', { id })
  }

  async getStudyGraph(subjectId: number): Promise<StudyGraphPayload> {
    if (!this.isTauri) {
      const subject = mockStudySubjects.find((item) => item.id === subjectId)
      if (!subject) throw new Error('学习科目不存在')
      const graph = mockStudyGraphs.get(subjectId)
      return withForgettingGraph({
        subject: { ...subject, node_count: graph?.nodes.length || 0 },
        nodes: (graph?.nodes || []).map((item) => ({ ...item })),
        edges: graph?.edges || [],
      })
    }
    return withForgettingGraph(await invoke<StudyGraphPayload>('get_study_graph', { subjectId }))
  }

  async setStudyGraph(
    subjectId: number,
    nodes: StudyGraphNodeInput[],
    edges?: { from_key: string; to_key: string; relation?: string }[],
  ): Promise<StudyGraphPayload> {
    if (!this.isTauri) {
      const subject = mockStudySubjects.find((item) => item.id === subjectId)
      if (!subject) throw new Error('学习科目不存在')
      const rows: StudyGraphNodeRow[] = nodes.map((node, index) => ({
        id: Date.now() + index,
        subject_id: subjectId,
        node_key: node.key || `n${index + 1}`,
        name: node.name,
        summary: node.summary || '',
        mastery: node.mastery || 0,
        parent_id: null,
        sort_order: index,
        forgetting_stage: 0,
        last_reviewed_at: null,
      }))
      const byKey = new Map(rows.map((item) => [item.node_key, item]))
      const byName = new Map(rows.map((item) => [item.name, item]))
      nodes.forEach((node, index) => {
        const parent = node.parent_key
          ? byKey.get(node.parent_key) || byName.get(node.parent_key)
          : undefined
        if (parent && parent.id !== rows[index].id) {
          rows[index].parent_id = parent.id
        }
      })
      const edgeRows: StudyGraphEdgeRow[] = (edges || []).map((edge, index) => ({
        id: Date.now() + index,
        subject_id: subjectId,
        from_id: byKey.get(edge.from_key)?.id || 0,
        to_id: byKey.get(edge.to_key)?.id || 0,
        relation: edge.relation || '',
      }))
      mockStudyGraphs.set(subjectId, { nodes: rows, edges: edgeRows })
      refreshMockSubjectProgress(subjectId)
      return withForgettingGraph({ subject: { ...subject }, nodes: rows, edges: edgeRows })
    }
    return invoke<StudyGraphPayload>('set_study_graph', { subjectId, nodes, edges })
  }

  async patchStudyGraph(
    subjectId: number,
    patch: {
      add?: StudyGraphNodeInput[]
      update?: StudyGraphNodePatch[]
      remove_ids?: number[]
    },
  ): Promise<StudyGraphPayload> {
    if (!this.isTauri) {
      const current = await this.getStudyGraph(subjectId)
      const remove = new Set(patch.remove_ids || [])
      let nodes = current.nodes.filter((item) => !remove.has(item.id))
      for (const item of patch.update || []) {
        const node = nodes.find((row) => row.id === item.id)
        if (!node) continue
        if (item.name != null) node.name = item.name
        if (item.summary != null) node.summary = item.summary
        if (item.mastery != null) node.mastery = item.mastery
        if (item.forgetting_stage != null) node.forgetting_stage = clampForgettingStage(item.forgetting_stage)
        if (item.last_reviewed_at !== undefined) node.last_reviewed_at = item.last_reviewed_at
        if (item.parent_id != null) node.parent_id = item.parent_id || null
      }
      mockStudyGraphs.set(subjectId, { nodes, edges: current.edges })
      if (patch.add?.length) {
        return this.setStudyGraph(subjectId, [
          ...nodes.map((item) => ({
            key: item.node_key,
            name: item.name,
            summary: item.summary,
            parent_key: nodes.find((row) => row.id === item.parent_id)?.node_key,
            mastery: item.mastery,
          })),
          ...patch.add,
        ])
      }
      refreshMockSubjectProgress(subjectId)
      return this.getStudyGraph(subjectId)
    }
    return withForgettingGraph(await invoke<StudyGraphPayload>('patch_study_graph', {
      subjectId,
      add: patch.add,
      update: patch.update,
      removeIds: patch.remove_ids,
    }))
  }

  async applyStudyProgress(subjectId: number, updates: StudyProgressUpdate[]): Promise<StudyGraphPayload> {
    const normalized = updates.slice(0, 24).map((item) => ({
      id: Number(item.id) > 0 ? Number(item.id) : undefined,
      name: String(item.name || '').trim() || undefined,
      forgetting_stage: item.forgetting_stage == null ? undefined : clampForgettingStage(item.forgetting_stage),
      last_reviewed_at: item.last_reviewed_at || reviewedAtFromDaysAgo(item.days_ago),
      mastery: item.mastery,
    }))
    if (!this.isTauri) {
      const graph = mockStudyGraphs.get(subjectId)
      if (!graph) throw new Error('学习科目不存在')
      const learned: string[] = []
      const reviewed: string[] = []
      for (const item of normalized) {
        const node = graph.nodes.find((row) => item.id && row.id === item.id)
          || graph.nodes.find((row) => item.name && row.name === item.name)
          || (item.name && item.name.length >= 4
            ? graph.nodes.find((row) => row.name.includes(item.name) || item.name.includes(row.name))
            : undefined)
        if (!node) continue
        if (graph.nodes.some((row) => row.parent_id === node.id)) continue
        const hadReview = Boolean(String(node.last_reviewed_at || '').trim())
        const prevStage = Number(node.forgetting_stage) || 0
        if (item.forgetting_stage != null) node.forgetting_stage = item.forgetting_stage
        node.last_reviewed_at = item.last_reviewed_at
        node.mastery = item.mastery == null
          ? effectiveMastery({ ...node, last_reviewed_at: item.last_reviewed_at, forgetting_stage: item.forgetting_stage ?? node.forgetting_stage })
          : item.mastery
        if (!hadReview && prevStage <= 0) learned.push(node.name)
        else reviewed.push(node.name)
      }
      const now = new Date().toISOString()
      pushMockActivity({ subject_id: subjectId, kind: 'learn', names: learned, question_count: 0, correct_count: 0, create_time: now })
      pushMockActivity({ subject_id: subjectId, kind: 'review', names: reviewed, question_count: 0, correct_count: 0, create_time: now })
      refreshMockSubjectProgress(subjectId)
      emitStudyActivityUpdated(subjectId)
      return this.getStudyGraph(subjectId)
    }
    const payload = withForgettingGraph(await invoke<StudyGraphPayload>('apply_study_progress', {
      subjectId,
      updates: normalized,
    }))
    emitStudyActivityUpdated(subjectId)
    return payload
  }

  async listStudyActivity(subjectId: number, limit = 80): Promise<StudyActivity[]> {
    if (!Number.isFinite(subjectId) || subjectId <= 0) return []
    if (!this.isTauri) {
      return mockStudyActivity
        .filter((item) => item.subject_id === subjectId)
        .slice(0, Math.max(1, limit))
        .map((item) => ({ ...item, names: [...item.names] }))
    }
    return invoke<StudyActivity[]>('list_study_activity', { subjectId, limit })
  }

  async linkQuestionsToNode(questionIds: number[], nodeId: number): Promise<number> {
    const ids = [...new Set(questionIds.filter((id) => id > 0))]
    if (!ids.length) return 0
    if (!this.isTauri) {
      for (const id of ids) {
        if (!mockQuestionKnowledge.some((item) => item.question_id === id && item.node_id === nodeId)) {
          mockQuestionKnowledge.push({ question_id: id, node_id: nodeId })
        }
      }
      return ids.length
    }
    return invoke<number>('link_questions_to_node', { questionIds: ids, nodeId })
  }

  async unlinkQuestionKnowledge(questionId: number, nodeId?: number): Promise<void> {
    if (!this.isTauri) {
      mockQuestionKnowledge = mockQuestionKnowledge.filter((item) =>
        item.question_id !== questionId || (nodeId != null && item.node_id !== nodeId),
      )
      return
    }
    await invoke('unlink_question_knowledge', { questionId, nodeId: nodeId ?? null })
  }

  async listQuestionKnowledge(questionIds: number[]): Promise<QuestionKnowledgeLink[]> {
    const ids = [...new Set(questionIds.filter((id) => id > 0))]
    if (!ids.length) return []
    if (!this.isTauri) {
      const links: QuestionKnowledgeLink[] = []
      for (const item of mockQuestionKnowledge) {
        if (!ids.includes(item.question_id)) continue
        for (const [subjectId, graph] of mockStudyGraphs) {
          const node = graph.nodes.find((row) => row.id === item.node_id)
          if (!node) continue
          const subject = mockStudySubjects.find((row) => row.id === subjectId)
          links.push({
            question_id: item.question_id,
            node_id: node.id,
            node_name: node.name,
            subject_id: subjectId,
            subject_name: subject?.name || '',
          })
        }
      }
      return links
    }
    return invoke<QuestionKnowledgeLink[]>('list_question_knowledge', { questionIds: ids })
  }

  async listNodeQuestions(nodeId: number): Promise<number[]> {
    if (!this.isTauri) {
      return mockQuestionKnowledge.filter((item) => item.node_id === nodeId).map((item) => item.question_id)
    }
    return invoke<number[]>('list_node_questions', { nodeId })
  }

  async mergeStudySubjects(targetId: number, sourceIds: number[]): Promise<StudySubject> {
    if (!this.isTauri) {
      const target = mockStudySubjects.find((item) => item.id === targetId)
      if (!target) throw new Error('目标科目不存在')
      const targetGraph = mockStudyGraphs.get(targetId) || { nodes: [], edges: [] }
      for (const sourceId of sourceIds.filter((id) => id !== targetId)) {
        const source = mockStudyGraphs.get(sourceId)
        if (source) {
          targetGraph.nodes.push(...source.nodes.map((node) => ({ ...node, subject_id: targetId })))
          targetGraph.edges.push(...source.edges.map((edge) => ({ ...edge, subject_id: targetId })))
        }
        mockStudyGraphs.delete(sourceId)
        mockStudySubjects = mockStudySubjects.filter((item) => item.id !== sourceId)
      }
      mockStudyGraphs.set(targetId, targetGraph)
      refreshMockSubjectProgress(targetId)
      return { ...target }
    }
    return invoke<StudySubject>('merge_study_subjects', { targetId, sourceIds })
  }

  async splitStudySubject(subjectId: number, parts: SplitSubjectPart[]): Promise<{ original: StudySubject; created: StudySubject[] }> {
    if (!this.isTauri) {
      const created: StudySubject[] = []
      const graph = mockStudyGraphs.get(subjectId)
      if (!graph) throw new Error('科目不存在')
      for (const part of parts) {
        const ids = new Set(part.node_ids)
        const nodes = graph.nodes.filter((node) => ids.has(node.id) || (node.parent_id != null && ids.has(node.parent_id)))
        if (!nodes.length) continue
        const subject = await this.createStudySubject(part.name, part.description || '')
        const nodeIds = new Set(nodes.map((node) => node.id))
        mockStudyGraphs.set(subject.id, {
          nodes: nodes.map((node) => ({ ...node, subject_id: subject.id })),
          edges: graph.edges.filter((edge) => nodeIds.has(edge.from_id) && nodeIds.has(edge.to_id))
            .map((edge) => ({ ...edge, subject_id: subject.id })),
        })
        graph.nodes = graph.nodes.filter((node) => !nodeIds.has(node.id))
        graph.edges = graph.edges.filter((edge) => !nodeIds.has(edge.from_id) && !nodeIds.has(edge.to_id))
        refreshMockSubjectProgress(subject.id)
        created.push(subject)
      }
      refreshMockSubjectProgress(subjectId)
      const original = mockStudySubjects.find((item) => item.id === subjectId)
      if (!original) throw new Error('科目不存在')
      return { original: { ...original }, created }
    }
    return invoke('split_study_subject', { subjectId, parts })
  }

  // 移动文件夹
  async moveFolder(id: number, parentId: number, _position?: number): Promise<void> {
    if (id === 0) {
      return;
    }
    if (!this.isTauri) {
      const folder = mockFolders.find(f => f.id === id);
      if (folder) folder.parent_id = parentId;
      return;
    }
    
    try {
      await invoke('move_folder', { id, parentId });
    } catch (error) {
      console.error('移动文件夹失败:', error);
      throw error;
    }
  }
}

export const databaseService = new DatabaseService();
