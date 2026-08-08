/**
 * 版本检查服务
 * 负责检查软件更新和版本比较
 */

import { environmentDetector } from './environmentDetector';

export interface VersionInfo {
  version: string;
  changelog: string;
  downloadUrl: string;
  /** macOS 安装包（可选；缺省回退 downloadUrl） */
  downloadUrlMac?: string;
  downloadUrlDarwin?: string;
  /** Windows 安装包（可选；缺省回退 downloadUrl） */
  downloadUrlWin?: string;
  downloadUrlWindows?: string;
  releaseDate?: string;
  /** Tauri Updater 字段（与 changelog 并存时可写 notes） */
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, { url: string; signature: string }>;
}

export class VersionCheckService {
  private static readonly API_URL = 'https://webapi.zaizhexue.top/live/latest_version.json';
  private static readonly CURRENT_VERSION = '2.2.7'; // 当前软件版本

  private static getApiUrls(): string[] {
    return [VersionCheckService.API_URL];
  }

  /**
   * 获取最新版本信息
   */
  public static async getLatestVersion(): Promise<VersionInfo | null> {
    const urls = VersionCheckService.getApiUrls();
    let lastError: unknown = null;

    for (const url of urls) {
      try {
        let response: Response;

        if (environmentDetector.isTauriEnvironment()) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          response = await tauriFetch(url);
        } else {
          response = await fetch(url);
        }

        if (!response.ok) {
          lastError = new Error(`HTTP error! status: ${response.status} (${url})`);
          continue;
        }

        const data = await response.json();
        const info = data as VersionInfo;
        // 兼容 Tauri 清单用 notes 字段
        if (!info.changelog && info.notes) {
          info.changelog = info.notes;
        }
        return info;
      } catch (error) {
        lastError = error;
        console.warn(`获取版本信息失败 (${url}):`, error);
      }
    }

    console.error('获取版本信息失败:', lastError);
    return null;
  }

  /**
   * 比较版本号
   * @param currentVersion 当前版本
   * @param latestVersion 最新版本
   * @returns 如果最新版本更高则返回true
   */
  public static compareVersions(currentVersion: string, latestVersion: string): boolean {
    try {
      // 移除版本号中的非数字字符（如 "bata", "beta" 等）
      const cleanCurrent = currentVersion.replace(/[^\d.]/g, '');
      const cleanLatest = latestVersion.replace(/[^\d.]/g, '');

      const currentParts = cleanCurrent.split('.').map(Number);
      const latestParts = cleanLatest.split('.').map(Number);

      // 确保两个版本号长度一致
      const maxLength = Math.max(currentParts.length, latestParts.length);

      for (let i = 0; i < maxLength; i++) {
        const current = currentParts[i] || 0;
        const latest = latestParts[i] || 0;

        if (latest > current) {
          return true; // 需要更新
        } else if (latest < current) {
          return false; // 当前版本更高
        }
      }

      return false; // 版本相同
    } catch (error) {
      console.error('版本比较失败:', error);
      return false;
    }
  }

  /**
   * 检查是否需要更新
   */
  public static async checkForUpdate(): Promise<{
    needsUpdate: boolean;
    versionInfo?: VersionInfo;
    currentVersion: string;
  }> {
    try {
      const latestVersionInfo = await this.getLatestVersion();

      if (!latestVersionInfo) {
        return {
          needsUpdate: false,
          currentVersion: this.CURRENT_VERSION
        };
      }

      const needsUpdate = this.compareVersions(this.CURRENT_VERSION, latestVersionInfo.version);

      console.log(`版本检查结果: 当前版本 ${this.CURRENT_VERSION}, 最新版本 ${latestVersionInfo.version}, 需要更新: ${needsUpdate}`);

      return {
        needsUpdate,
        versionInfo: latestVersionInfo,
        currentVersion: this.CURRENT_VERSION
      };
    } catch (error) {
      console.error('检查更新失败:', error);
      return {
        needsUpdate: false,
        currentVersion: this.CURRENT_VERSION
      };
    }
  }

  /**
   * 获取当前版本
   */
  public static getCurrentVersion(): string {
    return this.CURRENT_VERSION;
  }

  /**
   * 格式化更新日志
   * @param changelog 原始更新日志
   * @returns 格式化后的更新日志数组
   */
  public static formatChangelog(changelog: string): string[] {
    return changelog
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.trim());
  }
}

export const versionCheckService = new VersionCheckService();