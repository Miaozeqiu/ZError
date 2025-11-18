import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { environmentDetector } from './environmentDetector';
import { settingsManager } from './settings';

/**
 * 应用初始化服务
 * 负责：
 * 1. 检查并创建用户数据目录
 * 2. 检查并创建数据库文件
 */
export class InitializationService {
  private isInitialized = false;

  /**
   * 初始化应用
   */
  public async initialize(): Promise<void> {
    if (!environmentDetector.isTauriEnvironment(true)) {
      console.log('非Tauri环境，跳过初始化');
      return;
    }

    try {
      console.log('开始应用初始化...');
      
      // 1. 确保用户数据目录存在
      await this.ensureUserDataDirectory();
      
      // 2. 检查并创建数据库文件
      await this.ensureDatabaseFile();
      // 执行数据库模式迁移（补充缺失字段）
      await this.ensureDatabaseSchema();
      
      // 由于已在数据库服务中特殊处理默认文件夹的查询逻辑，
      // 不再需要修复ParentId字段，保持原有的数据结构
      
      // 3. 同步非思考模型分析开关到后端（以确保后端提示词与前端设置一致）
      try {
        const settings = settingsManager.getSettings();
        await invoke('set_non_thinking_analysis_enabled', { enabled: settings.enableNonThinkingModelAnalysis });
        console.log('已同步非思考模型分析开关到后端:', settings.enableNonThinkingModelAnalysis);
      } catch (syncErr) {
        console.warn('同步分析开关到后端失败（可能非Tauri环境或服务未启动）:', syncErr);
      }
      
      console.log('应用初始化完成');
    } catch (error) {
      console.error('应用初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保用户数据目录存在
   */
  private async ensureUserDataDirectory(): Promise<void> {
    try {
      const userDataPath = await this.getUserDataPath();
      console.log('检查用户数据目录:', userDataPath);
      
      // 使用Tauri命令创建目录
      await invoke('create_directory', { path: userDataPath });
      console.log('用户数据目录检查完成');
    } catch (error) {
      console.error('创建用户数据目录失败:', error);
      throw error;
    }
  }

  /**
   * 检查并创建数据库文件
   */
  private async ensureDatabaseFile(): Promise<void> {
    try {
      const dbPath = await this.getDatabasePath();
      console.log('检查数据库文件:', dbPath);
      
      // 检查数据库文件是否存在
      const exists = await invoke<boolean>('file_exists', { path: dbPath });
      
      if (!exists) {
        console.log('数据库文件不存在，创建新数据库');
        await this.createDatabaseFile(dbPath);
      } else {
        console.log('数据库文件已存在');
      }
    } catch (error) {
      console.error('确保数据库文件失败:', error);
      throw error;
    }
  }

  /**
   * 创建新的数据库文件和表结构
   */
  private async createDatabaseFile(dbPath: string): Promise<void> {
    try {
      console.log('创建数据库文件:', dbPath);
      
      // 确保目录存在
      const dir = dbPath.substring(0, dbPath.lastIndexOf('\\'));
      await invoke('create_directory', { path: dir });
      
      // 连接到数据库（如果不存在会自动创建）
      const db = await Database.load(`sqlite:${dbPath}`);
      
      // 创建Folders表（简化结构，移除外键约束）
      await db.execute(`
        CREATE TABLE IF NOT EXISTS Folders (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Name TEXT NOT NULL,
          ParentId INTEGER DEFAULT 0,
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 创建AIResponses表（包含所有必要字段的最终版本）
      await db.execute(`
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
      
      // 插入默认文件夹（ID为0，ParentId为0）
      await db.execute(`
        INSERT INTO Folders (Id, Name, ParentId) VALUES (0, '默认文件夹', 0)
      `);
      
      console.log('数据库初始化完成');
    } catch (error) {
      console.error('创建数据库文件失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库表结构为最新（如补充 AIResponses.IsAi 字段）
   */
  private async ensureDatabaseSchema(): Promise<void> {
    try {
      const dbPath = await this.getDatabasePath();
      const db = await Database.load(`sqlite:${dbPath}`);

      const columns = await db.select<any[]>("PRAGMA table_info('AIResponses')");
      const hasIsAi = Array.isArray(columns) && columns.some((col: any) => col.name === 'IsAi');

      if (!hasIsAi) {
        console.log('检测到 AIResponses 表缺少 IsAi 字段，准备添加...');
        await db.execute("ALTER TABLE AIResponses ADD COLUMN IsAi BOOLEAN DEFAULT 1");
        // 初始化已有数据，避免出现 NULL 值
        await db.execute("UPDATE AIResponses SET IsAi = 1 WHERE IsAi IS NULL");
        console.log('已为 AIResponses 表添加 IsAi 字段并初始化现有数据');
      } else {
        console.log('AIResponses 表已包含 IsAi 字段');
      }
    } catch (error) {
      console.warn('检查/迁移数据库表结构失败（可能非Tauri环境或数据库不可用）:', error);
    }
  }

  /**
   * 获取用户数据目录路径
   */
  public async getUserDataPath(): Promise<string> {
    try {
      // 尝试从 Tauri 获取真实用户名
      const username = await invoke<string>('get_username');
      console.log('获取到的用户名:', username);
      return `C:\\Users\\${username}\\AppData\\Local\\ZError`;
    } catch (error) {
      console.warn('无法获取用户名，使用默认值:', error);
      // 回退到固定用户名
      const username = 'Administrator';
      return `C:\\Users\\${username}\\AppData\\Local\\ZError`;
    }
  }

  /**
   * 获取数据库文件路径
   */
  public async getDatabasePath(): Promise<string> {
    const userDataPath = await this.getUserDataPath();
    return `${userDataPath}\\airesponses.db`;
  }

  /**
   * 检查是否已初始化
   */
  public isAppInitialized(): boolean {
    return this.isInitialized;
  }
}

export const initializationService = new InitializationService();
