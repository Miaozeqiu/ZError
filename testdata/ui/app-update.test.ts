// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  downloadPackage: vi.fn(),
  openPackage: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(true) }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('../../src/services/app/environmentDetector', () => ({
  environmentDetector: { isTauriEnvironment: () => true },
}))
vi.mock('../../src/services/app/versionCheck', () => ({
  VersionCheckService: {
    getCurrentVersion: () => '2.2.8',
    checkForUpdate: mocks.checkForUpdate,
  },
}))
vi.mock('../../src/services/app/updateDownload', () => ({
  downloadUpdatePackage: mocks.downloadPackage,
  openDownloadedUpdate: mocks.openPackage,
  resolveDownloadFileName: () => 'ZError_2.2.9_x64-setup.exe',
}))

describe('in-app update action', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('installs one signed update when both update buttons are clicked', async () => {
    mocks.check.mockResolvedValue({ version: '2.2.9', downloadAndInstall: mocks.downloadAndInstall })
    const state = (await import('../../src/composables/useAppUpdate')).useAppUpdate()
    await state.checkForUpdates({ forceDialog: true })
    expect(state.tipTitle.value).toBe('点击更新并重启')
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled()

    await Promise.all([state.handleTipClick(), state.handleDialogDownload()])
    expect(mocks.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(mocks.relaunch).toHaveBeenCalledTimes(1)
    expect(mocks.downloadPackage).not.toHaveBeenCalled()
  })

  it('downloads a regular installer without opening it or restarting the app', async () => {
    mocks.check.mockResolvedValue(null)
    mocks.checkForUpdate.mockResolvedValue({
      needsUpdate: true, currentVersion: '2.2.8',
      versionInfo: { version: '2.2.9', changelog: '', downloadUrl: 'https://example.com/setup.exe' },
    })
    mocks.downloadPackage.mockResolvedValue({ filePath: 'setup.exe' })
    const state = (await import('../../src/composables/useAppUpdate')).useAppUpdate()
    await state.checkForUpdates()
    expect(state.tipTitle.value).toBe('点击下载安装包')

    await state.handleTipClick()
    expect(state.status.value).toBe('done')
    expect(mocks.downloadPackage).toHaveBeenCalledTimes(1)
    expect(mocks.openPackage).not.toHaveBeenCalled()
    expect(mocks.relaunch).not.toHaveBeenCalled()
  })
})
