import { describe, expect, it, vi } from 'vitest'
import { downloadOpenWebsiteExperience } from '../../src/services/agent/websiteRepositoryOpen'
import { runtimeFixture } from './fixtures/websiteRuntime'
const website = { version: 1 as const, id: 'academy', host: 'academy.example', name: 'Academy', icon: 'assets/icon.png' }
const snapshot = () => ({ revision: 'a'.repeat(40), checkedAt: 1, website,
  icon: { path: website.icon, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
  files: { 'SKILL.md': '---\nname: academy\ndescription: Academy tools\n---\n',
    'site-graph.json': JSON.stringify({ id: website.id, host: website.host, hostPattern: 'academy\\.example', nodes: [], edges: [] }) } })
const endpoint = 'https://open.zerrorai.com/v1/website-experience/academy.example'
describe('Open 网站运行包沿用原接口', () => {
  it('原地址直接获取编译包，后续只按提交 revision 检查更新', async () => {
    const request = vi.fn(async (_url: string) => Response.json({ ...snapshot(), runtime: runtimeFixture() }))
    const current = await downloadOpenWebsiteExperience(website, { ...snapshot(), revision: 'initial' }, request as typeof fetch)
    expect(request.mock.calls[0]?.[0]).toBe(endpoint)
    expect(current.tools?.[0].function.name).toBe('browser_site_academy__read_catalog')
    request.mockResolvedValueOnce(Response.json({ revision: current.revision, unchanged: true }))
    expect(await downloadOpenWebsiteExperience(website, current, request as typeof fetch)).toMatchObject({ runtime: current.runtime })
    expect(request.mock.calls[1]?.[0]).toBe(endpoint + '?revision=' + current.revision)
  })
  it('拒绝损坏的新产物并保留已有快照', async () => {
    const previous = { ...snapshot(), runtime: runtimeFixture() }
    const runtime = runtimeFixture(); runtime.bundle.code += 'changed'
    const request = vi.fn(async () => Response.json({ ...previous, runtime }))
    await expect(downloadOpenWebsiteExperience(website, previous, request as typeof fetch)).rejects.toThrow('哈希')
    expect(previous.runtime.bundle.code).not.toContain('changed')
  })
})

it('服务器返回只有工具定义而没有运行包时仍严格拒绝，缓存恢复不能放宽下载校验', async () => {
  const request=vi.fn(async()=>Response.json({...snapshot(),tools:[{type:'function',function:{name:'old_tool'}}]}))
  await expect(downloadOpenWebsiteExperience(website,snapshot(),request as typeof fetch)).rejects.toThrow('已验证的编译运行包')
})
