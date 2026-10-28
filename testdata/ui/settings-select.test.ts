// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import SettingsSelect from '../../src/components/ui/SettingsSelect.vue'

let app: App
let root: HTMLDivElement
const state = reactive({ mode: 'strict' })
const options = [{ value: 'explore', label: '常规' }, { value: 'strict', label: '严格' }]
const trigger = (id = 'first') => root.querySelector<HTMLButtonElement>(`#${id}`)!
const menu = (id = 'first') => document.querySelector<HTMLElement>(`#${id}-options`)
const press = async (element: HTMLElement, key: string) => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await nextTick()
}
beforeEach(() => {
  state.mode = 'strict'
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('div', ['first', 'second'].map(id => h(SettingsSelect, {
    id, label: '网页操作', modelValue: state.mode, options,
    'onUpdate:modelValue': (value: string) => { state.mode = value },
  }))) })
  app.mount(root)
})
afterEach(async () => { app.unmount(); root.remove(); await nextTick(); vi.restoreAllMocks() })

describe('settings dropdown interaction', () => {
  it('supports arrow keys, selection and returning focus to its trigger', async () => {
    await press(trigger(), 'ArrowDown')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('严格'))
    await press(menu()!, 'ArrowUp')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('常规'))
    await press(menu()!, 'Enter')
    expect(state.mode).toBe('explore')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })
  it('keeps only one menu open and dismisses it with Escape or outside input', async () => {
    trigger().click(); await nextTick()
    trigger('second').click(); await nextTick()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger('second').getAttribute('aria-expanded')).toBe('true')
    await press(menu('second')!, 'Escape')
    expect(document.activeElement).toBe(trigger('second'))
    expect(trigger('second').getAttribute('aria-expanded')).toBe('false')
    trigger().click(); await nextTick()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(state.mode).toBe('strict')
  })
  it('opens above near the viewport bottom and closes on page scroll', async () => {
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
      x: 20, y: window.innerHeight - 48, top: window.innerHeight - 48,
      bottom: window.innerHeight - 10, left: 20, right: 168, width: 148, height: 38,
      toJSON: () => ({}),
    })
    trigger().click(); await nextTick()
    expect(menu()!.classList.contains('opens-above')).toBe(true)
    expect(parseFloat(menu()!.style.top)).toBeLessThan(window.innerHeight - 48)
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })
})
