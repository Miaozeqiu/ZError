import { assembleAgentTools, availableAgentTools } from '../agent/tools'
import type { ToolDefinition } from '../agent/core/tools'
import { WEBSITE_HOST_TOOLS } from '../agent/websiteRuntime/hostTools'
import { experienceHostForPage, ensureWebsiteRepository, hasWebsiteRepository, websiteToolsForHost } from '../agent/websiteRepository'
import { settingsManager } from '../app/settings'

export async function cliToolCatalog(url = ''): Promise<ToolDefinition[]> {
  await settingsManager.ready
  const host = url ? await experienceHostForPage(url).catch(() => '') : ''
  if (host && hasWebsiteRepository(host)) await ensureWebsiteRepository(host)
  const tools = availableAgentTools([...assembleAgentTools(url), ...websiteToolsForHost(host), ...WEBSITE_HOST_TOOLS], settingsManager.get('search')) as ToolDefinition[]
  return [...new Map(tools.map(tool => [tool.function.name, tool])).values()]
}
