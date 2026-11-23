// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), setSetting: vi.fn(), save: vi.fn(), theme: vi.fn(), clipboard: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: mocks.clipboard }))
vi.mock('../../src/composables/useSettingsManager', async () => {
  const { ref } = await import('vue')
  return { useSettingsManager: () => ({ settings: ref({ theme: 'light', autoAddToQuestionBank: true, questionSaveFolderId: null, network: { serverPort: 3000, enableLanAccess: false, bindAddress: '127.0.0.1' } }), setSetting: mocks.setSetting, saveSettings: mocks.save }) }
})
vi.mock('../../src/composables/useTheme', () => ({ useTheme: () => ({ setTheme: mocks.theme }) }))
vi.mock('../../src/services/app/environmentDetector', () => ({ environmentDetector: { isTauriEnvironment: true } }))
vi.mock('../../src/components/ui/FolderPickerDialog.vue', () => ({ default: { render: () => null } }))
import GeneralSettings from '../../src/views/settings/GeneralSettings.vue'
let app: App, root: HTMLElement
const flush = async () => { await vi.dynamicImportSettled(); await nextTick() }
const button = (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
beforeEach(async () => {
  vi.resetAllMocks(); mocks.save.mockResolvedValue(undefined); mocks.theme.mockResolvedValue(undefined)
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(GeneralSettings) }); app.mount(root); await flush()
})
afterEach(() => { app.unmount(); root.remove() })
describe('settings user flows before release', () => {
  it('saves the selected theme and sends it to the shared theme manager', async () => {
    const dark = root.querySelector<HTMLInputElement>('input[value="dark"]')!; dark.checked = true; dark.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    expect(mocks.setSetting).toHaveBeenCalledWith('theme', 'dark'); expect(mocks.theme).toHaveBeenCalledWith('dark'); expect(mocks.save).toHaveBeenCalled()
  })
  it('copies installation instructions without installing or choosing an Agent in the app', async () => {
    let done!: () => void
    mocks.clipboard.mockReturnValue(new Promise<void>(resolve => { done=resolve }))
    const copy=button('复制安装语句');copy.click();await flush()
    expect(copy.disabled).toBe(true)
    const instruction=mocks.clipboard.mock.calls[0][0]
    expect(root.querySelector('.skill-install-instruction')?.textContent).toBe(instruction)
    expect(instruction).toContain('自行确定适合的安装方式和技能目录')
    expect(instruction).not.toContain('--agent')
    expect(instruction).not.toContain('--dir')
    expect(instruction).toContain('https://open.zerrorai.com/v1/agent-skills/zerror')
    expect(root.querySelector('[aria-label="安装 Skill 的 Agent"]')).toBeNull()
    expect(root.textContent).not.toContain('更新已安装')
    expect(mocks.invoke).not.toHaveBeenCalled()
    done();await flush()
    expect(root.querySelector('.skill-install-setting [role="status"]')).toBeNull()
    expect(copy.disabled).toBe(false)
  })
  it('allows retry after clipboard failure without claiming an installation', async () => {
    mocks.clipboard.mockRejectedValueOnce(new Error('clipboard unavailable'))
    button('复制安装语句').click();await flush()
    expect(root.textContent).toContain('复制失败，请重试。')
    expect(button('复制安装语句').disabled).toBe(false)
    mocks.clipboard.mockResolvedValueOnce(undefined)
    button('复制安装语句').click();await flush()
    expect(root.querySelector('.skill-install-setting [role="status"]')).toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
