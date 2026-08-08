import { computed, ref } from 'vue'
import { VersionCheckService, type VersionInfo } from '../services/versionCheck'
import {
  downloadUpdatePackage,
  openDownloadedUpdate,
  resolveDownloadFileName,
  resolvePlatformDownloadUrl,
} from '../services/updateDownload'
import { environmentDetector } from '../services/environmentDetector'

export type HeaderUpdateStatus =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'ready-relaunch'
  | 'error'

const DISMISS_KEY = 'updateHeaderDismissedVersion'
const AUTO_DL_KEY = 'updateAutoDownloadedVersion'

const updateInfo = ref<VersionInfo | null>(null)
const currentVersion = ref(VersionCheckService.getCurrentVersion())
const status = ref<HeaderUpdateStatus>('idle')
const progress = ref(0)
const localPath = ref('')
const errorMessage = ref('')
const tipVisible = ref(false)
const showUpdateDialog = ref(false)
/** true = 官方 updater 原地安装（Mac 无需拖 DMG） */
const nativeUpdater = ref(false)
/** 当前下载的文件名（如 ZError_x.app.tar.gz / .dmg），便于确认下的是哪一种包 */
const downloadFileName = ref('')
const downloadUrl = ref('')

let downloadPromise: Promise<void> | null = null

function fileLabel(name: string): string {
  if (!name) return ''
  if (/\.app\.tar\.gz$/i.test(name) || /\.tar\.gz$/i.test(name)) return `${name}（原地更新包）`
  if (/\.dmg$/i.test(name)) return `${name}（Mac 安装映像）`
  if (/\.exe$/i.test(name)) return `${name}（Windows 安装包）`
  return name
}

function pickNativePackageUrl(update: any): string {
  const raw = update?.rawJson
  if (!raw || typeof raw !== 'object') return ''
  const platforms = (raw as any).platforms
  if (!platforms || typeof platforms !== 'object') return ''
  const isMac = typeof navigator !== 'undefined' && (
    /mac/i.test(navigator.platform || '') || /mac/i.test(navigator.userAgent || '')
  )
  const keys = isMac
    ? ['darwin-aarch64', 'darwin-x86_64', 'darwin-arm64']
    : ['windows-x86_64', 'windows-aarch64', 'windows-i686']
  for (const key of keys) {
    const url = platforms[key]?.url
    if (typeof url === 'string' && url) return url
  }
  for (const item of Object.values(platforms) as any[]) {
    if (item && typeof item.url === 'string' && item.url) return item.url
  }
  return ''
}

function setDownloadTarget(url: string, version: string, fileName?: string) {
  downloadUrl.value = url || ''
  downloadFileName.value = fileName || resolveDownloadFileName(url, version)
}

const tipText = computed(() => {
  const ver = updateInfo.value?.version
  if (!ver) return ''
  const file = fileLabel(downloadFileName.value)
  if (status.value === 'downloading') {
    const pct = progress.value > 0 ? ` ${progress.value}%` : '…'
    if (file) {
      return nativeUpdater.value
        ? `正在下载 v${ver}${pct} · ${file}`
        : `正在下载安装包 v${ver}${pct} · ${file}`
    }
    return progress.value > 0
      ? `正在下载 v${ver} ${progress.value}%`
      : `正在下载 v${ver}…`
  }
  if (status.value === 'installing') {
    return file
      ? `正在安装 v${ver} · ${file}`
      : `正在安装 v${ver}…`
  }
  if (status.value === 'ready-relaunch') {
    return file
      ? `v${ver} 已就绪（${file}），点击重启`
      : `v${ver} 已就绪，点击重启`
  }
  if (status.value === 'done') {
    return nativeUpdater.value
      ? `v${ver} 已安装，点击重启`
      : (file ? `v${ver} 已下载 ${file}，点击打开` : `v${ver} 已下载，点击打开`)
  }
  if (status.value === 'error') {
    return errorMessage.value
      ? `v${ver} 更新失败：${errorMessage.value}`
      : `v${ver} 更新失败，点击重试`
  }
  return `发现新版本 v${ver}`
})

const tipTitle = computed(() => {
  if (downloadUrl.value) return downloadUrl.value
  if (downloadFileName.value) return downloadFileName.value
  if (status.value === 'done') return '打开已下载的安装包'
  if (status.value === 'error') return '点击重试下载'
  return '查看更新详情'
})

const hasUpdate = computed(() => !!updateInfo.value)

const nativeCheckError = ref('')

async function tryNativeUpdaterCheck(): Promise<{
  available: boolean
  version?: string
  notes?: string
  update?: any
  error?: string
} | null> {
  if (!environmentDetector.isTauriEnvironment()) return null
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    nativeCheckError.value = ''
    if (!update) return { available: false }
    return {
      available: true,
      version: update.version,
      notes: update.body || '',
      update,
    }
  } catch (err: any) {
    const msg = err?.message || String(err)
    nativeCheckError.value = msg
    console.warn('原生 updater 检查失败:', err)
    return { available: false, error: msg }
  }
}

