/**
 * 将新版本安装包下载到系统「下载」目录。
 */

import type { VersionInfo } from './versionCheck'
import { environmentDetector } from './environmentDetector'

export type UpdateDownloadProgress = {
  received: number
  total: number
  percent: number
}

export type UpdateDownloadResult = {
  fileName: string
  filePath: string
}

const guessFileName = (url: string, version: string) => {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    // 含 .app.tar.gz（Tauri 更新包）；勿误存成 .dmg，否则系统会当磁盘映像打开并报「已损坏」
    if (last && /\.(dmg|exe|zip|msi|AppImage|pkg|app\.tar\.gz|tar\.gz|tgz)(\?|$)/i.test(last)) {
      return decodeURIComponent(last.split('?')[0])
    }
  } catch {
    /* ignore */
  }
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  return isMac ? `ZError_${version}.dmg` : `ZError_Setup_${version}.exe`
}

/** 从下载 URL 解析文件名（供 UI 展示） */
export const resolveDownloadFileName = (url: string, version = ''): string => {
  if (!url) return ''
  return guessFileName(url, version || 'unknown')
}

/** 可直接用系统打开的安装包（DMG/EXE…）；.app.tar.gz 只能给原生 updater，不能 openPath */
export const isOpenableInstallerPath = (filePath: string): boolean =>
  /\.(dmg|exe|zip|msi|pkg|AppImage)$/i.test(filePath.split('?')[0] || '')

/** 按当前系统挑选下载地址（兼容旧字段 downloadUrl） */
export const resolvePlatformDownloadUrl = (info: VersionInfo): string => {
  const isMac = typeof navigator !== 'undefined' && (
    /mac/i.test(navigator.platform || '') || /mac/i.test(navigator.userAgent || '')
  )
  if (isMac) {
    return info.downloadUrlMac || info.downloadUrlDarwin || info.downloadUrl || ''
  }
  return info.downloadUrlWin || info.downloadUrlWindows || info.downloadUrl || ''
}

export async function downloadUpdatePackage(
  info: VersionInfo,
  onProgress?: (p: UpdateDownloadProgress) => void,
): Promise<UpdateDownloadResult> {
  const url = resolvePlatformDownloadUrl(info)
  if (!url) {
    throw new Error('未提供下载地址')
  }

  const fileName = guessFileName(url, info.version)

  if (!environmentDetector.isTauriEnvironment()) {
    window.open(url, '_blank')
    return { fileName, filePath: url }
  }

  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
  const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const { downloadDir, join } = await import('@tauri-apps/api/path')

  const response = await tauriFetch(url, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') || 0)
  const chunks: Uint8Array[] = []
  let received = 0

  if (response.body && typeof (response.body as any).getReader === 'function') {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.length) {
        chunks.push(value)
        received += value.length
        onProgress?.({
          received,
          total,
          percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
        })
      }
    }
  } else {
    const buf = new Uint8Array(await response.arrayBuffer())
    chunks.push(buf)
    received = buf.length
    onProgress?.({ received, total: total || received, percent: 100 })
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }

  await writeFile(fileName, bytes, {
    baseDir: BaseDirectory.Download,
  })

  onProgress?.({ received, total: total || received, percent: 100 })

  const dir = await downloadDir()
  const filePath = await join(dir, fileName)
  return { fileName, filePath }
}

export async function openDownloadedUpdate(filePath: string) {
  if (!filePath) return
  if (!isOpenableInstallerPath(filePath)) {
    throw new Error('该文件是更新包而非安装映像，请使用应用内更新或下载 DMG 安装包')
  }
  if (!environmentDetector.isTauriEnvironment()) {
    window.open(filePath, '_blank')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('clear_macos_quarantine', { path: filePath })
  } catch (e: any) {
    const msg = String(e?.message || e || '')
    if (msg.includes('不是 DMG') || msg.includes('tar.gz')) throw e
    /* 非 mac / 无权限时忽略 */
  }

  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(filePath)
}
