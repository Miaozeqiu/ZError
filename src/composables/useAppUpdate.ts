import { computed, ref } from 'vue'
import { VersionCheckService, type VersionInfo } from '../services/app/versionCheck'
import {
  downloadUpdatePackage,
  openDownloadedUpdate,
  resolveDownloadFileName,
  resolvePlatformDownloadUrl,
} from '../services/app/updateDownload'
import { environmentDetector } from '../services/app/environmentDetector'

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
/** 本会话内已关闭过的更新弹窗版本，避免反复弹出 */
const DIALOG_SKIP_KEY = 'updateDialogSkippedVersion'
/** 已下载/已安装但尚未重启；下次启动若仍未升到该版本则显示「已就绪」 */
const PENDING_RELAUNCH_KEY = 'updatePendingRelaunchVersion'

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
let checkPromise: Promise<void> | null = null

function markDialogSkipped(version?: string) {
  const ver = version || updateInfo.value?.version
  if (ver && ver !== '?') {
    sessionStorage.setItem(DIALOG_SKIP_KEY, ver)
  }
  showUpdateDialog.value = false
}

function openUpdateDialog(options?: { force?: boolean; version?: string }) {
  const ver = options?.version || updateInfo.value?.version || ''
  if (!options?.force && ver && sessionStorage.getItem(DIALOG_SKIP_KEY) === ver) {
    return
  }
  // 已在下载/安装时不再自动弹窗，避免挡住顶部进度条
  if (
    !options?.force &&
    (status.value === 'downloading' || status.value === 'installing')
  ) {
    return
  }
  showUpdateDialog.value = true
}

function setPendingRelaunch(version: string, packagePath?: string) {
  if (version && version !== '?') {
    localStorage.setItem(PENDING_RELAUNCH_KEY, version)
  }
  if (packagePath) {
    localStorage.setItem('updatePendingPackagePath', packagePath)
  } else {
    localStorage.removeItem('updatePendingPackagePath')
  }
}

function clearPendingRelaunch() {
  localStorage.removeItem(PENDING_RELAUNCH_KEY)
  localStorage.removeItem('updatePendingPackagePath')
}

function restorePendingRelaunchTip(): boolean {
  const pending = localStorage.getItem(PENDING_RELAUNCH_KEY)
  if (!pending) return false
  const current = VersionCheckService.getCurrentVersion()
  // 已经升到待重启版本（或更高）→ 清掉
  if (!VersionCheckService.compareVersions(current, pending)) {
    clearPendingRelaunch()
    return false
  }
  const pendingPath = localStorage.getItem('updatePendingPackagePath') || ''
  updateInfo.value = {
    version: pending,
    changelog: '',
    downloadUrl: '',
  }
  currentVersion.value = current
  tipVisible.value = true
  if (pendingPath) {
    localPath.value = pendingPath
    nativeUpdater.value = false
    status.value = 'done'
  } else {
    nativeUpdater.value = true
    status.value = 'ready-relaunch'
  }
  return true
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
  if (status.value === 'downloading') {
    return progress.value > 0
      ? `正在下载 v${ver} ${progress.value}%`
      : `正在下载 v${ver}…`
  }
  if (status.value === 'installing') {
    return `正在安装 v${ver}…`
  }
  if (status.value === 'ready-relaunch') {
    return `v${ver} 已就绪，点击重启`
  }
  if (status.value === 'done') {
    return `v${ver} 已就绪，点击打开`
  }
  if (status.value === 'error') {
    return errorMessage.value
      ? `v${ver} 更新失败：${errorMessage.value}`
      : `v${ver} 更新失败，点击重试`
  }
  return `发现新版本 v${ver}`
})

