/** 按父 / 子角色装配工具表。execute 再按 HostCapabilities 过滤。 */
import type { DomainToolPolicy } from '../agentProfiles'
import type { AgentToolRole } from '../toolContext'
import { BROWSER_PRIMITIVE_TOOLS } from '../toolDefs/browserPrimitiveTools'
import {
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  READ_AGENT_SKILL_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
} from '../skillTools'
import { executeToolNamesFor, hostCapabilitiesFor, type HostCapabilities } from '../hostCapabilities'
import { resolveSitePackForUrl } from '../sitePack'
import { SUBAGENTS_ENABLED } from './enabled'

export type BrowserToolRole = AgentToolRole

const LOOK_NAMES = [
  'browser_get_page',
  'browser_find',
  'browser_screenshot',
  'browser_eval',
  'browser_site_graph',
  'browser_reload',
  'browser_go_back',
  'browser_go_forward',
  LIST_AGENT_SKILLS_TOOL.function.name,
  READ_AGENT_SKILL_TOOL.function.name,
  READ_AGENT_SKILL_FILE_TOOL.function.name,
  WRITE_AGENT_SKILL_FILE_TOOL.function.name,
  RESET_AGENT_SKILL_FILE_TOOL.function.name,
] as const

const EXPLORE_NAMES = new Set([
  'browser_get_state',
  'browser_get_page',
  'browser_find',
  'browser_screenshot',
  'browser_eval',
  'browser_wait',
  'browser_site_graph',
  'browser_finish',
])

const PARSER_NAMES = new Set([
  'browser_get_state',
  'browser_get_page',
  'browser_site_graph',
  'browser_finish',
  LIST_AGENT_SKILLS_TOOL.function.name,
  READ_AGENT_SKILL_TOOL.function.name,
  READ_AGENT_SKILL_FILE_TOOL.function.name,
  WRITE_AGENT_SKILL_FILE_TOOL.function.name,
  RESET_AGENT_SKILL_FILE_TOOL.function.name,
])

const ALL_BROWSER_TOOLS = [...BROWSER_PRIMITIVE_TOOLS]

const namesOf = (allow: Set<string>) => ALL_BROWSER_TOOLS.filter((tool) => allow.has(tool.function.name))

export const filterToolsByNames = (names: Iterable<string>) => {
  const allow = new Set(names)
  return ALL_BROWSER_TOOLS.filter((tool) => allow.has(tool.function.name))
}

export const assembleRoleTools = (input: {
  url?: string
  domain?: DomainToolPolicy
  role?: BrowserToolRole
  capabilities?: HostCapabilities
}) => {
  const role = input.role || 'parent'
  const url = String(input.url || '')
  if (role === 'parent') {
    const caps = input.capabilities || hostCapabilitiesFor(url)
    const names = new Set(executeToolNamesFor(caps))
    for (const name of LOOK_NAMES) names.add(name)
    if (SUBAGENTS_ENABLED) names.add('browser_task')
    if (input.domain === 'never') {
      return filterToolsByNames(names)
    }
    const pack = resolveSitePackForUrl(url)
    if (pack?.tools.length && input.domain !== 'always') {
      for (const name of pack.tools) names.add(name)
    }
    return filterToolsByNames(names)
  }
  if (role === 'explore') return namesOf(EXPLORE_NAMES)
  if (role === 'parser') return namesOf(PARSER_NAMES)
  const caps = input.capabilities || hostCapabilitiesFor(url)
  const names = new Set(executeToolNamesFor(caps))
  const pack = resolveSitePackForUrl(url)
  if (input.domain === 'never') {
    return filterToolsByNames(names)
  }
  if (pack?.tools.length && input.domain !== 'always') {
    for (const name of pack.tools) {
      if (names.has(name) || executeToolNamesFor(caps).includes(name)) names.add(name)
    }
  }
  return filterToolsByNames(names)
}

export const toolNamesOf = (tools: Array<{ function?: { name?: string } }>) =>
  tools.map((tool) => String(tool.function?.name || '')).filter(Boolean)