async function startNativeInstall(update: any) {
  nativeUpdater.value = true
  status.value = 'downloading'
  progress.value = 0
  errorMessage.value = ''
  const pkgUrl = pickNativePackageUrl(update)
  setDownloadTarget(pkgUrl, update?.version || updateInfo.value?.version || '')

  let downloaded = 0
  let contentLength = 0

  await update.downloadAndInstall((event: any) => {
    switch (event?.event) {
      case 'Started':
        contentLength = event.data?.contentLength || 0
        status.value = 'downloading'
        break
      case 'Progress': {
        downloaded += event.data?.chunkLength || 0
        if (contentLength > 0) {
          progress.value = Math.min(99, Math.round((downloaded / contentLength) * 100))
        }
        break
      }
      case 'Finished':
        progress.value = 100
        status.value = 'installing'
        break
    }
  })

  status.value = 'ready-relaunch'
  progress.value = 100
  if (updateInfo.value?.version) {
    localStorage.setItem(AUTO_DL_KEY, updateInfo.value.version)
  }
}

async function relaunchApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

async function startAutoDownload(force = false) {
  const info = updateInfo.value
  if (!info) return
  if (downloadPromise && !force) return downloadPromise

  if (!force && localStorage.getItem(AUTO_DL_KEY) === info.version && status.value === 'ready-relaunch') {
    return
  }

  downloadPromise = (async () => {
    try {
      // 优先：原生 updater（Mac 原地替换 .app，无需拖拽）
      const native = await tryNativeUpdaterCheck()
      if (native?.error) {
        status.value = 'error'
        errorMessage.value = `原生更新不可用：${native.error}`
        tipVisible.value = true
        return
      }
      if (native?.available && native.update) {
        tipVisible.value = true
        updateInfo.value = {
          version: native.version || info.version,
          changelog: native.notes || info.changelog || '',
          downloadUrl: resolvePlatformDownloadUrl(info) || info.downloadUrl,
          releaseDate: info.releaseDate,
        }
        await startNativeInstall(native.update)
        return
      }

      // 回退：仅当原生检查明确「无更新通道」时才下安装包；联调期尽量不用
      nativeUpdater.value = false
      const url = resolvePlatformDownloadUrl(info)
      if (!url) {
        status.value = 'error'
        errorMessage.value = '未配置下载地址'
        return
      }
      // 如果回退地址仍是 .app.tar.gz，也标清楚，避免误当成 DMG
      setDownloadTarget(url, info.version)

      if (!force && localStorage.getItem(AUTO_DL_KEY) === info.version && localPath.value) {
        status.value = 'done'
        return
      }

      status.value = 'downloading'
      progress.value = 0
      errorMessage.value = ''

      const result = await downloadUpdatePackage(info, (p) => {
        progress.value = p.percent
      })
      localPath.value = result.filePath
      downloadFileName.value = result.fileName || downloadFileName.value
      status.value = 'done'
      progress.value = 100
      localStorage.setItem(AUTO_DL_KEY, info.version)
    } catch (err: any) {
      console.error('自动更新失败:', err)
      status.value = 'error'
      errorMessage.value = err?.message || String(err)
    } finally {
      downloadPromise = null
    }
  })()

  return downloadPromise
}

