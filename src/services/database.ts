import { invoke } from '@tauri-apps/api/core';
import { initializationService } from './initialization';

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
  async addQuestion(questionData: { content: string; options?: string; answer: string; question_type?: string; folderId: string | number; isAi?: number }): Promise<AIResponse> {
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
        is_ai: !!questionData.isAi
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
        isAi: questionData.isAi === 1
      });
      return newQuestion;
    } catch (error) {
      console.error('添加题目失败:', error);
      throw error;
    }
  }

  // 更新题目
  async updateQuestion(questionId: number, updateData: { question?: string; options?: string | null; answer?: string; question_type?: string }): Promise<void> {
    if (!this.isTauri) {
      const question = mockAIResponses.find(q => q.id === questionId);
      if (!question) throw new Error('题目不存在');
      if (updateData.question) question.question = updateData.question;
      if (updateData.options) question.options = updateData.options;
      if (updateData.answer) question.answer = updateData.answer;
      if (updateData.question_type) question.question_type = updateData.question_type;
      return;
    }
    
    try {
      // Rust Command: update_question(id, question, options, answer, question_type)
      await invoke('update_question', {
        id: questionId,
        question: updateData.question || null,
        options: updateData.options || null,
        answer: updateData.answer || null,
        questionType: updateData.question_type || null
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

  // 移动文件夹
  async moveFolder(id: number, parentId: number, _position?: number): Promise<void> {
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
