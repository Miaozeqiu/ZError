// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ steps: [] as any[], read: vi.fn(), write: vi.fn(), approve: vi.fn(), policy: 'ask' }))
vi.mock('../../src/services/agent/browserTools', () => ({ executeBrowserTool: vi.fn() }))
vi.mock('../../src/services/agent/chatStore', () => ({ liveSession: () => ({ messages: [{ id: 'answer', steps: api.steps }] }) }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => 'https://www.zjooc.cn/work' }))
vi.mock('../../src/services/browser/siteGraphSave', () => ({ siteGraphWriteBlocked: () => '' }))
vi.mock('../../src/services/agent/agentSkills', () => ({
  isSkillEditable: (id: string) => ['site-learn', 'chaoxing'].includes(id),
  skillFileWriteError: (_id: string, path: string) => path.includes('fixtures/') ? '网站不保存测试页面，请在真实网页验证' : null,
  placeSiteLearnPath: (path: string) => ({ path }), readAgentSkillFileContent: api.read, writeAgentSkillFileContent: api.write,
}))
vi.mock('../../src/services/agent/agentPolicy', () => ({ getAgentPolicy: () => ({ writeSkills: api.policy }) }))
vi.mock('../../src/services/agent/agentApproval', () => ({ requestAgentApproval: api.approve }))
vi.mock('../../src/services/agent/finishGate', () => ({ collectFinishEvidence: vi.fn(), judgeFinish: vi.fn() }))
vi.mock('../../src/services/agent/toolHandlers/campus', () => ({ campusToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/folder', () => ({ folderToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/quiz', () => ({ quizToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/study', () => ({ studyToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/search', () => ({ searchToolHandlers: {} }))
import { executeChatTool } from '../../src/services/agent/executeChatTool'
import { collectFinishEvidence, judgeFinish } from '../../src/services/agent/finishGate'
const path = 'sites/zjooc.cn/SKILL.md'
const run = async (content: string) => JSON.parse(await executeChatTool({
  call: { id: 'write', name: 'write_agent_skill_file', arguments: JSON.stringify({ skill_id: 'site-learn', path, content }) },
  ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
}))
describe('站点 Skill 写入的真实工具入口', () => {
  beforeEach(() => {
    vi.clearAllMocks(); api.policy = 'ask'
    api.steps = [{ id: 'read', name: 'read_agent_skill_file', status: 'done', arguments: JSON.stringify({ skill_id: 'site-learn', path }), result: JSON.stringify({ content: '# 原有步骤' }) }]
    api.read.mockResolvedValue({ content: '# 原有步骤' })
    api.write.mockResolvedValue({ ok: true })
    api.approve.mockResolvedValue(true)
  })
  it('首次访问的经验文件缺失是成功查询，随后创建并一次收尾；旧工具别名也保留有效证据', async () => {
    const host = 'menhu.haou.edu.cn'
    const target = `sites/${host}/SKILL.md`
    api.steps = ['browser_navigate', 'browser_click'].map((name, i) => ({
      id: `action-${i}`, name, status: 'done', result: '{"ok":true}',
    }))
    api.read.mockResolvedValue(null)
    vi.mocked(collectFinishEvidence).mockResolvedValue({ url: 'https://authserver.open.ha.cn/authserver/login' })
    vi.mocked(judgeFinish).mockReturnValue({ ok: true, status: 'done', summary: '登录成功' })
    const call = async (name: string, args: object) => {
      const result = await executeChatTool({
        call: { id: name, name, arguments: JSON.stringify(args) },
        ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
      })
      const parsed = JSON.parse(result)
      api.steps.push({ id: name, name, arguments: JSON.stringify(args), result, status: parsed.error || parsed.ok === false ? 'failed' : 'done' })
      return parsed
    }
    expect(await call('browser_read_agent_skill_file', { skill_id: 'chaoxing', path: 'sites/authserver.open.ha.cn/SKILL.md' }))
      .toMatchObject({ ok: true, exists: false, id: 'site-learn', path: target, content: '' })
    expect(await call('browser_write_agent_skill_file', { skill_id: 'chaoxing', path: 'sites/authserver.open.ha.cn/SKILL.md', content: '# Verified portal login' }))
      .toMatchObject({ ok: true, id: 'site-learn', path: target })
    expect(await call('browser_finish', { status: 'done', summary: '登录成功', learning: { decision: 'updated', reason: '记录验证过的登录方法' } }))
      .toMatchObject({ ok: true, finished: true, learning: { decision: 'updated', path: target } })
    expect(api.write).toHaveBeenCalledWith('site-learn', target, '# Verified portal login')
    expect(api.approve).toHaveBeenCalledOnce()
  })
  it('真正读取失败不会被误报成首次创建，也不能作为写入原文证据', async () => {
    api.read.mockRejectedValueOnce(new Error('permission denied'))
    const result = JSON.parse(await executeChatTool({
      call: { id: 'read', name: 'read_agent_skill_file', arguments: JSON.stringify({ skill_id: 'site-learn', path }) },
      ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
    }))
    expect(result).toMatchObject({ ok: false, id: 'site-learn', path })
    expect(result.error).toContain('permission denied')
    expect(result.exists).toBeUndefined()
    api.steps.push({ id: 'failed-read', name: 'read_agent_skill_file', status: 'failed', result: JSON.stringify(result) })
    expect(await run('replacement')).toHaveProperty('error')
    expect(api.approve).not.toHaveBeenCalled()
    expect(api.write).not.toHaveBeenCalled()
  })
  it('未读原文不能直接覆盖文件，也不会申请写入授权', async () => {
    api.steps = []
    expect(await run('新内容')).toHaveProperty('error')
    expect(api.write).not.toHaveBeenCalled()
    expect(api.approve).not.toHaveBeenCalled()
  })
  it('只读内置 Skill 在授权前被拒绝', async () => {
    const result = JSON.parse(await executeChatTool({
      call: { id: 'write', name: 'write_agent_skill_file', arguments: JSON.stringify({ skill_id: 'campus-bank', path: 'SKILL.md', content: 'replacement' }) },
      ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => null, abort: new AbortController().signal } as any,
    }))
    expect(result.error).toContain('只读')
    expect(api.approve).not.toHaveBeenCalled()
    expect(api.write).not.toHaveBeenCalled()
  })
  it('写测试网页在申请授权之前被拒绝', async () => {
    const result = JSON.parse(await executeChatTool({
      call: { id: 'write', name: 'write_agent_skill_file', arguments: JSON.stringify({ skill_id: 'site-learn', path: 'sites/zjooc.cn/fixtures/page.html', content: '<html />' }) },
      ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
    }))
    expect(result.error).toContain('真实网页验证')
    expect(api.approve).not.toHaveBeenCalled()
    expect(api.write).not.toHaveBeenCalled()
  })
  it('相同正文跳过写入和授权，返回 unchanged', async () => {
    expect(await run('# 原有步骤\n')).toMatchObject({ ok: true, unchanged: true, path })
    expect(api.write).not.toHaveBeenCalled()
    expect(api.approve).not.toHaveBeenCalled()
  })
  it('有增量时沿用已有授权流程并持久化完整正文', async () => {
    expect(await run('# 原有步骤\n\n## 新的分组方法')).toMatchObject({ ok: true, id: 'site-learn', path })
    expect(api.approve).toHaveBeenCalledOnce()
    expect(api.write).toHaveBeenCalledWith('site-learn', path, '# 原有步骤\n\n## 新的分组方法')
  })
  it('即使误选学习通，外站登录经验也归档到主网站，并执行原文检查', async () => {
    const path = 'sites/menhu.haou.edu.cn/SKILL.md'
    const input = {
      call: { id: 'write', name: 'write_agent_skill_file', arguments: JSON.stringify({ skill_id: 'chaoxing', path: 'sites/authserver.open.ha.cn/SKILL.md', content: '已验证的登录步骤' }) },
      ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
    }
    api.steps = []
    expect(JSON.parse(await executeChatTool(input)).error).toContain('读取本站原文')
    expect(api.approve).not.toHaveBeenCalled()
    api.steps = [{ id: 'read', name: 'read_agent_skill_file', status: 'done', arguments: JSON.stringify({ skill_id: 'site-learn', path }), result: JSON.stringify({ content: '# 原文', id: 'site-learn', path }) }]
    expect(JSON.parse(await executeChatTool(input))).toMatchObject({ ok: true, id: 'site-learn', path })
    expect(api.write).toHaveBeenCalledWith('site-learn', path, '已验证的登录步骤')
  })
  it('用户拒绝后保留可核对的路径证据，绝不落盘', async () => {
    api.approve.mockResolvedValue(false)
    expect(await run('新内容')).toMatchObject({ denied: true, id: 'site-learn', path })
    expect(api.write).not.toHaveBeenCalled()
  })
  it('真实 finish 入口拦住漏检查，重复两次后只标记未保存，不再阻塞主任务', async () => {
    vi.mocked(collectFinishEvidence).mockResolvedValue({ url: 'https://www.zjooc.cn/work' })
    vi.mocked(judgeFinish).mockReturnValue({ ok: true, status: 'done', summary: '任务已提交' })
    api.steps.push(...['browser_eval', 'browser_eval'].map((name, index) => ({
      id: `eval-${index}`, name, status: 'done', arguments: JSON.stringify({ script: `方法${index}` }), result: '{"ok":true}',
    })))
    const finish = async () => JSON.parse(await executeChatTool({
      call: { id: 'finish', name: 'browser_finish', arguments: JSON.stringify({ status: 'done', summary: '任务已提交' }) },
      ctx: { sessionId: 'chat', assistantId: 'answer', browserId: () => 'tab', abort: new AbortController().signal } as any,
    }))
    for (let i = 0; i < 2; i++) {
      const result = await finish()
      expect(result).toMatchObject({ ok: false, finished: false, learningRequired: true })
      api.steps.push({ id: `finish-${i}`, name: 'browser_finish', status: 'failed', result: JSON.stringify(result) })
    }
    expect(await finish()).toMatchObject({ ok: true, finished: true, learning: { decision: 'deferred' } })
    expect(api.write).not.toHaveBeenCalled()
    expect(api.approve).not.toHaveBeenCalled()
  })
})