async function checkForUpdates(options?: { forceDialog?: boolean }) {
  try {
    let suppressDialog = false
    const updateRemindTime = localStorage.getItem('updateRemindTime')
    if (updateRemindTime) {
      const remindTime = new Date(updateRemindTime)
      if (new Date() < remindTime) {
        console.log(`用户选择一周后提醒，提醒时间: ${remindTime.toLocaleString()}`)
        suppressDialog = !options?.forceDialog
      } else {
        localStorage.removeItem('updateRemindTime')
      }
    }

    // 1) 先试原生 updater（tauri.conf → https://webapi.zaizhexue.top/live/update.json）
    const native = await tryNativeUpdaterCheck()
    if (native !== null) {
      if (native.error) {
        // 不再静默回退 DMG：把真实错误亮出来
        currentVersion.value = VersionCheckService.getCurrentVersion()
        updateInfo.value = { version: '?', changelog: '', downloadUrl: '' }
        try {
          const legacy = await VersionCheckService.checkForUpdate()
          if (legacy.versionInfo) {
            updateInfo.value = legacy.versionInfo
            setDownloadTarget(
              resolvePlatformDownloadUrl(legacy.versionInfo),
              legacy.versionInfo.version,
            )
          }
        } catch {
          /* ignore */
        }
        status.value = 'error'
        errorMessage.value = `原生更新检查失败：${native.error}`
        tipVisible.value = true
        if (!suppressDialog) showUpdateDialog.value = true
        return
      }
      if (native.available && native.version) {
        updateInfo.value = {
          version: native.version,
          changelog: native.notes || '',
          downloadUrl: '',
        }
        setDownloadTarget(
          pickNativePackageUrl(native.update),
          native.version || '',
        )
        currentVersion.value = VersionCheckService.getCurrentVersion()
        const dismissed = localStorage.getItem(DISMISS_KEY) === native.version
        tipVisible.value = !dismissed
        status.value = 'available'
        if (!suppressDialog) showUpdateDialog.value = true
        // 有 platforms 签名包时只走原地安装，失败不再偷偷改下 DMG（否则还要拖拽）
        if (!dismissed) {
          downloadPromise = (async () => {
            try {
              await startNativeInstall(native.update)
            } catch (err: any) {
              console.error('原生安装失败:', err)
              status.value = 'error'
              const msg = err?.message || String(err)
              errorMessage.value =
                /permission|denied|administrator|Failed to move/i.test(msg)
                  ? '原地更新需要写入权限：请把 ZError 放到「应用程序」后再试；若弹出密码框请允许'
                  : `原地更新失败：${msg}`
              tipVisible.value = true
            } finally {
              downloadPromise = null
            }
          })()
        }
        return
      }

      // update.json 可达且无新版本（或尚无完整 platforms）
      tipVisible.value = false
      updateInfo.value = null
      status.value = 'idle'
      return
    }

    // 2) 回退：用 latest_version.json 的 downloadUrl* 下载安装包
    const result = await VersionCheckService.checkForUpdate()
    currentVersion.value = result.currentVersion

    if (!result.needsUpdate || !result.versionInfo) {
      tipVisible.value = false
      updateInfo.value = null
      status.value = 'idle'
      return
    }

    updateInfo.value = result.versionInfo
    const dismissed = localStorage.getItem(DISMISS_KEY) === result.versionInfo.version
    tipVisible.value = !dismissed
    status.value = 'available'
    nativeUpdater.value = false
    setDownloadTarget(
      resolvePlatformDownloadUrl(result.versionInfo),
      result.versionInfo.version,
    )

    if (!suppressDialog) {
      showUpdateDialog.value = true
    }

    if (!dismissed) {
      void startAutoDownload()
    }
  } catch (error) {
    console.error('版本检查失败:', error)
  }
}

function dismissTip() {
  if (updateInfo.value?.version) {
    localStorage.setItem(DISMISS_KEY, updateInfo.value.version)
  }
  tipVisible.value = false
}

async function handleTipClick() {
  if (status.value === 'error') {
    tipVisible.value = true
    await startAutoDownload(true)
    return
  }
  if (status.value === 'ready-relaunch' || (status.value === 'done' && nativeUpdater.value)) {
    try {
      await relaunchApp()
    } catch (err) {
      console.error('重启失败:', err)
      showUpdateDialog.value = true
    }
    return
  }
  if (status.value === 'done' && localPath.value) {
    try {
      await openDownloadedUpdate(localPath.value)
    } catch (err) {
      console.error('打开安装包失败:', err)
      showUpdateDialog.value = true
    }
    return
  }
  if (status.value === 'downloading' || status.value === 'installing') return
  showUpdateDialog.value = true
}

async function handleDialogDownload() {
  tipVisible.value = true
  showUpdateDialog.value = false
  if (status.value === 'ready-relaunch' || (status.value === 'done' && nativeUpdater.value)) {
    await relaunchApp()
    return
  }
  if (status.value === 'done' && localPath.value) {
    // 仅打开真正的安装包；.app.tar.gz 不能当 DMG 打开
    await openDownloadedUpdate(localPath.value)
    return
  }

  // 优先再试原生 updater（Mac 原地替换，无需拖拽）
  const native = await tryNativeUpdaterCheck()
  if (native?.available && native.update) {
    try {
      await startNativeInstall(native.update)
      if ((status.value as HeaderUpdateStatus) === 'ready-relaunch') {
        await relaunchApp()
      }
      return
    } catch (err: any) {
      console.error('对话框原生安装失败:', err)
      status.value = 'error'
      errorMessage.value = err?.message || String(err)
      tipVisible.value = true
      showUpdateDialog.value = true
      return
    }
  }

  await startAutoDownload(true)
  const nextStatus = status.value as HeaderUpdateStatus
  if (nextStatus === 'ready-relaunch') {
    await relaunchApp()
  } else if (nextStatus === 'done' && localPath.value) {
    await openDownloadedUpdate(localPath.value)
  }
}

function handleLater() {
  showUpdateDialog.value = false
}

function handleWeekLater() {
  showUpdateDialog.value = false
  const oneWeekLater = new Date()
  oneWeekLater.setDate(oneWeekLater.getDate() + 7)
  localStorage.setItem('updateRemindTime', oneWeekLater.toISOString())
}

function closeDialog() {
  showUpdateDialog.value = false
}

export function useAppUpdate() {
  return {
    updateInfo,
    currentVersion,
    status,
    progress,
    localPath,
    errorMessage,
    tipVisible,
    tipText,
    tipTitle,
    downloadFileName,
    downloadUrl,
    hasUpdate,
    showUpdateDialog,
    nativeUpdater,
    checkForUpdates,
    startAutoDownload,
    dismissTip,
    handleTipClick,
    handleDialogDownload,
    handleLater,
    handleWeekLater,
    closeDialog,
  }
}
