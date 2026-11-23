import { beforeEach, expect, it, vi } from 'vitest'
import { installWebsiteRepositoryTool } from '../../src/services/agent/websiteInstallTool'
import type { ChatToolContext } from '../../src/services/agent/toolContext'
import { executeChatTool } from '../../src/services/agent/executeChatTool'
import { assembleAgentTools } from '../../src/services/agent/tools'

const io = vi.hoisted(() => ({ install: vi.fn(), url: vi.fn() }))
vi.mock('../../src/services/agent/websiteRepository', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepository')>(), installWebsiteExperience: io.install,
}))
vi.mock('../../src/services/browser/appBrowser', async original => ({
  ...await original<typeof import('../../src/services/browser/appBrowser')>(), peekAppBrowserUrl: io.url,
}))

const ctx = () => ({ abort: new AbortController().signal, browserId: () => 'tab', role: 'parent' }) as ChatToolContext
beforeEach(() => {
  vi.clearAllMocks()
  io.url.mockReturnValue('https://www.zjooc.cn/login?private=token')
  io.install.mockResolvedValue({ ok: true, installed: true, host: 'zjooc.cn', revision: 'a'.repeat(40), tools: ['site_tool'] })
})

it('installs for the current site and returns the host registration receipt', async () => {
  expect(JSON.parse(await installWebsiteRepositoryTool({}, ctx()))).toMatchObject({ installed: true, revision: 'a'.repeat(40), tools: ['site_tool'] })
  expect(io.install).toHaveBeenCalledExactlyOnceWith('https://zjooc.cn', expect.any(AbortSignal))
})

it('accepts a named site without navigating the current page', async () => {
  expect(JSON.parse(await installWebsiteRepositoryTool({ website: 'zjooc.cn' }, ctx()))).toMatchObject({ installed: true })
  expect(io.url).not.toHaveBeenCalled()
})

it('registers and dispatches installation through the normal chat tool entry', async () => {
  expect(assembleAgentTools().some(tool => tool.function.name === 'install_website_repository')).toBe(true)
  const result = await executeChatTool({
    call: { id: 'install', name: 'install_website_repository', arguments: '{"website":"zjooc.cn"}' }, ctx: ctx(),
  })
  expect(JSON.parse(result)).toMatchObject({ installed: true, host: 'zjooc.cn' })
})

it('reports installation failure and does not replace it with a successful note write', async () => {
  io.install.mockRejectedValueOnce(new Error('网站经验更新失败（HTTP 503）'))
  expect(JSON.parse(await installWebsiteRepositoryTool({}, ctx()))).toEqual({ ok: false, installed: false, error: '网站经验更新失败（HTTP 503）' })
})

it('rejects missing sites and read-only roles before downloading', async () => {
  io.url.mockReturnValue('about:blank')
  expect(JSON.parse(await installWebsiteRepositoryTool({}, ctx()))).toMatchObject({ ok: false, installed: false })
  expect(JSON.parse(await installWebsiteRepositoryTool({ website: 'zjooc.cn' }, { ...ctx(), role: 'explore' }))).toMatchObject({ denied: true })
  expect(io.install).not.toHaveBeenCalled()
})
