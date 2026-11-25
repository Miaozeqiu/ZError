import type { AgentChatSession } from './chatTypes'
import { parseToolArgs } from './toolArgs'

export const LOAD_AGENT_TOOLS = 'load_agent_tools'
// 网站名称没有附带网址时，首轮即可读取本地导航，不必先解锁工具或联网搜索。
const core = ['protect_credentials', 'read_agent_skill', 'browser_navigate', 'browser_home_shortcuts', 'web_search']
type NamedTool = { function: { name: string } }
const templateTools = ['run_file_script', 'list_import_templates', 'read_import_template', 'save_import_template']
function includeTemplateTools(selected: Set<string>) {
  if (templateTools.some(name => selected.has(name))) for (const name of templateTools) selected.add(name)
}

// 宿主注册表决定工具能否执行；此处只筛选本次提供给模型的参数定义。
export function modelAgentTools<T extends NamedTool>(available: T[], session?: AgentChatSession | null) {
  const selected = new Set(core)
  if (session?.browserId) {
    // 浏览器一旦建立，常用读、点、填、按键和等待直接提供；扩展工具继续按需加载。
    for (const name of ['browser_get_page', 'browser_click', 'browser_type', 'browser_press', 'browser_wait', 'browser_todo', 'browser_finish', 'browser_watch', 'install_website_repository', 'read_agent_skill_file']) selected.add(name)
  }
  // 对话保留已加载工具；最终仍按实时宿主目录剔除已禁用或卸载的工具。
  for (const message of session?.messages || []) {
    if (message.role !== 'assistant') continue
    for (const step of message.steps || []) {
      if (step.name === LOAD_AGENT_TOOLS && step.status === 'done') {
        const loaded = parseToolArgs(step.result || '').loaded
        if (Array.isArray(loaded)) {
          for (const name of loaded) if (typeof name === 'string') selected.add(name)
        }
      } else if (step.kind === 'tool' && step.status === 'done') {
        selected.add(step.name)
        // 文件概况已找到可用模板时，下一轮即可查询、检查或试跑，不再多走一次解锁。
        if (step.name === 'get_file_info') {
          const templates = parseToolArgs(step.result || '').import_templates
          if (templates && typeof templates === 'object' && 'total' in templates && typeof templates.total === 'number' && templates.total > 0) selected.add('list_import_templates')
        }
      }
    }
  }
  includeTemplateTools(selected)
  const catalog = available.map(tool => tool.function.name).filter(name => !core.includes(name))
  const visible = available.filter(tool => selected.has(tool.function.name))
  if (!catalog.length) return visible
  return [...visible, {
    type: 'function' as const,
    function: {
      name: LOAD_AGENT_TOOLS,
      description: '批量加载工具。收到新定义后继续调用，无需用户另发消息；不会执行所选操作。',
      parameters: { type: 'object', required: ['names'], additionalProperties: false, properties: {
        names: { type: 'array', minItems: 1, items: { type: 'string', enum: catalog } },
      } },
    },
  }]
}

export function loadAgentTools(available: NamedTool[], names: unknown) {
  const requested = new Set(Array.isArray(names) ? names : [])
  const loaded = available.map(tool => tool.function.name).filter(name => requested.has(name))
  if (!loaded.length || loaded.length !== requested.size) return JSON.stringify({ error: '工具当前不可用，请从最新工具目录选择。' })
  includeTemplateTools(requested)
  return JSON.stringify({ loaded: available.map(tool => tool.function.name).filter(name => requested.has(name)) })
}
