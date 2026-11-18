// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
const native = vi.hoisted(() => ({ invoke: vi.fn(), clipboard: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: native.clipboard }))
import SecureSecretInput from '../../src/components/ui/SecureSecretInput.vue'
let app: App, root: HTMLDivElement
const reference = '{{secret:site/example.test/password}}'
const model = ref(reference)
const mount = (kind: 'password' | 'api' = 'password') => {
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(SecureSecretInput, { kind, modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value } }) })
  app.mount(root)
}
const field = () => root.querySelector('input')!
const click = (label: string) => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()
beforeEach(() => { native.invoke.mockReset(); native.clipboard.mockClear(); model.value = reference; mount() })
afterEach(() => { app.unmount(); root.remove(); vi.useRealTimers() })
describe('system-verified saved credential fields', () => {
  it('requests native verification before revealing, never writes the revealed value into settings, and hides after 30 seconds', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    native.invoke.mockReturnValue(new Promise(done => { resolve = done }))
    click('查看密码'); await nextTick()
    expect(field().value).toBe('')
    expect(native.invoke).toHaveBeenCalledWith('secure_secret_action', { reference, action: 'reveal' })
    resolve({ value: 'synthetic-password' }); await nextTick(); await nextTick()
    expect(field().value).toBe('synthetic-password'); expect(field().type).toBe('text')
    expect(model.value).toBe(reference)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(field().value).toBe(''); expect(field().type).toBe('password')
  })
  it('keeps cancelled authentication hidden and performs a fresh native check when copying saved values', async () => {
    native.invoke.mockRejectedValueOnce(new Error('已取消系统验证，未显示或复制凭据'))
    click('查看密码'); await nextTick(); await nextTick()
    expect(field().value).toBe(''); expect(root.querySelector('.secret-feedback')).toBeNull()
    native.invoke.mockResolvedValueOnce({ copied: true })
    click('复制密码'); await nextTick(); await nextTick()
    expect(native.invoke).toHaveBeenLastCalledWith('secure_secret_action', { reference, action: 'copy' })
    expect(native.clipboard).not.toHaveBeenCalled(); expect(field().value).toBe(''); expect(model.value).toBe(reference)
  })
  it('still reports verification failures while keeping the saved password hidden', async () => {
    native.invoke.mockRejectedValueOnce('系统身份验证未通过，请重试')
    click('查看密码'); await nextTick(); await nextTick()
    expect(root.querySelector('.secret-feedback')?.textContent).toBe('系统身份验证未通过，请重试')
    expect(field().value).toBe(''); expect(model.value).toBe(reference)
  })
  it('discards a late result after switching records and clears visible text when the app loses focus', async () => {
    let resolve!: (value: unknown) => void
    native.invoke.mockReturnValueOnce(new Promise(done => { resolve = done }))
    click('查看密码'); model.value = '{{secret:site/another.test/password}}'; await nextTick()
    resolve({ value: 'stale-password' }); await nextTick(); await nextTick()
    expect(field().value).toBe('')
    native.invoke.mockResolvedValueOnce({ value: 'new-password' })
    click('查看密码'); await nextTick(); await nextTick()
    expect(field().value).toBe('new-password')
    window.dispatchEvent(new Event('blur')); await nextTick()
    expect(field().value).toBe('')
  })
  it('preserves newly typed text across secure autosave, and drops its edit buffer on blur', async () => {
    field().dispatchEvent(new FocusEvent('focus'))
    field().value = 'newly-typed-value'; field().dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    expect(model.value).toBe('newly-typed-value')
    model.value = reference; await nextTick()
    expect(field().value).toBe('newly-typed-value')
    field().dispatchEvent(new FocusEvent('blur')); await nextTick()
    expect(field().value).toBe('')
    expect(native.invoke.mock.calls.every(([command]) => command === 'secure_site_password_length')).toBe(true)
  })

  it('masks saved API keys using only the current key length', async () => {
    app.unmount()
    root.remove()
    const first = '{{secret:model/first/apiKey}}'
    const second = '{{secret:model/second/apiKey}}'
    let finishFirst!: (length: number) => void
    native.invoke.mockReset()
    native.invoke.mockReturnValueOnce(new Promise<number>(resolve => { finishFirst = resolve }))
    native.invoke.mockResolvedValueOnce(24)
    model.value = first
    mount('api')
    model.value = second
    await vi.waitFor(() => expect(field().placeholder).toBe('•'.repeat(24)))
    finishFirst(12)
    await nextTick()
    await nextTick()

    expect(native.invoke.mock.calls).toEqual([
      ['secure_api_key_length', { reference: first }],
      ['secure_api_key_length', { reference: second }],
    ])
    expect(field().placeholder).toBe('•'.repeat(24))
    expect(field().value).toBe('')
    expect(field().type).toBe('password')
    expect(model.value).toBe(second)
  })
})
