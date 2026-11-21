import { clearWebsiteObservation } from './observations'
import { watch } from 'vue'
import { listenBrowserLoad } from '../../browser/appBrowser'
import { websiteRepositoryHosts, installedExperienceHost, ensureWebsiteRepository, websitePageAutomationTools, onWebsiteRepositoryChanged } from '../websiteRepository'
import { executeInstalledWebsiteTool } from './installedTool'
import { executeWebsiteHostTool } from './hostTools'
import { createWebsiteAutomationScheduler, type AutomaticPage } from './automationScheduler'
import type { ChatToolContext } from '../toolContext'

export async function startWebsitePageAutomations(pages: () => AutomaticPage[]) {
  const versions = new Map<string, string>()
  const scheduler = createWebsiteAutomationScheduler({
    resolve: async url => {
      await websiteRepositoryHosts()
      let host = ''
      try { host = installedExperienceHost(new URL(url).hostname) } catch { return [] }
      if (!host) return []
      await ensureWebsiteRepository(host)
      const tools = websitePageAutomationTools(host)
      versions.set(host, JSON.stringify(tools))
      return tools.map(tool => tool.name)
    },
    run: async (page, name, abort, args) => {
      const ctx = { sessionId: page.sessionId, assistantId: '', abort, role: 'execute', browserId: () => pages().some(current => current.browserId === page.browserId && current.sessionId === page.sessionId && current.url === page.url) ? page.browserId : '' } as ChatToolContext
      ctx.invokeHostTool = async (tool, args) => JSON.parse(await executeWebsiteHostTool(tool, args, ctx, page.browserId))
      return JSON.parse(await executeInstalledWebsiteTool(name, args, ctx, page.browserId, { background: true }))
    },
  })
  const stopWatch = watch(pages, (current, previous) => { for (const old of previous || []) if (!current.some(row => row.browserId === old.browserId && row.sessionId === old.sessionId && row.url === old.url)) clearWebsiteObservation(old.browserId); scheduler.reconcile(current) }, { immediate: true, deep: true })
  const reload = () => scheduler.reconcile(pages(), true)
  const stopSource = onWebsiteRepositoryChanged(host => {
    const version = JSON.stringify(websitePageAutomationTools(host))
    const previous = versions.get(host)
    versions.set(host, version)
    if (previous === undefined || previous === version) return
    for (const page of pages()) {
      try { if (installedExperienceHost(new URL(page.url).hostname) === host) { clearWebsiteObservation(page.browserId); scheduler.schedule(page, true) } }
      catch { /* Non-HTTP tabs have no package automation. */ }
    }
  })
  window.addEventListener('auth-changed', reload)
  window.addEventListener('online', reload)
  let stopLoad: (() => void) | undefined
  const dispose = () => { stopWatch(); stopSource(); stopLoad?.(); window.removeEventListener('auth-changed', reload); window.removeEventListener('online', reload); scheduler.dispose(); for (const page of pages()) clearWebsiteObservation(page.browserId); versions.clear() }
  try { stopLoad = await listenBrowserLoad(event => {
    clearWebsiteObservation(event.id)
    if (event.phase === 'finished') { const page = pages().find(page => page.browserId === event.id); if (page) scheduler.schedule(page, true) }
    else scheduler.cancel(event.id)
  }) }
  catch (error) { dispose(); throw error }
  return dispose
}
