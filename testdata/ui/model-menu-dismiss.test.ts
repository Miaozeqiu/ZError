// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import ModelContextMenu from '../../src/views/settings/ModelSettings/ModelContextMenu.vue'
import UnifiedContextMenu from '../../src/components/ui/UnifiedContextMenu.vue'

let app: App | undefined
let root: HTMLDivElement | undefined
afterEach(async () => {
  app?.unmount(); root?.remove()
  app = undefined; root = undefined
  await nextTick()
})

async function mountMenu(modelMenu = true) {
  const state = reactive({ visible: false })
  const select = vi.fn(), testModel = vi.fn(() => { state.visible = false })
  root = document.createElement('div'); document.body.appendChild(root)
  app = createApp({ render: () => h('div', [
    h('button', { class: 'model-row', onClick: select }, '另一个模型'),
    h(modelMenu ? ModelContextMenu : UnifiedContextMenu, {
      visible: state.visible, x: 20, y: 20,
      ...(modelMenu ? { model: { id: 'fixture', displayName: '测试模型' }, onTestModel: testModel }
        : { menuItems: [{ id: 'test', label: '测试' }] }),
      onClose: () => { state.visible = false },
    }),
  ]) })
  app.mount(root)
  await nextTick()
  state.visible = true
  await nextTick()
  // 菜单在展开后的下一轮事件中绑定外部监听，与真实点击顺序一致。
  await new Promise(resolve => setTimeout(resolve, 0))
  const row = root.querySelector<HTMLButtonElement>('.model-row')!
  return { state, row, select, testModel }
}

it('菜单展开时按下再点击模型只关闭菜单，下一次点击才能切换选中', async () => {
  const { state, row, select } = await mountMenu()
  row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  await nextTick()
  row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
  row.click()
  await nextTick()
  expect(state.visible).toBe(false)
  expect(select).not.toHaveBeenCalled()
  row.click()
  expect(select).toHaveBeenCalledOnce()
})

it('点击菜单项仍执行操作，Escape 关闭后不会吞掉下一次模型点击', async () => {
  const { state, row, select, testModel } = await mountMenu()
  // 已关闭菜单可能仍在执行离场动画，只操作当前新展开的菜单。
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1)!
  const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(node => node.textContent?.includes('测试模型'))!
  item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  item.click(); await nextTick()
  expect(testModel).toHaveBeenCalledOnce()
  expect(state.visible).toBe(false)
  state.visible = true; await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await nextTick()
  row.click()
  expect(select).toHaveBeenCalledOnce()
})

it('其他菜单默认保留按下外部关闭、点击外部控件执行操作的行为', async () => {
  const { state, row, select } = await mountMenu(false)
  row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  await nextTick()
  expect(state.visible).toBe(false)
  row.click()
  expect(select).toHaveBeenCalledOnce()
})
