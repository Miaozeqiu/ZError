import type { ToolDefinition } from './core/tools'

// A source can describe an installed tool, but it cannot grant new host operations.
const supported = {
  'chaoxing.com': [
    'browser_login_chaoxing', 'browser_list_courses', 'browser_open_course',
    'browser_list_homework', 'browser_open_homework', 'browser_answer_homework',
    'browser_review_homework', 'browser_review_chapter_discussion', 'browser_reply_chapter_discussion',
    'browser_start_chapter_tasks', 'browser_open_pending_chapter', 'browser_review_chapter',
    'browser_complete_chapter', 'browser_decode_chaoxing_font',
  ],
  'zjooc.cn': ['browser_answer_zjooc', 'browser_play_zjooc', 'browser_login_zjooc'],
} satisfies Record<string, string[]>

export const websiteToolHost = (name: string) => Object.entries(supported).find(([, names]) => names.includes(name))?.[0]
export const websiteHasSupportedTools = (host: string) => Object.hasOwn(supported, host)
export const websiteToolNames = Object.values(supported).flat()

export function validateWebsiteTools(host: string, value: unknown): ToolDefinition[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32 || JSON.stringify(value).length > 32 * 1024) {
    throw new Error('网站工具清单无效或过大。')
  }
  const names = new Set<string>()
  for (const row of value) {
    const tool = row?.function
    if (row?.type !== 'function' || typeof tool?.name !== 'string' || websiteToolHost(tool.name) !== host || names.has(tool.name)
      || typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > 1000
      || !tool.parameters || tool.parameters.type !== 'object' || tool.parameters.$ref !== undefined) {
      throw new Error('网站工具清单与当前网站或宿主能力不匹配。')
    }
    names.add(tool.name)
  }
  return value.map(({ function: { name, description, parameters } }) => ({ type: 'function', function: { name, description, parameters } }))
}
