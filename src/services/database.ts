import Database from '@tauri-apps/plugin-sql';
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
  answer?: string;
  question_type: string;
  folder_id: number;
  folder_name?: string;
  create_time: string;
}

// 检测是否在 Tauri 环境中
const isTauriEnvironment = () => {
  // 更严格的Tauri环境检测
  if (typeof window === 'undefined') return false;
  
  // 环境检测
  const hasTauri = typeof window !== 'undefined' && window.__TAURI__;
  const hasTauriInternals = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
  const isTauriApp = typeof window !== 'undefined' && window.location.protocol === 'tauri:';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : '';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const href = typeof window !== 'undefined' ? window.location.href : '';
  const isDevelopment = import.meta.env.DEV;
  const isTauriDev = isDevelopment && (hostname === 'localhost' || hostname === '127.0.0.1');
  
  console.log('环境检测信息:');
  console.log('- hasTauri:', hasTauri);
  console.log('- hasTauriInternals:', hasTauriInternals);
  console.log('- isTauriApp:', isTauriApp);
  console.log('- protocol:', protocol);
  console.log('- hostname:', hostname);
  console.log('- href:', href);
  console.log('- isDevelopment:', isDevelopment);
  console.log('- isTauriDev:', isTauriDev);
  console.log('- window.__TAURI__存在:', typeof window !== 'undefined' && window.__TAURI__);
  console.log('- window.__TAURI_INTERNALS__存在:', typeof window !== 'undefined' && window.__TAURI_INTERNALS__);
  
  // 判断是否为 Tauri 环境
  const isTauriEnvironment = hasTauri || hasTauriInternals || isTauriApp || (protocol === 'file:') || isTauriDev;
  console.log('最终判断结果:', isTauriEnvironment);
  
  return isTauriEnvironment;
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
    create_time: '2024-01-01 10:00:00'
  },
  {
    id: 2,
    question: 'Python中的装饰器是什么？',
    answer: '装饰器是Python中的一种设计模式，允许在不修改原函数代码的情况下，为函数添加额外的功能。使用@符号语法糖来应用装饰器。',
    question_type: '概念解释',
    folder_id: 2,
    folder_name: 'Python',
    create_time: '2024-01-02 11:00:00'
  },
  {
    id: 3,
    question: 'Vue.js的响应式原理是什么？',
    answer: 'Vue.js使用Object.defineProperty()（Vue2）或Proxy（Vue3）来劫持对象属性的getter和setter，当数据变化时自动触发视图更新。',
    question_type: '原理解释',
    folder_id: 3,
    folder_name: 'Vue.js',
    create_time: '2024-01-03 12:00:00'
  },
  {
    id: 4,
    question: 'React Hooks的使用场景？',
    answer: 'React Hooks主要用于函数组件中管理状态和副作用，如useState管理状态，useEffect处理副作用，useContext共享数据等。',
    question_type: '使用指南',
    folder_id: 4,
    folder_name: 'React',
    create_time: '2024-01-04 13:00:00'
  },
  {
    id: 5,
    question: 'JavaScript闭包的应用？',
    answer: '闭包常用于数据封装、模块化编程、回调函数、防抖节流等场景。它能让内部函数访问外部函数的变量，即使外部函数已经执行完毕。',
    question_type: '编程问题',
    folder_id: 1,
    folder_name: 'JavaScript',
    create_time: '2024-01-05 14:00:00'
  }
];

class DatabaseService {
  private db: Database | null = null;
  private isInitialized = false;
  private isTauri = false;

  constructor() {
    this.isTauri = isTauriEnvironment();
    console.log('数据库服务初始化，Tauri环境:', this.isTauri);
  }

  async connect(): Promise<void> {
    if (this.isInitialized) return;
    
    if (!this.isTauri) {
      console.log('运行在浏览器环境，使用模拟数据');
      this.isInitialized = true;
      return;
    }
    
    try {
      console.log('正在连接Tauri数据库...');
      
      // 等待Tauri API完全初始化
      let retries = 0;
      const maxRetries = 30;
      
      while (retries < maxRetries) {
        try {
          // 尝试动态导入SQL插件
          const sqlModule = await import('@tauri-apps/plugin-sql');
          const Database = (sqlModule as any).Database || (sqlModule as any).default;
          
          if (Database && typeof Database.load === 'function') {
            console.log('成功导入Tauri SQL插件');
            
            // 连接到用户数据目录中的数据库文件
            const dbPath = await initializationService.getDatabasePath();
            this.db = await Database.load(`sqlite:${dbPath}`);
            console.log('成功连接到预加载数据库');
            
            // 测试数据库连接
            if (this.db) {
                await this.db.select('SELECT 1');
                console.log('数据库连接测试成功');
                
                // 检查表结构
                const tables = await this.db.select('SELECT name FROM sqlite_master WHERE type="table"') as any[];
                console.log('数据库中的表:', tables);
                
                // 打印详细的表结构
                for (const table of tables) {
                  if (table.name && table.name !== 'sqlite_sequence') {
                    try {
                      const schema = await this.db.select(`PRAGMA table_info(${table.name})`);
                      console.log(`表 ${table.name} 的结构:`, schema);
                    } catch (error) {
                      console.error(`获取表 ${table.name} 结构失败:`, error);
                    }
                  }
                }
                
                // 如果数据库为空，初始化表结构
                if (tables.length === 0) {
                  console.log('数据库为空，初始化表结构...');
                  await this.initializeTables();
                  if (this.db) {
                    const newTables = await this.db.select('SELECT name FROM sqlite_master WHERE type="table"') as any[];
                    console.log('初始化后的表:', newTables);
                  }
                }
                
                this.isTauri = true;
                this.isInitialized = true;
                console.log('Tauri数据库连接成功');
                return;
              }
            }
        } catch (error) {
          console.log(`数据库连接尝试 ${retries + 1}/${maxRetries} 失败:`, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      throw new Error('无法连接到Tauri数据库，已达到最大重试次数');
      
    } catch (error) {
      console.error('Tauri数据库连接失败:', error);
      console.log('回退到模拟数据模式');
      this.isTauri = false;
      this.isInitialized = true;
    }
  }

  async ensureConnection(): Promise<void> {
    if (!this.isInitialized) {
      await this.connect();
    }
  }

  async getFolders(): Promise<Folder[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      console.log('使用模拟文件夹数据');
      return mockFolders;
    }
    
    if (!this.db) {
      console.error('数据库未连接，回退到模拟数据');
      return mockFolders;
    }

    try {
      const result = await this.db.select<Folder[]>('SELECT * FROM Folders ORDER BY Name');
      console.log('成功获取文件夹数据:', result.length, '个文件夹');
      // 转换字段名以匹配接口
      return result.map((folder: any) => ({
        id: folder.Id !== undefined ? folder.Id : folder.id,
        name: folder.Name || folder.name,
        parent_id: folder.ParentId !== undefined ? folder.ParentId : (folder.parent_id !== undefined ? folder.parent_id : null),
        created_at: folder.CreateTime || folder.created_at
      }));
    } catch (error) {
      console.error('获取文件夹失败，回退到模拟数据:', error);
      return mockFolders;
    }
  }

  async getAIResponses(folderId?: number): Promise<AIResponse[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      console.log('使用模拟AI响应数据');
      if (folderId !== undefined) {
        return mockAIResponses.filter(response => response.folder_id === folderId);
      }
      return mockAIResponses;
    }
    
    if (!this.db) {
      console.error('数据库未连接，回退到模拟数据');
      if (folderId !== undefined) {
        return mockAIResponses.filter(response => response.folder_id === folderId);
      }
      return mockAIResponses;
    }

    try {
      let query = 'SELECT * FROM AIResponses';
      let params: any[] = [];
      
      if (folderId !== undefined) {
        query += ' WHERE FolderId = ?';
        params = [folderId];
      }
      
      query += ' ORDER BY CreateTime DESC';
      
      const result = await this.db.select<any[]>(query, params);
      console.log(`成功获取AI响应数据:`, result.length, '条记录');
      
      // 转换字段名以匹配接口
      return result.map(response => ({
        id: response.Id || response.id,
        question: response.Question || response.question,
        answer: response.Answer || response.answer,
        question_type: response.QuestionType || response.question_type,
        folder_id: response.FolderId || response.folder_id,
        folder_name: response.FolderName || response.folder_name,
        create_time: response.CreateTime || response.create_time
      }));
    } catch (error) {
      console.error('获取AI响应失败，回退到模拟数据:', error);
      if (folderId !== undefined) {
        return mockAIResponses.filter(response => response.folder_id === folderId);
      }
      return mockAIResponses;
    }
  }

  // 获取文件夹及其所有子文件夹的题目
  async getQuestionsFromFolderAndSubfolders(folderId: number): Promise<AIResponse[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 在模拟环境中，获取指定文件夹的题目（模拟数据没有子文件夹结构）
      return mockAIResponses.filter(response => response.folder_id === folderId);
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 特殊处理：如果是默认文件夹（ID为0），需要特别处理ParentId逻辑
      let result;
      if (folderId === 0) {
        // 对于默认文件夹，直接查询FolderId为0的题目，并查找以0为父节点的子文件夹
        result = await this.db.select<any[]>(`
          WITH RECURSIVE folder_tree AS (
            -- 起始文件夹：默认文件夹（ID=0）
            SELECT Id, Name, ParentId FROM Folders WHERE Id = 0
            UNION ALL
            -- 递归查找子文件夹：ParentId为0的文件夹（但排除自身）
            SELECT f.Id, f.Name, f.ParentId 
            FROM Folders f
            INNER JOIN folder_tree ft ON f.ParentId = ft.Id AND f.Id != ft.Id
          )
          SELECT 
            ar.Id as id,
            ar.Question as question,
            ar.Answer as answer,
            ar.QuestionType as question_type,
            ar.FolderId as folder_id,
            f.Name as folder_name,
            ar.CreateTime as create_time
          FROM AIResponses ar
          INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
          INNER JOIN Folders f ON ar.FolderId = f.Id
          ORDER BY ar.CreateTime DESC
        `);
      } else {
        // 对于其他文件夹，使用正常的递归CTE查询
        result = await this.db.select<any[]>(`
          WITH RECURSIVE folder_tree AS (
            -- 起始文件夹
            SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
            UNION ALL
            -- 递归查找子文件夹
            SELECT f.Id, f.Name, f.ParentId 
            FROM Folders f
            INNER JOIN folder_tree ft ON f.ParentId = ft.Id
          )
          SELECT 
            ar.Id as id,
            ar.Question as question,
            ar.Answer as answer,
            ar.QuestionType as question_type,
            ar.FolderId as folder_id,
            f.Name as folder_name,
            ar.CreateTime as create_time
          FROM AIResponses ar
          INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
          INNER JOIN Folders f ON ar.FolderId = f.Id
          ORDER BY ar.CreateTime DESC
        `, [folderId]);
      }
      
      console.log(`成功获取文件夹${folderId}及其子文件夹的题目:`, result.length, '条记录');
      
      // 转换字段名以匹配接口
      return result.map(response => ({
        id: response.id,
        question: response.question,
        answer: response.answer,
        question_type: response.question_type,
        folder_id: response.folder_id,
        folder_name: response.folder_name,
        create_time: response.create_time
      }));
    } catch (error) {
      console.error('获取文件夹及子文件夹题目失败:', error);
      // 回退到只获取当前文件夹的题目
      return this.getAIResponses(folderId);
    }
  }

