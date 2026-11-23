// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), setSetting: vi.fn(), save: vi.fn(), theme: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
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
  it('installs the selected external Agent skill, disables duplicate submission and displays the result', async () => {
    let done!: (value: unknown) => void
    mocks.invoke.mockReturnValue(new Promise(resolve => { done=resolve }))
    const select = root.querySelector<HTMLSelectElement>('[aria-label="安装 Skill 的 Agent"]')!; select.value='claude'; select.dispatchEvent(new Event('change', { bubbles:true })); await flush()
    button('安装').click(); await flush(); expect(button('安装').disabled).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('cli_skill_install', { agent:'claude' })
    done({version:'1.0.0',path:'/test/skills/zerror'}); await flush(); expect(root.textContent).toContain('已安装 v1.0.0'); expect(button('安装').disabled).toBe(false)
  })
  it('shows partial update errors and allows a later retry', async () => {
    mocks.invoke.mockResolvedValueOnce({ok:false,installations:[{ok:false,error:'本地修改已保留'}]})
    button('更新已安装').click(); await flush(); expect(root.textContent).toContain('本地修改已保留')
    mocks.invoke.mockResolvedValueOnce({ok:true,installations:[]}); button('更新已安装').click(); await flush(); expect(root.textContent).toContain('尚未安装 Skill')
  })
  it('recovers the install button after a native command failure', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('Open unavailable'))
    button('安装').click(); await flush(); expect(root.textContent).toContain('Open unavailable'); expect(button('安装').disabled).toBe(false)
  })
})
