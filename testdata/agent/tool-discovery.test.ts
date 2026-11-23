import { expect, it, vi } from 'vitest'
import { estimateContextTokens } from '../../src/services/model/contextBudget'
import { availableAgentTools, assembleAgentTools } from '../../src/services/agent/tools'
import { LOAD_AGENT_TOOLS, loadAgentTools, modelAgentTools } from '../../src/services/agent/toolDiscovery'
import { buildAgentSystemPrompt } from '../../src/services/agent/prompts'
import { getEnabledSkillCatalog } from '../../src/services/agent/agentSkills'
import { validateToolCall } from '../../src/services/agent/core/tools'

vi.mock('../../src/services/agent/websiteRepository', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepository')>(),
  installedExperienceHost: (host: string) => host,
  websiteToolsForHost: (host: string) => {
    const name = ({ 'chaoxing.com': 'browser_start_chapter_tasks', 'zjooc.cn': 'browser_site_zjooc__login' } as Record<string, string>)[host]
    return name ? [{ type: 'function', function: { name } }] : []
  },
}))

it('keeps new chats small while making every available tool discoverable', () => {
  const catalog = availableAgentTools(assembleAgentTools(''), { enabled: true })
  const tools = modelAgentTools(catalog)
  const names = tools.map(tool => tool.function.name)
  const directory = tools.find(tool => tool.function.name === LOAD_AGENT_TOOLS)!
  const deferred = (directory.function.parameters.properties as any).names.items.enum as string[]
  expect(new Set([...names.filter(name => name !== LOAD_AGENT_TOOLS), ...deferred])).toEqual(new Set(catalog.map(tool => tool.function.name)))
  const messages = [{ role: 'system', content: buildAgentSystemPrompt({ catalog: getEnabledSkillCatalog() }) }, { role: 'user', content: '你好' }]
  expect(estimateContextTokens({ messages, tools })).toBeLessThan(3000)
  expect(estimateContextTokens(tools)).toBeLessThan(estimateContextTokens(catalog) / 6)
})

it('rejects disabled tools at lookup time and excludes them after a settings change', () => {
  const catalog = assembleAgentTools('', 'chaoxing.com')
  const denied = availableAgentTools(catalog, { enabled: false })
  const names = ['web_search', 'browser_start_chapter_tasks']
  expect(JSON.parse(loadAgentTools(denied, names))).toHaveProperty('error')
  const session = { browserId: 'tab', messages: [{ role: 'assistant', status: 'streaming',
    steps: [{ name: LOAD_AGENT_TOOLS, status: 'done', result: JSON.stringify({ loaded: names }) }] }] }
  const tools = modelAgentTools(denied, session as any).map(tool => tool.function.name)
  expect(tools).not.toContain('web_search')
  expect(tools).toContain('browser_start_chapter_tasks')
})

it('offers the follow-up login tool after the host detects an image captcha', () => {
  const session = { browserId: 'tab', messages: [{ role: 'assistant', status: 'streaming', steps: [{
    kind: 'tool', name: 'browser_site_zjooc__login', status: 'done', result: '{"ok":true,"result":{"status":"captcha","captchaImage":"[attached]"}}',
  }] }] }
  const names = modelAgentTools(assembleAgentTools('', 'zjooc.cn'), session as any).map(tool => tool.function.name)
  expect(names).toContain('browser_site_zjooc__login')
})

it('retains loaded website tools on the next user turn and after reopening a conversation', () => {
  const catalog = assembleAgentTools('', 'zjooc.cn')
  const session = { messages: [
    { role: 'assistant', status: 'done', steps: [{ kind: 'tool', name: LOAD_AGENT_TOOLS, status: 'done', result: '{"loaded":["browser_site_zjooc__login"]}' }] },
    { role: 'user', status: 'done', steps: [] },
    { role: 'assistant', status: 'streaming', steps: [] },
  ] }
  const tools = modelAgentTools(catalog, JSON.parse(JSON.stringify(session)))
  expect(tools.map(tool => tool.function.name)).toContain('browser_site_zjooc__login')
  expect(validateToolCall(tools, { name: 'browser_site_zjooc__login', arguments: '{}' })).toBeUndefined()
  const removed = catalog.filter(tool => tool.function.name !== 'browser_site_zjooc__login')
  expect(modelAgentTools(removed, session as any).map(tool => tool.function.name)).not.toContain('browser_site_zjooc__login')
})

it('explains how to load a deferred tool and continues rejecting unknown tools', () => {
  const tools = modelAgentTools(assembleAgentTools('', 'zjooc.cn'))
  expect(validateToolCall(tools, { name: 'browser_site_zjooc__login', arguments: '{}' })).toContain('load_agent_tools')
  expect(validateToolCall(tools, { name: 'unregistered_tool', arguments: '{}' })).toContain('未在本轮注册')
})

it('导入模板工具可被发现，脚本和模板引用都具有合法工具参数',()=>{
  const tools=assembleAgentTools('')
  expect(tools.some(tool=>tool.function.name==='list_import_templates')).toBe(true)
  expect(tools.some(tool=>tool.function.name==='read_import_template')).toBe(true)
  expect(validateToolCall(tools,{name:'run_file_script',arguments:'{"template_id":"saved-parser"}'})).toBeUndefined()
  expect(validateToolCall(tools,{name:'run_file_script',arguments:'{}'})).toBeDefined()
})

it('脚本和模板工具一次解锁，恢复旧对话仍补齐新增工具且不注册已移除的工具',()=>{
 const catalog=assembleAgentTools('')
 const group=['run_file_script','list_import_templates','read_import_template','save_import_template']
 expect(JSON.parse(loadAgentTools(catalog,['run_file_script'])).loaded).toEqual(expect.arrayContaining(group))
 const session={messages:[{role:'assistant',steps:[{kind:'tool',name:LOAD_AGENT_TOOLS,status:'done',result:'{"loaded":["run_file_script"]}'}]}]}
 expect(modelAgentTools(catalog,session as any).map(tool=>tool.function.name)).toEqual(expect.arrayContaining(group))
 const removed=catalog.filter(tool=>tool.function.name!=='save_import_template')
 expect(modelAgentTools(removed,session as any).some(tool=>tool.function.name==='save_import_template')).toBe(false)
})
it('文件概况发现模板后立即提供复用工具，新聊天仍保留小型工具集',()=>{
 const catalog=assembleAgentTools('')
 const session={messages:[{role:'assistant',steps:[{kind:'tool',name:'get_file_info',status:'done',result:'{"import_templates":{"total":1}}'}]}]}
 expect(modelAgentTools(catalog,session as any).some(tool=>tool.function.name==='run_file_script')).toBe(true)
 expect(modelAgentTools(catalog).some(tool=>tool.function.name==='run_file_script')).toBe(false)
})