const tipTitle = computed(() => {
  if (status.value === 'ready-relaunch' || (status.value === 'done' && nativeUpdater.value)) {
    return '点击重启以完成更新'
  }
  if (status.value === 'done') return '打开已下载的安装包'
  if (status.value === 'error') return '点击重试下载'
  if (status.value === 'available') return '点击开始更新'
  return '软件更新'
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

function humanizeUpdaterError(err: any): string {
  const msg = err?.message || String(err)
  if (/Cross-device link|os error 18|EXDEV|CrossesDevices/i.test(msg)) {
    return '更新临时目录与软件不在同一磁盘。请把 ZError 安装到「应用程序」后再更新'
  }
  if (/Invalid argument|os error 22|EINVAL/i.test(msg)) {
    return '当前不是「应用程序」安装包（开发模式无法原地更新）。请用 DMG 把 ZError 装到 /Applications 后再测更新'
  }
  if (/permission|denied|administrator|Failed to move/i.test(msg)) {
    return '原地更新需要写入权限：请把 ZError 放到「应用程序」后再试；若弹出密码框请允许'
  }
  return msg
}

async function assertNativeUpdaterInstallable() {
  if (!environmentDetector.isTauriEnvironment()) {
    throw new Error('非桌面环境，无法原地更新')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const ok = await invoke<boolean>('can_native_updater_install')
  if (!ok) {
    throw new Error(
      '当前是开发模式（非 .app）。请用 DMG 安装到「应用程序」后再测原地更新；开发态只能测检查/进度 UI，不能真正替换软件',
    )
  }
}

async function startNativeInstall(update: any) {
  await assertNativeUpdaterInstallable()
  nativeUpdater.value = true
  tipVisible.value = true
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

  progress.value = 100
  const ver = update?.version || updateInfo.value?.version || ''
  if (ver) {
    localStorage.setItem(AUTO_DL_KEY, ver)
    setPendingRelaunch(ver)
  }
  status.value = 'installing'
}

async function relaunchApp() {
  // 不在重启前清 pending：若 relaunch 失败，下次打开仍显示「已就绪」；
  // 成功升到新版本后由 restorePendingRelaunchTip 自动清除。
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/** 安装完成后立刻重启；失败则留下「已就绪」供本次点击/下次打开 */
async function finishNativeUpdateAndRelaunch() {
  status.value = 'installing'
  tipVisible.value = true
  try {
    await relaunchApp()
  } catch (err) {
    console.error('自动重启失败:', err)
    status.value = 'ready-relaunch'
    tipVisible.value = true
  }
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
        await finishNativeUpdateAndRelaunch()
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
      setDownloadTarget(url, info.version)

      if (!force && localStorage.getItem(AUTO_DL_KEY) === info.version && localPath.value) {
        status.value = 'done'
        tipVisible.value = true
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
      setPendingRelaunch(info.version, result.filePath)
      tipVisible.value = true
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
  if (checkPromise && !options?.forceDialog) {
    return checkPromise
  }

  const wantDialog = !!options?.forceDialog

  checkPromise = (async () => {
  try {
    // 上次已下载/安装但未完成重启
    if (!wantDialog && restorePendingRelaunchTip()) {
      return
    }

    let suppressAuto = false
    const updateRemindTime = localStorage.getItem('updateRemindTime')
    if (updateRemindTime) {
      const remindTime = new Date(updateRemindTime)
      if (new Date() < remindTime) {
        console.log(`用户选择一周后提醒，提醒时间: ${remindTime.toLocaleString()}`)
        // 仅抑制自动检查的顶部提示/下载；手动「检查更新」仍弹出
        suppressAuto = !wantDialog
      } else {
        localStorage.removeItem('updateRemindTime')
      }
    }

    // 1) 先试原生 updater（tauri.conf → live/update.json）
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
        if (wantDialog) {
          openUpdateDialog({ force: true, version: updateInfo.value?.version })
        }
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
        const shouldShowTip = wantDialog || (!suppressAuto && !dismissed)
        tipVisible.value = shouldShowTip
        status.value = 'available'
        // 仅手动「检查更新」才弹窗；发现更新后不自动下载，等用户点击
        if (wantDialog) {
          openUpdateDialog({ force: true, version: native.version })
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
    const shouldShowTip = wantDialog || (!suppressAuto && !dismissed)
    tipVisible.value = shouldShowTip
    status.value = 'available'
    nativeUpdater.value = false
    setDownloadTarget(
      resolvePlatformDownloadUrl(result.versionInfo),
      result.versionInfo.version,
    )

    if (wantDialog) {
      openUpdateDialog({ force: true, version: result.versionInfo.version })
    }
  } catch (error) {
    console.error('版本检查失败:', error)
  } finally {
    checkPromise = null
  }
  })()

  return checkPromise
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
      openUpdateDialog({ force: true })
    }
    return
  }
  if (status.value === 'done' && localPath.value) {
    try {
      await openDownloadedUpdate(localPath.value)
    } catch (err) {
      console.error('打开安装包失败:', err)
      openUpdateDialog({ force: true })
    }
    return
  }
  if (status.value === 'downloading' || status.value === 'installing') return
  // available：不弹窗，仅从「检查更新」按钮打开详情
  if (status.value === 'available') {
    tipVisible.value = true
    void startAutoDownload()
  }
}

async function handleDialogDownload() {
  tipVisible.value = true
  markDialogSkipped()
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
      await finishNativeUpdateAndRelaunch()
      return
    } catch (err: any) {
      console.error('对话框原生安装失败:', err)
      status.value = 'error'
      errorMessage.value = humanizeUpdaterError(err)
      tipVisible.value = true
      openUpdateDialog({ force: true })
      return
    }
  }

  await startAutoDownload(true)
  const nextStatus = status.value as HeaderUpdateStatus
  if (nextStatus === 'ready-relaunch') {
    await finishNativeUpdateAndRelaunch()
  } else if (nextStatus === 'done' && localPath.value) {
    // 回退安装包：已下载，显示已就绪，等用户点顶部提示打开
    tipVisible.value = true
  }
}

function handleLater() {
  markDialogSkipped()
}

function handleWeekLater() {
  markDialogSkipped()
  const oneWeekLater = new Date()
  oneWeekLater.setDate(oneWeekLater.getDate() + 7)
  localStorage.setItem('updateRemindTime', oneWeekLater.toISOString())
}

function closeDialog() {
  markDialogSkipped()
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
