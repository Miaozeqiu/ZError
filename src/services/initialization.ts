import { invoke } from '@tauri-apps/api/core';
import { environmentDetector } from './environmentDetector';
import { useSettings } from './settings';

/**
 * 应用初始化服务
 * 负责：
 * 1. 同步设置到后端
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

    if (this.isInitialized) {
      return;
    }

    try {
      console.log('开始应用初始化...');
      
      // 数据库初始化已移至后端 (Rust) 在启动时自动完成
      
      // 同步非思考模型分析开关到后端（以确保后端提示词与前端设置一致）
      try {
        const { get } = useSettings();
        const settings = get();
        await invoke('set_non_thinking_analysis_enabled', { enabled: settings.enableNonThinkingModelAnalysis });
        console.log('已同步非思考模型分析开关到后端:', settings.enableNonThinkingModelAnalysis);
      } catch (syncErr) {
        console.warn('同步分析开关到后端失败（可能非Tauri环境或服务未启动）:', syncErr);
      }
      
      this.isInitialized = true;
      console.log('应用初始化完成');
    } catch (error) {
      console.error('应用初始化失败:', error);
      throw error;
    }
  }
  
  // 保留此方法以兼容 database.ts 中的引用（虽然现在 database.ts 也不再调用它了，但为了安全起见或者其他可能的引用）
  // 实际上 database.ts 已经不再调用它了，可以移除
  // 但是为了避免破坏其他可能引用它的地方（尽管 grep 没显示），暂且保留空实现或移除
  
  // 原有的 getDatabasePath 等方法如果被引用，需要检查
}

export const initializationService = new InitializationService();