  async getFolderQuestionCount(folderId: number): Promise<number> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      return mockAIResponses.filter(response => response.folder_id === folderId).length;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      const result = await this.db.select<{count: number}[]>('SELECT COUNT(*) as count FROM AIResponses WHERE FolderId = ?', [folderId]);
      return result[0]?.count || 0;
    } catch (error) {
      console.error('获取文件夹题目数量失败:', error);
      return 0;
    }
  }

  // 根据标题搜索题目
  async searchQuestionsByTitle(searchTerm: string, folderId?: number): Promise<AIResponse[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      console.log('使用模拟数据进行搜索');
      let filteredResponses = mockAIResponses;
      
      // 如果指定了文件夹ID，先过滤文件夹
      if (folderId !== undefined) {
        filteredResponses = filteredResponses.filter(response => response.folder_id === folderId);
      }
      
      // 根据标题搜索（不区分大小写）
      return filteredResponses.filter(response => 
        response.question.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (!this.db) {
      console.error('数据库未连接，回退到模拟数据');
      let filteredResponses = mockAIResponses;
      if (folderId !== undefined) {
        filteredResponses = filteredResponses.filter(response => response.folder_id === folderId);
      }
      return filteredResponses.filter(response => 
        response.question.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    try {
      let query = `
        SELECT 
          ar.Id as id,
          ar.Question as question,
          ar.Answer as answer,
          ar.QuestionType as question_type,
          ar.FolderId as folder_id,
          f.Name as folder_name,
          ar.CreateTime as create_time
        FROM AIResponses ar
        INNER JOIN Folders f ON ar.FolderId = f.Id
        WHERE ar.Question LIKE ?
      `;
      let params: any[] = [`%${searchTerm}%`];
      
      // 如果指定了文件夹ID，需要搜索该文件夹及其子文件夹
      if (folderId !== undefined) {
        if (folderId === 0) {
          // 对于默认文件夹，使用递归CTE查询
          query = `
            WITH RECURSIVE folder_tree AS (
              SELECT Id, Name, ParentId FROM Folders WHERE Id = 0
              UNION ALL
              SELECT f.Id, f.Name, f.ParentId 
              FROM Folders f
              INNER JOIN folder_tree ft ON f.ParentId = ft.Id AND f.Id != ft.Id
            )
            SELECT 
              ar.Id as id,
              ar.Question as question,
              ar.Answer as answer,
              ar.QuestionType as question_type,
              ar.FolderId as folder_id,
              f.Name as folder_name,
              ar.CreateTime as create_time
            FROM AIResponses ar
            INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
            INNER JOIN Folders f ON ar.FolderId = f.Id
            WHERE ar.Question LIKE ?
            ORDER BY ar.CreateTime DESC
          `;
        } else {
          // 对于其他文件夹，使用递归CTE查询
          query = `
            WITH RECURSIVE folder_tree AS (
              SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
              UNION ALL
              SELECT f.Id, f.Name, f.ParentId 
              FROM Folders f
              INNER JOIN folder_tree ft ON f.ParentId = ft.Id
            )
            SELECT 
              ar.Id as id,
              ar.Question as question,
              ar.Answer as answer,
              ar.QuestionType as question_type,
              ar.FolderId as folder_id,
              f.Name as folder_name,
              ar.CreateTime as create_time
            FROM AIResponses ar
            INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
            INNER JOIN Folders f ON ar.FolderId = f.Id
            WHERE ar.Question LIKE ?
            ORDER BY ar.CreateTime DESC
          `;
          params = [folderId, `%${searchTerm}%`];
        }
      } else {
        query += ' ORDER BY ar.CreateTime DESC';
      }
      
      const result = await this.db.select<any[]>(query, params);
      console.log(`搜索"${searchTerm}"找到`, result.length, '条记录');
      
      return result.map(response => ({
        id: response.id,
        question: response.question,
        answer: response.answer,
        question_type: response.question_type,
        folder_id: response.folder_id,
        folder_name: response.folder_name,
        create_time: response.create_time
      }));
    } catch (error) {
      console.error('搜索题目失败:', error);
      // 回退到模拟数据搜索
      let filteredResponses = mockAIResponses;
      if (folderId !== undefined) {
        filteredResponses = filteredResponses.filter(response => response.folder_id === folderId);
      }
      return filteredResponses.filter(response => 
        response.question.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
  }

  private async initializeTables(): Promise<void> {
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 创建 Folders 表
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS Folders (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Name TEXT NOT NULL,
          ParentId INTEGER DEFAULT 0,
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建 AIResponses 表
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS AIResponses (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Question TEXT NOT NULL,
          Options TEXT,
          QuestionType TEXT,
          Answer TEXT NOT NULL,
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP,
          FolderId INTEGER DEFAULT 0,
          FolderName TEXT DEFAULT '默认文件夹',
          IsAi BOOLEAN DEFAULT 1
        )
      `);

      console.log('数据库表结构初始化完成');

      // 检查是否存在默认文件夹（ID为0）
      const defaultFolderCheck = await this.db.select('SELECT COUNT(*) as count FROM Folders WHERE Id = 0');
      const defaultFolderExists = defaultFolderCheck && defaultFolderCheck.length > 0 && 
        (defaultFolderCheck[0] as any).count > 0;

      if (!defaultFolderExists) {
        // 创建默认文件夹，指定ID为0
        await this.db.execute(`
          INSERT INTO Folders (Id, Name, ParentId, CreateTime) 
          VALUES (0, '默认文件夹', 0, CURRENT_TIMESTAMP)
        `);
        console.log('已创建默认文件夹 (ID: 0)');
      } else {
        console.log('默认文件夹已存在，跳过创建');
      }

    } catch (error) {
      console.error('初始化数据库表结构失败:', error);
      throw error;
    }
  }

  // 获取文件夹路径（面包屑导航）
  async getFolderPath(folderId: number): Promise<{id: number, name: string}[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 在模拟环境中，构建简单的路径
      const folder = mockFolders.find(f => f.id === folderId);
      if (!folder) return [];
      
      const path = [{id: folder.id, name: folder.name}];
      // 简单模拟：如果不是根文件夹，添加一个默认父级
      if (folder.parent_id !== null && folder.parent_id !== 0) {
        const parent = mockFolders.find(f => f.id === folder.parent_id);
        if (parent) {
          path.unshift({id: parent.id, name: parent.name});
        }
      }
      return path;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 使用递归CTE查询获取从根节点到目标文件夹的完整路径
      const result = await this.db.select<{id: number, name: string, level: number}[]>(`
        WITH RECURSIVE folder_path AS (
          -- 起始节点：目标文件夹
          SELECT Id as id, Name as name, ParentId, 0 as level
          FROM Folders 
          WHERE Id = ?
          
          UNION ALL
          
          -- 递归查找父文件夹
          SELECT f.Id as id, f.Name as name, f.ParentId, fp.level + 1 as level
          FROM Folders f
          INNER JOIN folder_path fp ON f.Id = fp.ParentId
          WHERE f.Id != fp.id  -- 防止无限递归（特别是默认文件夹的情况）
        )
        SELECT id, name, level
        FROM folder_path
        ORDER BY level DESC  -- 从根节点到目标节点的顺序
      `, [folderId]);
      
      // 返回路径数组，去掉level字段
      return result.map(item => ({id: item.id, name: item.name}));
    } catch (error) {
      console.error('获取文件夹路径失败:', error);
      // 如果获取路径失败，至少返回当前文件夹信息
      try {
        const folder = await this.db.select<{id: number, name: string}[]>(`
          SELECT Id as id, Name as name FROM Folders WHERE Id = ?
        `, [folderId]);
        return folder.length > 0 ? [folder[0]] : [];
      } catch (fallbackError) {
        console.error('获取文件夹信息失败:', fallbackError);
        return [];
      }
    }
  }

  async getFolderStats(): Promise<{folderId: number, folderName: string, questionCount: number}[]> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      const stats = mockFolders.map(folder => ({
        folderId: folder.id,
        folderName: folder.name,
        questionCount: mockAIResponses.filter(response => response.folder_id === folder.id).length
      }));
      return stats.sort((a, b) => b.questionCount - a.questionCount);
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      const result = await this.db.select<{folderId: number, folderName: string, questionCount: number}[]>(`
        SELECT 
          f.Id as folderId,
          COALESCE(f.Name, '[未分类]') as folderName,
          COUNT(ar.Id) as questionCount
        FROM Folders f
        LEFT JOIN AIResponses ar ON f.Id = ar.FolderId
        GROUP BY f.Id, f.Name
        ORDER BY questionCount DESC, folderName
      `);
      return result;
    } catch (error) {
      console.error('获取文件夹统计失败:', error);
      throw error;
    }
  }

  // 复制题目到指定文件夹
  async copyQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
    await this.ensureConnection();
    
    // 智能选择目标文件夹
    const actualTargetFolderId = await this.getTargetFolderForQuestion(targetFolderId);
    
    if (!this.isTauri) {
      // 模拟环境：复制题目
      const originalQuestion = mockAIResponses.find(q => q.id === questionId);
      if (!originalQuestion) {
        throw new Error('题目不存在');
      }
      
      const targetFolder = mockFolders.find(f => f.id === actualTargetFolderId);
      if (!targetFolder) {
        throw new Error('目标文件夹不存在');
      }
      
      // 创建新的题目副本
      const newQuestion: AIResponse = {
        ...originalQuestion,
        id: Math.max(...mockAIResponses.map(q => q.id)) + 1,
        folder_id: actualTargetFolderId,
        folder_name: targetFolder.name,
        create_time: new Date().toISOString()
      };
      
      mockAIResponses.push(newQuestion);
      console.log(`题目已复制到文件夹: ${targetFolder.name} (ID: ${actualTargetFolderId})`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 获取原题目信息
      const originalQuestion = await this.db.select<AIResponse[]>(`
        SELECT Question, Answer, QuestionType, IsAi 
        FROM AIResponses 
        WHERE Id = ?
      `, [questionId]);
      
      if (originalQuestion.length === 0) {
        throw new Error('题目不存在');
      }
      
      const question = originalQuestion[0];
      
      // 插入新题目到目标文件夹，保持原有的IsAi值
      await this.db.execute(`
        INSERT INTO AIResponses (Question, Answer, QuestionType, FolderId, IsAi, CreateTime)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [
        (question as any).Question || question.question,
        (question as any).Answer || question.answer || null,
        (question as any).QuestionType || question.question_type,
        actualTargetFolderId,
        (question as any).IsAi !== undefined ? (question as any).IsAi : 1  // 保持原有的IsAi值，默认为1
      ]);
      
      console.log(`题目已复制到文件夹ID: ${actualTargetFolderId}`);
    } catch (error) {
      console.error('复制题目失败:', error);
      throw error;
    }
  }

  // 移动题目到指定文件夹
  async moveQuestionToFolder(questionId: number, targetFolderId: number): Promise<void> {
    await this.ensureConnection();
    
    // 智能选择目标文件夹
    const actualTargetFolderId = await this.getTargetFolderForQuestion(targetFolderId);
    
    if (!this.isTauri) {
      // 模拟环境：移动题目
      const question = mockAIResponses.find(q => q.id === questionId);
      if (!question) {
        throw new Error('题目不存在');
      }
      
      const targetFolder = mockFolders.find(f => f.id === actualTargetFolderId);
      if (!targetFolder) {
        throw new Error('目标文件夹不存在');
      }
      
      // 更新题目的文件夹信息
      question.folder_id = actualTargetFolderId;
      question.folder_name = targetFolder.name;
      
      console.log(`题目已移动到文件夹: ${targetFolder.name} (ID: ${actualTargetFolderId})`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 更新题目的文件夹ID
      const result = await this.db.execute(`
        UPDATE AIResponses 
        SET FolderId = ? 
        WHERE Id = ?
      `, [actualTargetFolderId, questionId]);
      
      if (result.rowsAffected === 0) {
        throw new Error('题目不存在或更新失败');
      }
      
      console.log(`题目已移动到文件夹ID: ${actualTargetFolderId}`);
    } catch (error) {
      console.error('移动题目失败:', error);
      throw error;
    }
  }

  // 添加新题目
  async addQuestion(questionData: { content: string; answer: string; folderId: string | number }): Promise<AIResponse> {
    await this.ensureConnection();
    
    const folderId = typeof questionData.folderId === 'string' ? parseInt(questionData.folderId) : questionData.folderId;
    
    if (!this.isTauri) {
      // 模拟环境：添加题目到模拟数据
      const targetFolder = mockFolders.find(f => f.id === folderId);
      if (!targetFolder) {
        throw new Error('目标文件夹不存在');
      }
      
      const newQuestion: AIResponse = {
        id: Math.max(...mockAIResponses.map(q => q.id)) + 1,
        question: questionData.content,
        answer: questionData.answer,
        question_type: '',
        folder_id: folderId,
        folder_name: targetFolder.name,
        create_time: new Date().toISOString()
      };
      
      mockAIResponses.push(newQuestion);
      console.log(`题目已添加到文件夹: ${targetFolder.name}`);
      return newQuestion;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 智能选择目标文件夹
      const targetFolderId = await this.getTargetFolderForQuestion(folderId);
      
      // 插入新题目到数据库
      const result = await this.db.execute(`
        INSERT INTO AIResponses (Question, Answer, QuestionType, FolderId, IsAi, CreateTime)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [
        questionData.content,
        questionData.answer,
        '',
        targetFolderId,
        0  // 手动添加的题目，IsAi设置为0
      ]);
      
      // 获取插入的题目ID
      const insertId = result.lastInsertId;
      console.log(`题目插入成功，insertId: ${insertId}, targetFolderId: ${targetFolderId}`);
      
      if (!insertId) {
        throw new Error('插入题目失败，未获取到有效的ID');
      }
      
      // 查询刚插入的题目信息
      const insertedQuestion = await this.db.select<any[]>(`
        SELECT 
          ar.Id as id,
          ar.Question as question,
          ar.Answer as answer,
          ar.QuestionType as question_type,
          ar.FolderId as folder_id,
          COALESCE(f.Name, '默认文件夹') as folder_name,
          ar.CreateTime as create_time
        FROM AIResponses ar
        LEFT JOIN Folders f ON ar.FolderId = f.Id
        WHERE ar.Id = ?
      `, [insertId]);
      
      console.log(`查询插入的题目，insertId: ${insertId}, 查询结果数量: ${insertedQuestion.length}`);
      
      if (insertedQuestion.length === 0) {
        // 添加更详细的错误信息
        console.error(`无法找到刚插入的题目，insertId: ${insertId}, targetFolderId: ${targetFolderId}`);
        
        // 尝试直接查询 AIResponses 表
        const directQuery = await this.db.select<any[]>(`
          SELECT * FROM AIResponses WHERE Id = ?
        `, [insertId]);
        console.log('直接查询 AIResponses 表结果:', directQuery);
        
        throw new Error(`无法获取插入的题目信息，insertId: ${insertId}`);
      }
      
      const newQuestion: AIResponse = {
        id: insertedQuestion[0].id,
        question: insertedQuestion[0].question,
        answer: insertedQuestion[0].answer,
        question_type: insertedQuestion[0].question_type,
        folder_id: insertedQuestion[0].folder_id,
        folder_name: insertedQuestion[0].folder_name,
        create_time: insertedQuestion[0].create_time
      };
      
      console.log(`题目已添加到数据库，文件夹ID: ${targetFolderId}`);
      return newQuestion;
    } catch (error) {
      console.error('添加题目失败:', error);
      throw error;
    }
  }

  // 更新题目
  async updateQuestion(questionId: number, updateData: { question?: string; answer?: string; question_type?: string }): Promise<void> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 模拟环境：更新题目
      const question = mockAIResponses.find(q => q.id === questionId);
      if (!question) {
        throw new Error('题目不存在');
      }
      
      // 更新题目数据
      if (updateData.question !== undefined) {
        question.question = updateData.question;
      }
      if (updateData.answer !== undefined) {
        question.answer = updateData.answer;
      }
      if (updateData.question_type !== undefined) {
        question.question_type = updateData.question_type;
      }
      
      console.log(`题目已更新，ID: ${questionId}`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 构建更新语句
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      
      if (updateData.question !== undefined) {
        updateFields.push('Question = ?');
        updateValues.push(updateData.question);
      }
      if (updateData.answer !== undefined) {
        updateFields.push('Answer = ?');
        updateValues.push(updateData.answer);
      }
      if (updateData.question_type !== undefined) {
        updateFields.push('QuestionType = ?');
        updateValues.push(updateData.question_type);
      }
      
      if (updateFields.length === 0) {
        throw new Error('没有提供要更新的字段');
      }
      
      // 添加题目ID到参数列表
      updateValues.push(questionId);
      
      // 执行更新
      const result = await this.db.execute(`
        UPDATE AIResponses 
        SET ${updateFields.join(', ')} 
        WHERE Id = ?
      `, updateValues);
      
      if (result.rowsAffected === 0) {
        throw new Error('题目不存在或更新失败');
      }
      
      console.log(`题目已更新，ID: ${questionId}`);
    } catch (error) {
      console.error('更新题目失败:', error);
      throw error;
    }
  }

  // 智能选择目标文件夹
  private async getTargetFolderForQuestion(parentFolderId: number): Promise<number> {
    // 特殊处理：如果是默认文件夹（ID为0），直接在默认文件夹下添加题目
    if (parentFolderId === 0) {
      console.log('默认文件夹添加题目，直接在默认文件夹下添加');
      return 0;
    }

    if (!this.isTauri) {
      // 模拟环境的逻辑
      const subFolders = mockFolders.filter(f => f.parent_id === parentFolderId);
      
      // 情况1: 该文件夹无子文件夹 --> 正常添加题目到该文件夹
      if (subFolders.length === 0) {
        console.log(`情况1: 文件夹${parentFolderId}没有子文件夹，题目将添加到该文件夹下`);
        return parentFolderId;
      }
      
      // 情况2和3: 该文件夹有子文件夹
      const uncategorizedFolder = subFolders.find(folder => folder.name === '[未分类]');
      
      if (uncategorizedFolder) {
        // 情况3: 该文件夹有子文件夹 且有[未分类]子文件夹 --> 创建题目至[未分类]文件夹中
        console.log(`情况3: 使用现有的[未分类]文件夹，ID: ${uncategorizedFolder.id}`);
        return uncategorizedFolder.id;
      } else {
        // 情况2: 该文件夹有子文件夹 且没有[未分类]子文件夹 --> 创建[未分类]子文件夹，将题目创建至该文件夹内
        console.log(`情况2: 文件夹${parentFolderId}有子文件夹但没有[未分类]文件夹，需要创建[未分类]文件夹`);
        
        const newId = Math.max(...mockFolders.map(f => f.id)) + 1;
        const newUncategorizedFolder: Folder = {
          id: newId,
          name: '[未分类]',
          parent_id: parentFolderId,
          created_at: new Date().toISOString()
        };
        
        mockFolders.push(newUncategorizedFolder);
        console.log(`创建了新的[未分类]文件夹，ID: ${newId}`);
        return newId;
      }
    }

    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 获取指定文件夹的子文件夹
      const subFolders = await this.db.select<any[]>(`
        SELECT Id, Name FROM Folders WHERE ParentId = ?
      `, [parentFolderId]);

      // 情况1: 该文件夹无子文件夹 --> 正常添加题目到该文件夹
      if (subFolders.length === 0) {
        console.log(`情况1: 文件夹${parentFolderId}没有子文件夹，题目将添加到该文件夹下`);
        return parentFolderId;
      }

      // 情况2和3: 该文件夹有子文件夹
      const uncategorizedFolder = subFolders.find(folder => folder.Name === '[未分类]');
      
      if (uncategorizedFolder) {
        // 情况3: 该文件夹有子文件夹 且有[未分类]子文件夹 --> 创建题目至[未分类]文件夹中
        console.log(`情况3: 使用现有的[未分类]文件夹，ID: ${uncategorizedFolder.Id}`);
        return uncategorizedFolder.Id;
      } else {
        // 情况2: 该文件夹有子文件夹 且没有[未分类]子文件夹 --> 创建[未分类]子文件夹，将题目创建至该文件夹内
        console.log(`情况2: 文件夹${parentFolderId}有子文件夹但没有[未分类]文件夹，需要创建[未分类]文件夹`);
        
        const result = await this.db.execute(`
          INSERT INTO Folders (Name, ParentId, CreateTime) VALUES (?, ?, datetime('now'))
        `, ['[未分类]', parentFolderId]);

        const newFolderId = result.lastInsertId;
        console.log(`创建了新的[未分类]文件夹，ID: ${newFolderId}`);
        return newFolderId as number;
      }

    } catch (error) {
      console.error('获取目标文件夹失败:', error);
      // 出错时回退到原文件夹
      return parentFolderId;
    }
  }

  // 移动文件夹到指定位置
  async moveFolder(sourceFolderId: number, targetFolderId: number, position: 'before' | 'after' | 'inside'): Promise<void> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 模拟环境：移动文件夹
      const sourceFolder = mockFolders.find(f => f.id === sourceFolderId);
      const targetFolder = mockFolders.find(f => f.id === targetFolderId);
      
      if (!sourceFolder) {
        throw new Error('源文件夹不存在');
      }
      
      if (!targetFolder) {
        throw new Error('目标文件夹不存在');
      }
      
      // 检查是否会造成循环引用
      if (await this.wouldCreateCycle(sourceFolderId, targetFolderId)) {
        throw new Error('不能将文件夹移动到其子文件夹中');
      }
      
      if (position === 'inside') {
        // 移动到目标文件夹内部
        sourceFolder.parent_id = targetFolderId;
      } else {
        // 移动到目标文件夹的同级
        sourceFolder.parent_id = targetFolder.parent_id;
      }
      
      console.log(`文件夹已移动: ${sourceFolder.name} -> ${targetFolder.name} (${position})`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 检查是否会造成循环引用
      if (await this.wouldCreateCycle(sourceFolderId, targetFolderId)) {
        throw new Error('不能将文件夹移动到其子文件夹中');
      }
      
      // 根据位置确定新的父文件夹ID
      let newParentId: number | null = null;
      
      if (position === 'inside') {
        // 移动到目标文件夹内部
        newParentId = targetFolderId;
      } else {
        // 移动到目标文件夹的同级（before 或 after）
        // 需要查询目标文件夹的父级ID
        const targetFolderResult = await this.db.select(`
          SELECT ParentId FROM Folders WHERE Id = ?
        `, [targetFolderId]) as any[];
        
        if (targetFolderResult.length > 0) {
          newParentId = targetFolderResult[0].ParentId;
        }
      }
      
      // 更新源文件夹的父级
      const result = await this.db.execute(`
        UPDATE Folders 
        SET ParentId = ? 
        WHERE Id = ?
      `, [newParentId, sourceFolderId]);
      
      if (result.rowsAffected === 0) {
        throw new Error('源文件夹不存在或更新失败');
      }
      
      console.log(`文件夹已移动: ID ${sourceFolderId} -> 父级 ID ${newParentId} (${position})`);
    } catch (error) {
      console.error('移动文件夹失败:', error);
      throw error;
    }
  }

  // 重命名文件夹
  async renameFolder(folderId: number, newName: string): Promise<void> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 模拟环境：重命名文件夹
      const folder = mockFolders.find(f => f.id === folderId);
      if (!folder) {
        throw new Error('文件夹不存在');
      }
      
      folder.name = newName;
      console.log(`文件夹已重命名: ${folder.name} -> ${newName}`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      const result = await this.db.execute(`
        UPDATE Folders 
        SET Name = ? 
        WHERE Id = ?
      `, [newName, folderId]);
      
      if (result.rowsAffected === 0) {
        throw new Error('文件夹不存在或更新失败');
      }
      
      console.log(`文件夹已重命名: ID ${folderId} -> ${newName}`);
    } catch (error) {
      console.error('重命名文件夹失败:', error);
      throw error;
    }
  }

  // 创建新文件夹
  async createFolder(folderName: string, parentId: number): Promise<number> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 模拟环境：创建新文件夹
      console.log(`准备在父文件夹 ${parentId} 下创建新文件夹: ${folderName}`);
      
      // 检查父文件夹是否有其他子文件夹
      const siblingFolders = mockFolders.filter(f => f.parent_id === parentId);
      console.log(`父文件夹 ${parentId} 的子文件夹数量: ${siblingFolders.length}`);
      
      if (siblingFolders.length > 0) {
        // 情况1: 该文件夹有其他子文件夹 --> 正常添加文件夹
        console.log(`情况1: 父文件夹有其他子文件夹，正常添加文件夹`);
      } else {
        // 父文件夹没有其他子文件夹，检查是否有题目
        const questionsInParent = mockAIResponses.filter(q => q.folder_id === parentId);
        console.log(`父文件夹 ${parentId} 的题目数量: ${questionsInParent.length}`);
        
        if (questionsInParent.length === 0) {
          // 情况2: 该文件夹没有其他子文件夹且没有题目 --> 正常添加文件夹
          console.log(`情况2: 父文件夹没有子文件夹且没有题目，正常添加文件夹`);
        } else {
          // 情况3: 该文件夹没有其他子文件夹且有题目 --> 添加文件夹,创建[未分类]文件夹，将题目移动到[未分类]文件夹
          console.log(`情况3: 父文件夹没有子文件夹但有题目，需要创建[未分类]文件夹并转移题目`);
          
          // 先创建[未分类]文件夹
          const uncategorizedId = Math.max(...mockFolders.map(f => f.id)) + 1;
          const uncategorizedFolder: Folder = {
            id: uncategorizedId,
            name: '[未分类]',
            parent_id: parentId,
            created_at: new Date().toISOString()
          };
          mockFolders.push(uncategorizedFolder);
          console.log(`创建[未分类]文件夹: ID ${uncategorizedId}`);
          
          // 将题目转移到[未分类]文件夹
          questionsInParent.forEach(question => {
            question.folder_id = uncategorizedId;
          });
          console.log(`已将 ${questionsInParent.length} 个题目转移到[未分类]文件夹`);
        }
      }
      
      const newId = Math.max(...mockFolders.map(f => f.id)) + 1;
      const newFolder: Folder = {
        id: newId,
        name: folderName,
        parent_id: parentId,
        created_at: new Date().toISOString()
      };
      
      mockFolders.push(newFolder);
      console.log(`新文件夹已创建: ${folderName} (ID: ${newId})`);
      return newId;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      console.log(`准备在父文件夹 ${parentId} 下创建新文件夹: ${folderName} (数据库环境)`);
      
      // 检查父文件夹是否有其他子文件夹
      const siblingCountResult = await this.db.select(`
        SELECT COUNT(*) as count FROM Folders WHERE ParentId = ?
      `, [parentId]);
      
      let siblingCount = 0;
      if (siblingCountResult && siblingCountResult.length > 0) {
        const row = siblingCountResult[0];
        siblingCount = row.count || row.COUNT || row['COUNT(*)'] || 0;
      }
      console.log(`父文件夹 ${parentId} 的子文件夹数量: ${siblingCount}`);
      
      if (siblingCount > 0) {
        // 情况1: 该文件夹有其他子文件夹 --> 正常添加文件夹
        console.log(`情况1: 父文件夹有其他子文件夹，正常添加文件夹`);
      } else {
        // 父文件夹没有其他子文件夹，检查是否有题目
        const questionCountResult = await this.db.select(`
          SELECT COUNT(*) as count FROM AIResponses WHERE FolderId = ?
        `, [parentId]);
        
        let questionCount = 0;
        if (questionCountResult && questionCountResult.length > 0) {
          const row = questionCountResult[0];
          questionCount = row.count || row.COUNT || row['COUNT(*)'] || 0;
        }
        console.log(`父文件夹 ${parentId} 的题目数量: ${questionCount}`);
        
        if (questionCount === 0) {
          // 情况2: 该文件夹没有其他子文件夹且没有题目 --> 正常添加文件夹
          console.log(`情况2: 父文件夹没有子文件夹且没有题目，正常添加文件夹`);
        } else {
          // 情况3: 该文件夹没有其他子文件夹且有题目 --> 添加文件夹,创建[未分类]文件夹，将题目移动到[未分类]文件夹
          console.log(`情况3: 父文件夹没有子文件夹但有题目，需要创建[未分类]文件夹并转移题目`);
          
          // 先创建[未分类]文件夹
          const uncategorizedResult = await this.db.execute(`
            INSERT INTO Folders (Name, ParentId, CreateTime)
            VALUES (?, ?, datetime('now'))
          `, ['[未分类]', parentId]);
          
          const uncategorizedId = uncategorizedResult.lastInsertId as number;
          console.log(`创建[未分类]文件夹: ID ${uncategorizedId}`);
          
          // 将题目转移到[未分类]文件夹
          await this.db.execute(`
            UPDATE AIResponses SET FolderId = ? WHERE FolderId = ?
          `, [uncategorizedId, parentId]);
          console.log(`已将 ${questionCount} 个题目转移到[未分类]文件夹`);
        }
      }
      
      const result = await this.db.execute(`
        INSERT INTO Folders (Name, ParentId, CreateTime)
        VALUES (?, ?, datetime('now'))
      `, [folderName, parentId]);
      
      const newFolderId = result.lastInsertId as number;
      console.log(`新文件夹已创建: ${folderName} (ID: ${newFolderId})`);
      return newFolderId;
    } catch (error) {
      console.error('创建文件夹失败:', error);
      throw error;
    }
  }

  // 删除文件夹
  async deleteFolder(folderId: number, deleteQuestions: boolean = false): Promise<void> {
    await this.ensureConnection();
    
    // 检查是否为默认文件夹（ID为0），如果是则不允许删除
    if (folderId === 0) {
      throw new Error('默认文件夹不能被删除');
    }
    
    if (!this.isTauri) {
      // 模拟环境：删除文件夹
      console.log(`准备删除文件夹 ID: ${folderId}`);
      const folder = mockFolders.find(f => f.id === folderId);
      if (!folder) {
        throw new Error(`文件夹不存在: ${folderId}`);
      }
      
      console.log(`找到文件夹: ${JSON.stringify(folder)}`);
      
      if (deleteQuestions) {
        // 删除该文件夹及其所有子文件夹下的题目
        const getAllSubfolderIds = (parentId: number): number[] => {
          const subfolders = mockFolders.filter(f => f.parent_id === parentId);
          let allIds = [parentId];
          for (const subfolder of subfolders) {
            allIds = allIds.concat(getAllSubfolderIds(subfolder.id));
          }
          return allIds;
        };
        
        const folderIdsToDelete = getAllSubfolderIds(folderId);
        
        // 删除这些文件夹下的所有题目
        mockAIResponses = mockAIResponses.filter(q => !folderIdsToDelete.includes(q.folder_id));
        
        // 删除所有子文件夹
        mockFolders = mockFolders.filter(f => !folderIdsToDelete.includes(f.id));
      } else {
        // 转移题目到未分类文件夹
        // 如果有父文件夹，需要检查父文件夹的子文件夹数量和要删除的文件夹类型
        if (folder.parent_id !== null && folder.parent_id !== undefined && folder.parent_id !== 0) {
          // 有父文件夹，检查父文件夹是否只有当前这一个子文件夹
          const siblingFolders = mockFolders.filter(f => f.parent_id === folder.parent_id);
          console.log(`父文件夹 ${folder.parent_id} 的子文件夹数量: ${siblingFolders.length}`);
          
          if (siblingFolders.length === 1) {
            // 父文件夹只有当前这一个子文件夹，直接将题目转移到父文件夹
            console.log(`删除文件夹 (模拟环境): ${folder.name} (ID: ${folder.id}), parent_id: ${folder.parent_id}, 父文件夹只有一个子文件夹，将题目直接转移到父文件夹`);
            
            // 获取该文件夹及其所有子文件夹的ID
            const getAllSubfolderIds = (parentId: number): number[] => {
              const subfolders = mockFolders.filter(f => f.parent_id === parentId);
              let allIds = [parentId];
              for (const subfolder of subfolders) {
                allIds = allIds.concat(getAllSubfolderIds(subfolder.id));
              }
              return allIds;
            };
            
            const folderIdsToDelete = getAllSubfolderIds(folderId);
            
            // 转移题目到父文件夹
            mockAIResponses.forEach(q => {
              if (folderIdsToDelete.includes(q.folder_id)) {
                q.folder_id = folder.parent_id!;
              }
            });
            
            // 删除文件夹
            mockFolders = mockFolders.filter(f => !folderIdsToDelete.includes(f.id));
          } else {
            // 父文件夹有多个子文件夹，需要检查要删除的文件夹是否是[未分类]文件夹
            console.log(`检查要删除的文件夹是否是[未分类]文件夹: ${folder.name}`);
            
            if (folder.name === '[未分类]') {
              // 要删除的文件夹是[未分类]文件夹，需要检查是否有题目
              const questionsInFolder = mockAIResponses.filter(q => q.folder_id === folderId);
              console.log(`[未分类]文件夹 ${folder.name} (ID: ${folder.id}) 的题目数量: ${questionsInFolder.length}`);
              
              if (questionsInFolder.length > 0) {
                // 判断5: [未分类]文件夹有题目，无法删除
                console.log(`删除文件夹失败: [未分类]文件夹有题目，无法删除 ${folder.name} (ID: ${folder.id})`);
                throw new Error('无法删除[未分类]文件夹。请先将其中的题目移动到其他文件夹。');
              } else {
                // 判断4: [未分类]文件夹没有题目，正常删除
                console.log(`[未分类]文件夹没有题目，正常删除 ${folder.name} (ID: ${folder.id})`);
                // 直接删除文件夹，不需要转移题目
                mockFolders = mockFolders.filter(f => f.id !== folderId);
                console.log(`[未分类]文件夹已删除 (模拟环境): ID ${folderId}`);
                return;
              }
            } else {
              // 要删除的文件夹不是[未分类]文件夹，创建未分类文件夹并转移题目
              console.log(`删除文件夹 (模拟环境): ${folder.name} (ID: ${folder.id}), parent_id: ${folder.parent_id}, 父文件夹有多个子文件夹且要删除的不是[未分类]文件夹，将转移到父文件夹${folder.parent_id}下的未分类文件夹`);
              const uncategorizedFolderId = await this.getOrCreateUncategorizedFolder(folder.parent_id);
              
              // 获取该文件夹及其所有子文件夹的ID
              const getAllSubfolderIds = (parentId: number): number[] => {
                const subfolders = mockFolders.filter(f => f.parent_id === parentId);
                let allIds = [parentId];
                for (const subfolder of subfolders) {
                  allIds = allIds.concat(getAllSubfolderIds(subfolder.id));
                }
                return allIds;
              };
              
              const folderIdsToDelete = getAllSubfolderIds(folderId);
              
              // 转移题目到未分类文件夹
              mockAIResponses.forEach(q => {
                if (folderIdsToDelete.includes(q.folder_id)) {
                  q.folder_id = uncategorizedFolderId;
                }
              });
              
              // 删除文件夹
              mockFolders = mockFolders.filter(f => !folderIdsToDelete.includes(f.id));
            }
          }
        } else {
          // 没有父文件夹，直接转移到默认文件夹（ID: 0）
          console.log(`删除文件夹 (模拟环境): ${folder.name} (ID: ${folder.id}), parent_id: ${folder.parent_id}, 将转移到默认文件夹 (ID: 0)`);
          
          // 获取该文件夹及其所有子文件夹的ID
          const getAllSubfolderIds = (parentId: number): number[] => {
            const subfolders = mockFolders.filter(f => f.parent_id === parentId);
            let allIds = [parentId];
            for (const subfolder of subfolders) {
              allIds = allIds.concat(getAllSubfolderIds(subfolder.id));
            }
            return allIds;
          };
          
          const folderIdsToDelete = getAllSubfolderIds(folderId);
          
          // 转移题目到默认文件夹
          mockAIResponses.forEach(q => {
            if (folderIdsToDelete.includes(q.folder_id)) {
              q.folder_id = 0;
            }
          });
          
          // 删除文件夹
          mockFolders = mockFolders.filter(f => !folderIdsToDelete.includes(f.id));
        }
      }
      
      console.log(`文件夹已删除: ${folder.name} (ID: ${folderId})`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      console.log(`准备删除文件夹 ID: ${folderId} (数据库环境)`);
      
      if (deleteQuestions) {
        // 删除该文件夹及其所有子文件夹下的题目
        await this.db.execute(`
          DELETE FROM AIResponses 
          WHERE FolderId IN (
            WITH RECURSIVE folder_hierarchy AS (
              SELECT Id FROM Folders WHERE Id = ?
              UNION ALL
              SELECT f.Id 
              FROM Folders f
              INNER JOIN folder_hierarchy fh ON f.ParentId = fh.Id
            )
            SELECT Id FROM folder_hierarchy
          )
        `, [folderId]);
        
        // 删除文件夹及其所有子文件夹
        await this.db.execute(`
          DELETE FROM Folders 
          WHERE Id IN (
            WITH RECURSIVE folder_hierarchy AS (
              SELECT Id FROM Folders WHERE Id = ?
              UNION ALL
              SELECT f.Id 
              FROM Folders f
              INNER JOIN folder_hierarchy fh ON f.ParentId = fh.Id
            )
            SELECT Id FROM folder_hierarchy
          )
        `, [folderId]);
      } else {
        // 获取要删除的文件夹信息
        const folderResult = await this.db.select<Folder[]>(`
          SELECT * FROM Folders WHERE Id = ?
        `, [folderId]);
        
        if (folderResult.length === 0) {
          throw new Error('文件夹不存在');
        }
        
        const folder = folderResult[0];
        console.log(`找到文件夹 (数据库环境): ${JSON.stringify(folder)}`);
        
        // 数据库返回的字段名是大写的，需要转换为小写
        const folderName = folder.Name || folder.name;
        const folderIdFromDb = folder.Id || folder.id;
        const parentId = folder.ParentId !== undefined ? folder.ParentId : folder.parent_id;
        
        // 如果有父文件夹，转移到父文件夹下的未分类文件夹；如果没有父文件夹，转移到默认文件夹（ID: 0）
        let targetFolderId: number;
        if (parentId !== null && parentId !== undefined && parentId !== 0) {
          // 有父文件夹，检查父文件夹是否只有当前这一个子文件夹
          const siblingCountResult = await this.db.select(`
            SELECT COUNT(*) as count FROM Folders WHERE ParentId = ?
          `, [parentId]);
          
          console.log(`查询父文件夹 ${parentId} 的子文件夹数量，原始结果:`, siblingCountResult);
          
          // 处理不同数据库返回格式的count字段
          let count = 0;
          if (siblingCountResult && siblingCountResult.length > 0) {
            const row = siblingCountResult[0];
            count = row.count || row.COUNT || row['COUNT(*)'] || 0;
          }
          
          console.log(`父文件夹 ${parentId} 的子文件夹数量: ${count}`);
          
          if (count === 1) {
            // 父文件夹只有当前这一个子文件夹，直接将题目转移到父文件夹
            console.log(`删除文件夹 (数据库环境): ${folderName} (ID: ${folderIdFromDb}), parent_id: ${parentId}, 父文件夹只有一个子文件夹，将题目直接转移到父文件夹`);
            targetFolderId = parentId;
          } else {
            // 父文件夹有多个子文件夹，需要检查要删除的文件夹是否是[未分类]文件夹
            console.log(`检查要删除的文件夹是否是[未分类]文件夹: ${folderName}`);
            
            if (folderName === '[未分类]') {
              // 要删除的文件夹是[未分类]文件夹，需要检查是否有题目
              const questionCountResult = await this.db.select(`
                SELECT COUNT(*) as count FROM AIResponses WHERE FolderId = ?
              `, [folderIdFromDb]);
              
              let questionCount = 0;
              if (questionCountResult && questionCountResult.length > 0) {
                const row = questionCountResult[0];
                questionCount = row.count || row.COUNT || row['COUNT(*)'] || 0;
              }
              
              console.log(`[未分类]文件夹 ${folderName} (ID: ${folderIdFromDb}) 的题目数量: ${questionCount}`);
              
              if (questionCount > 0) {
                // 判断5: [未分类]文件夹有题目，无法删除
                console.log(`删除文件夹失败: [未分类]文件夹有题目，无法删除 ${folderName} (ID: ${folderIdFromDb})`);
                throw new Error('无法删除[未分类]文件夹。请先将其中的题目移动到其他文件夹。');
              } else {
                // 判断4: [未分类]文件夹没有题目，正常删除
                console.log(`[未分类]文件夹没有题目，正常删除 ${folderName} (ID: ${folderIdFromDb})`);
                // 直接删除文件夹，不需要转移题目
                await this.db.execute(`DELETE FROM Folders WHERE Id = ?`, [folderId]);
                console.log(`[未分类]文件夹已删除 (数据库环境): ID ${folderId}`);
                return;
              }
            } else {
              // 要删除的文件夹不是[未分类]文件夹，创建未分类文件夹并转移题目
              const targetParentId = parentId;
              console.log(`删除文件夹 (数据库环境): ${folderName} (ID: ${folderIdFromDb}), parent_id: ${parentId}, 父文件夹有多个子文件夹且要删除的不是[未分类]文件夹，将转移到父文件夹${targetParentId}下的未分类文件夹`);
              targetFolderId = await this.getOrCreateUncategorizedFolder(targetParentId);
            }
          }
        } else {
          // 没有父文件夹，直接转移到默认文件夹（ID: 0）
          console.log(`删除文件夹 (数据库环境): ${folderName} (ID: ${folderIdFromDb}), parent_id: ${parentId}, 将转移到默认文件夹 (ID: 0)`);
          targetFolderId = 0;
        }
        console.log(`最终转移目标文件夹ID (数据库环境): ${targetFolderId}`);
        
        // 转移题目到目标文件夹
        console.log(`准备转移题目到目标文件夹 (数据库环境): ${targetFolderId}`);
        await this.db.execute(`
          UPDATE AIResponses 
          SET FolderId = ?
          WHERE FolderId IN (
            WITH RECURSIVE folder_hierarchy AS (
              SELECT Id FROM Folders WHERE Id = ?
              UNION ALL
              SELECT f.Id 
              FROM Folders f
              INNER JOIN folder_hierarchy fh ON f.ParentId = fh.Id
            )
            SELECT Id FROM folder_hierarchy
          )
        `, [targetFolderId, folderId]);
        console.log(`题目转移完成 (数据库环境)`);
        
        // 删除文件夹及其所有子文件夹
        await this.db.execute(`
          DELETE FROM Folders 
          WHERE Id IN (
            WITH RECURSIVE folder_hierarchy AS (
              SELECT Id FROM Folders WHERE Id = ?
              UNION ALL
              SELECT f.Id 
              FROM Folders f
              INNER JOIN folder_hierarchy fh ON f.ParentId = fh.Id
            )
            SELECT Id FROM folder_hierarchy
          )
        `, [folderId]);
      }
      
      console.log(`文件夹已删除 (数据库环境): ID ${folderId}`);
    } catch (error) {
      console.error('删除文件夹失败:', error);
      throw error;
    }
  }

  // 获取或创建未分类文件夹
  private async getOrCreateUncategorizedFolder(parentId?: number | null): Promise<number> {
    const uncategorizedName = '[未分类]';
    console.log(`getOrCreateUncategorizedFolder 被调用，parentId: ${parentId}, 类型: ${typeof parentId}`);
    
    if (!this.isTauri) {
      // 模拟环境
      let uncategorizedFolder = mockFolders.find(f => 
        f.name === uncategorizedName && 
        (parentId === null || parentId === 0 ? f.parent_id === null : f.parent_id === parentId)
      );
      
      if (!uncategorizedFolder) {
        const newId = Math.max(...mockFolders.map(f => f.id)) + 1;
        uncategorizedFolder = {
          id: newId,
          name: uncategorizedName,
          parent_id: parentId === null || parentId === 0 ? null : parentId,
          created_at: new Date().toISOString()
        };
        mockFolders.push(uncategorizedFolder);
        console.log(`创建未分类文件夹: ${uncategorizedName} (ID: ${newId}, ParentId: ${parentId})`);
      } else {
        console.log(`找到已存在的未分类文件夹: ${uncategorizedName} (ID: ${uncategorizedFolder.id}, ParentId: ${uncategorizedFolder.parent_id})`);
      }
      
      return uncategorizedFolder.id;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      // 查找是否已存在未分类文件夹
      const existingResult = await this.db.select<Folder[]>(`
        SELECT * FROM Folders 
        WHERE Name = ? AND ${parentId !== null && parentId !== 0 ? 'ParentId = ?' : 'ParentId IS NULL'}
      `, parentId !== null && parentId !== 0 ? [uncategorizedName, parentId] : [uncategorizedName]);
      
      if (existingResult.length > 0) {
        console.log(`找到已存在的未分类文件夹 (数据库环境): ${uncategorizedName} (ID: ${existingResult[0].Id || existingResult[0].id}, ParentId: ${existingResult[0].ParentId || existingResult[0].parent_id})`);
        return existingResult[0].Id || existingResult[0].id;
      }
      
      // 创建新的未分类文件夹
      const result = await this.db.execute(`
        INSERT INTO Folders (Name, ParentId, CreateTime)
        VALUES (?, ?, datetime('now'))
      `, [uncategorizedName, parentId !== null && parentId !== 0 ? parentId : null]);
      
      const newFolderId = result.lastInsertId as number;
      console.log(`创建未分类文件夹: ${uncategorizedName} (ID: ${newFolderId}, ParentId: ${parentId})`);
      return newFolderId;
    } catch (error) {
      console.error('获取或创建未分类文件夹失败:', error);
      throw error;
    }
  }



  // 删除题目
  async deleteQuestion(questionId: number): Promise<void> {
    await this.ensureConnection();
    
    if (!this.isTauri) {
      // 模拟环境：删除题目
      console.log(`准备删除题目 ID: ${questionId} (模拟环境)`);
      const questionIndex = mockAIResponses.findIndex(q => q.id === questionId);
      if (questionIndex === -1) {
        throw new Error(`题目不存在: ${questionId}`);
      }
      
      const question = mockAIResponses[questionIndex];
      console.log(`找到题目: ${question.question}`);
      
      // 删除题目
      mockAIResponses.splice(questionIndex, 1);
      console.log(`题目已删除 (模拟环境): ID ${questionId}`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      console.log(`准备删除题目 ID: ${questionId} (数据库环境)`);
      
      // 检查题目是否存在
      const existingQuestion = await this.db.select<AIResponse[]>(`
        SELECT * FROM AIResponses WHERE Id = ?
      `, [questionId]);
      
      if (existingQuestion.length === 0) {
        throw new Error(`题目不存在: ${questionId}`);
      }
      
      console.log(`找到题目: ${existingQuestion[0].question}`);
      
      // 删除题目
      await this.db.execute(`DELETE FROM AIResponses WHERE Id = ?`, [questionId]);
      console.log(`题目已删除 (数据库环境): ID ${questionId}`);
    } catch (error) {
      console.error('删除题目失败:', error);
      throw error;
    }
  }

  // 批量删除题目
  async deleteQuestions(questionIds: number[]): Promise<void> {
    await this.ensureConnection();
    
    if (questionIds.length === 0) {
      return;
    }
    
    if (!this.isTauri) {
      // 模拟环境：批量删除题目
      console.log(`准备批量删除题目 (模拟环境): ${questionIds.join(', ')}`);
      
      let deletedCount = 0;
      for (const questionId of questionIds) {
        const questionIndex = mockAIResponses.findIndex(q => q.id === questionId);
        if (questionIndex !== -1) {
          const question = mockAIResponses[questionIndex];
          console.log(`删除题目: ${question.question} (ID: ${questionId})`);
          mockAIResponses.splice(questionIndex, 1);
          deletedCount++;
        } else {
          console.warn(`题目不存在，跳过: ${questionId}`);
        }
      }
      
      console.log(`批量删除完成 (模拟环境): 成功删除 ${deletedCount} 个题目`);
      return;
    }
    
    if (!this.db) {
      throw new Error('数据库未连接');
    }

    try {
      console.log(`准备批量删除题目 (数据库环境): ${questionIds.join(', ')}`);
      
      // 构建 IN 子句的占位符
      const placeholders = questionIds.map(() => '?').join(',');
      
      // 先查询要删除的题目信息（用于日志）
      const existingQuestions = await this.db.select<AIResponse[]>(`
        SELECT Id, question FROM AIResponses WHERE Id IN (${placeholders})
      `, questionIds);
      
      console.log(`找到 ${existingQuestions.length} 个题目待删除`);
      existingQuestions.forEach(q => {
        console.log(`- 题目: ${q.question} (ID: ${q.id})`);
      });
      
      // 批量删除题目
      const result = await this.db.execute(`
        DELETE FROM AIResponses WHERE Id IN (${placeholders})
      `, questionIds);
      
      console.log(`批量删除完成 (数据库环境): 成功删除 ${existingQuestions.length} 个题目`);
    } catch (error) {
      console.error('批量删除题目失败:', error);
      throw error;
    }
  }

  private async wouldCreateCycle(sourceFolderId: number, targetFolderId: number): Promise<boolean> {
    console.log(`检查循环引用: 源文件夹 ${sourceFolderId} -> 目标文件夹 ${targetFolderId}`);
    
    if (sourceFolderId === targetFolderId) {
      console.log('源文件夹和目标文件夹相同，会造成循环');
      return true;
    }
    
    if (!this.isTauri) {
      // 模拟环境：检查循环引用
      const isDescendant = (folderId: number, ancestorId: number): boolean => {
        const folder = mockFolders.find(f => f.id === folderId);
        if (!folder || !folder.parent_id) return false;
        if (folder.parent_id === ancestorId) return true;
        return isDescendant(folder.parent_id, ancestorId);
      };
      
      const result = isDescendant(targetFolderId, sourceFolderId);
      console.log(`模拟环境循环检测结果: ${result}`);
      return result;
    }
    
    if (!this.db) {
      console.log('数据库未连接，跳过循环检测');
      return false;
    }

    try {
      // 修正逻辑：从源文件夹开始，向下查找其所有子文件夹，检查目标文件夹是否在其中
      const result = await this.db.select<{count: number}[]>(`
        WITH RECURSIVE folder_hierarchy AS (
          SELECT Id, ParentId FROM Folders WHERE Id = ?
          UNION ALL
          SELECT f.Id, f.ParentId 
          FROM Folders f
          INNER JOIN folder_hierarchy fh ON f.ParentId = fh.Id
        )
        SELECT COUNT(*) as count FROM folder_hierarchy WHERE Id = ?
      `, [sourceFolderId, targetFolderId]);
      
      const wouldCycle = result.length > 0 && result[0].count > 0;
      console.log(`数据库循环检测结果: ${wouldCycle}, 查询结果:`, result);
      return wouldCycle;
    } catch (error) {
      console.error('检查循环引用失败:', error);
      return true; // 出错时保守处理，认为会造成循环
    }
  }
}

export const databaseService = new DatabaseService();