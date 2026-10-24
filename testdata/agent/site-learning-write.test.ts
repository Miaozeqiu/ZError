// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ steps: [] as any[], read: vi.fn(), write: vi.fn(), approve: vi.fn(), policy: 'ask' }))
vi.mock('../../src/services/agent/browserTools', () => ({ executeBrowserTool: vi.fn() }))
vi.mock('../../src/services/agent/chatStore', () => ({ liveSession: () => ({ messages: [{ id: 'answer', steps: api.steps }] }) }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => 'https://www.zjooc.cn/work' }))
vi.mock('../../src/services/browser/siteGraphSave', () => ({ siteGraphWriteBlocked: () => '' }))
vi.mock('../../src/services/agent/agentSkills', () => ({
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
  it('未读原文不能直接覆盖文件，也不会申请写入授权', async () => {
    api.steps = []
    expect(await run('新内容')).toHaveProperty('error')
    expect(api.write).not.toHaveBeenCalled()
    expect(api.approve).not.toHaveBeenCalled()
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
