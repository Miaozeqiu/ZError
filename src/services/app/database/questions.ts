/** 题库 / 文件夹。SQL 在 src-tauri/src/database/questions.rs。 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'
import { mockAIResponses, mockFolders, replaceList } from './mock'
import type {
  AIResponse,
  Folder,
  PaginatedAIResponses,
  QuestionMetricBucket,
} from './types'

export async function connect(): Promise<void> {
  if (!isTauri()) {
    console.log('运行在浏览器环境，使用模拟数据');
    return;
  }
  // Tauri 环境下，数据库连接由后端自动管理
  console.log('Tauri环境，数据库由后端管理');
}

export async function ensureConnection(): Promise<void> {
  // 无需操作
}

// —— 题库 / 文件夹 → questions.rs ——

export async function getFolders(): Promise<Folder[]> {
  if (!isTauri()) {
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

export async function getAIResponses(folderId?: number): Promise<AIResponse[]> {
  if (!isTauri()) {
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

export async function getPaginatedQuestions(params: {
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

  if (!isTauri()) {
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

export async function getQuestionsFromFolderAndSubfolders(folderId: number): Promise<AIResponse[]> {
  if (!isTauri()) {
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

export async function getPendingCorrectionQuestions(): Promise<AIResponse[]> {
  if (!isTauri()) {
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

export async function getPendingCorrectionQuestionCount(): Promise<number> {
  if (!isTauri()) {
    return mockAIResponses.filter(response => !!response.is_pending_correction).length;
  }

  try {
    return await invoke<number>('get_pending_correction_question_count');
  } catch (error) {
    console.error('获取待修正题目数量失败:', error);
    return 0;
  }
}

export async function setQuestionPendingCorrection(questionId: number, pending: boolean): Promise<void> {
  if (!isTauri()) {
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

export async function getFolderQuestionCount(folderId: number): Promise<number> {
  if (!isTauri()) {
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

export async function searchQuestionsByTitle(searchTerm: string, folderId?: number): Promise<AIResponse[]> {
  if (!isTauri()) {
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

export async function getFolderPath(folderId: number): Promise<{id: number, name: string}[]> {
  if (!isTauri()) {
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

export async function getFolderStats(): Promise<{folderId: number, folderName: string, questionCount: number}[]> {
  if (!isTauri()) {
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

export async function getQuestionMetricStats(params: {
  folderId?: number;
  pendingCorrectionOnly?: boolean;
} = {}): Promise<QuestionMetricBucket[]> {
  const { folderId, pendingCorrectionOnly = false } = params;
  if (!isTauri()) {
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

export async function copyQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
  if (!isTauri()) {
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

export async function moveQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
  if (!isTauri()) {
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

export async function addQuestion(questionData: { content: string; options?: string; answer: string; question_type?: string; folderId: string | number; isAi?: number; importance?: number; mastery?: number; difficulty?: number }): Promise<AIResponse> {
  const folderId = typeof questionData.folderId === 'string' ? parseInt(questionData.folderId) : questionData.folderId;
  
  if (!isTauri()) {
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

export async function updateQuestion(questionId: number, updateData: { question?: string; options?: string | null; answer?: string; question_type?: string; importance?: number; mastery?: number; difficulty?: number }): Promise<void> {
  if (!isTauri()) {
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

export async function deleteQuestion(id: number): Promise<void> {
  if (!isTauri()) {
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

export async function deleteQuestions(ids: number[]): Promise<void> {
  if (!isTauri()) {
    replaceList(mockAIResponses, mockAIResponses.filter(q => !ids.includes(q.id)));
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

export async function createFolder(name: string, parentId: number = 0): Promise<number> {
  if (!isTauri()) {
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

export async function renameFolder(id: number, newName: string): Promise<void> {
  if (!isTauri()) {
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

export async function deleteFolder(id: number, deleteQuestions: boolean): Promise<void> {
  if (!isTauri()) {
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
      replaceList(mockAIResponses, mockAIResponses.filter(q => !idsToDelete.includes(q.folder_id)));
    } else {
      // 移到父文件夹，这里简化处理移到默认文件夹 (0)
      mockAIResponses.forEach(q => {
        if (idsToDelete.includes(q.folder_id)) q.folder_id = 0;
      });
    }
    
    replaceList(mockFolders, mockFolders.filter(f => !idsToDelete.includes(f.id)));
    return;
  }
  
  try {
    await invoke('delete_folder', { id, deleteQuestions });
  } catch (error) {
    console.error('删除文件夹失败:', error);
    throw error;
  }
}

export async function clearFolderQuestions(id: number): Promise<void> {
  if (!isTauri()) {
    const getSubtree = (fid: number): number[] => {
      let subs = [fid];
      mockFolders.filter(f => f.parent_id === fid).forEach(sf => {
        subs = [...subs, ...getSubtree(sf.id)];
      });
      return subs;
    };

    const idsToClear = getSubtree(id);
    replaceList(mockAIResponses, mockAIResponses.filter(q => !idsToClear.includes(q.folder_id)));
    return;
  }

  try {
    await invoke('clear_folder_questions', { id });
  } catch (error) {
    console.error('清除文件夹题目失败:', error);
    throw error;
  }
}

export async function getQuestionsByIds(ids: number[]): Promise<AIResponse[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (!unique.length) return []
  if (!isTauri()) {
    return mockAIResponses.filter((item) => unique.includes(item.id))
  }
  try {
    return await invoke<AIResponse[]>('get_questions_by_ids', { ids: unique })
  } catch {
    const all = await getAIResponses()
    return all.filter((item) => unique.includes(item.id))
  }
}

export async function moveFolder(id: number, parentId: number, _position?: number): Promise<void> {
  if (id === 0) {
    return;
  }
  if (!isTauri()) {
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

