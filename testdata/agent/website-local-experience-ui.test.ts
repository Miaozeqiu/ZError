// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import { EditorView } from '@codemirror/view'

const state = vi.hoisted(() => ({ note: '一条本地经验', host: 'example.com', main: 'sites/example.com/SKILL.md' }))
vi.mock('markstream-vue', async () => {
  const { h } = await import('vue')
  return { default: { props: ['content'], render: ({ content }: { content: string }) => h('div', { class: 'note-preview' }, content) }, setCustomComponents: vi.fn() }
})
vi.mock('../../src/services/model/markstream', () => ({}))
vi.mock('../../src/services/agent/skillRuntime', () => ({ SITE_GRAPH_PATH: 'site-graph.json' }))
vi.mock('../../src/components/browser/BrowserSiteGraphPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/services/agent/websiteRepositoryTarget', () => ({
  websiteRepositoryTarget: (_id: string, path: string) => path.startsWith('sites/') ? { host: state.host, path: path.split('/').at(-1) } : null,
}))
vi.mock('../../src/services/agent/websiteRepository', () => ({
  ensureWebsiteRepository: vi.fn(async () => undefined),
  websiteRepositoryStates: { 'example.com': { source: 'repository', changedPaths: ['SKILL.md'] } },
  readWebsiteRepositoryFile: async () => ({ supplement: state.note }),
  writeWebsiteRepositorySupplement: vi.fn(async (_host, note) => { state.note = note }),
}))
vi.mock('../../src/services/agent/agentSkills', async () => ({
  ...await import('../../src/services/agent/skillFormat'),
  agentSkillsState: { items: [{ id: 'site-learn' }] },
  getSkillDocument: async () => ({ id: 'site-learn', name: '示例', files: [state.main, 'sites/example.com/references/guide.md'] }),
  getSkillFileContent: async (_id: string, path: string) => ({ path, content: [
    '---', 'name: example', 'description: 站点操作说明', 'license: MIT', 'metadata:',
    '  display-name: 示例', '  requires: ZError browser, credential and video-wait tools',
    '  custom-field: 自定义值', '---', '', '云端经验',
  ].join('\n') }),
}))

import AgentSkillDetail from '../../src/views/settings/AgentSkillDetail.vue'
import { ensureWebsiteRepository } from '../../src/services/agent/websiteRepository'

let app: App | undefined
let root: HTMLElement | undefined
afterEach(() => { app?.unmount(); root?.remove() })

it('opens the local note at the directory root and keeps it selected after saving', async () => {
  root = document.createElement('div')
  document.body.append(root)
  app = createApp({ render: () => h(AgentSkillDetail, {
    skillId: 'site-learn', siteHost: state.host, initialPath: state.main, initialMode: 'local',
  }) })
  app.mount(root)
  const note = () => {
    const element = root!.querySelector<HTMLElement>('.cm-editor')
    return element ? EditorView.findFromDOM(element) : null
  }
  await vi.waitFor(() => expect(note()?.state.doc.toString()).toBe('一条本地经验'))
  const status = root.querySelector('.repository-status')
  expect(root.querySelector('.skill-detail-header .header-actions')?.lastElementChild).toBe(status)
  expect(status?.textContent).toContain('已同步')
  expect(ensureWebsiteRepository).toHaveBeenCalledWith(state.host, true)
  const local = root.querySelector<HTMLElement>('[title="本地经验.md"]')!
  const cloud = root.querySelector<HTMLElement>('[title="sites/example.com/SKILL.md"]')!
  expect(local.parentElement?.parentElement).toBe(cloud.parentElement?.parentElement)
  expect(local.parentElement?.parentElement?.classList.contains('skill-file-tree')).toBe(true)
  expect(local.classList.contains('selected')).toBe(true)
  expect(root.querySelector('.header-actions .danger')).toBeNull()

  expect(root.querySelector('.cm-lineNumbers')).not.toBeNull()
  note()!.dispatch({ changes: { from: 0, to: note()!.state.doc.length, insert: '两条本地经验' } })
  expect(root.querySelector('.header-actions .primary')).toBeNull()
  root.querySelector<HTMLElement>('.local-mode-switch label[title="预览"]')!.click()
  await vi.waitFor(() => expect(root!.textContent).toContain('已保存本地补充'))
  expect(local.classList.contains('selected')).toBe(true)
  expect(note()).toBeNull()
  expect(root.querySelector('.local-note-preview .note-preview')?.textContent).toBe('两条本地经验')

  cloud.click()
  await vi.waitFor(() => expect(cloud.classList.contains('selected')).toBe(true))
  expect(note()).toBeNull()
  const info = root.querySelector('dl[aria-label="经验信息"]')!
  expect(Array.from(info.querySelectorAll('dt'), field => field.textContent)).toEqual([
    '标识', '用途', '许可证', '显示名称', '所需能力', '扩展字段 · custom-field',
  ])
  expect(info.textContent).toContain('ZError 浏览器、凭据及视频播放等待工具')
  local.click()
  await vi.waitFor(() => expect(root!.querySelector('.local-note-preview .note-preview')?.textContent).toBe('两条本地经验'))
  expect(note()).toBeNull()
  const switcher = root.querySelector('.local-mode-switch')!
  expect(switcher.getAttribute('data-selected-index')).toBe('0')
  switcher.querySelector<HTMLElement>('label[title="编辑"]')!.click()
  await vi.waitFor(() => expect(note()?.state.doc.toString()).toBe('两条本地经验'))
  expect(switcher.getAttribute('data-selected-index')).toBe('1')
  note()!.dispatch({ changes: { from: note()!.state.doc.length, insert: '\n补充第三条' } })
  cloud.click()
  await vi.waitFor(() => expect(cloud.classList.contains('selected')).toBe(true))
  expect(state.note).toBe('两条本地经验\n补充第三条')
  expect(ensureWebsiteRepository).toHaveBeenCalledOnce()
})
