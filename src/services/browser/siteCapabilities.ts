/** Application-owned adapters implement site behavior behind these host-neutral contracts. */
export type SiteNavigationPolicy = {
  shellHint: string; homeworkHint: string; frameHint: string
  isShell: (id: string, url: string) => boolean
  sameCourse: (target: string, current: string) => boolean
  isFrameUrl: (url: string) => boolean
  isCourseListUrl: (url: string) => boolean
  isNavigationTab: (text: string) => boolean
  isHomeworkDetour: (url: string, text: string) => boolean
}
export type SiteToolContext = Record<string, any>
export type SiteBrowserAdapter = {
  id: string
  matches: (url: string) => boolean
  navigation: SiteNavigationPolicy
  capabilities: { catalog?: boolean; panel?: boolean; capture?: boolean; captcha?: boolean }
  tools: readonly string[]
  dispatch: (ctx: SiteToolContext) => Promise<string | null>
  pageTool?: (ctx: SiteToolContext) => Promise<string | null>
  readCatalog?: (browserId: string) => Promise<string[]>
  watchCourse?: (browserId: string, sessionId: string, url: string, seed: { title?: string; current?: number; paused?: boolean; ended?: boolean }) => Promise<boolean>
}
const adapters = new Map<string, SiteBrowserAdapter>()
export function registerSiteBrowserAdapter(adapter: SiteBrowserAdapter) {
  if (adapters.has(adapter.id)) throw new Error(`Duplicate browser adapter: ${adapter.id}`)
  adapters.set(adapter.id, adapter)
  return () => { if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id) }
}
export const siteBrowserAdapterFor = (url: string) => [...adapters.values()].find(adapter => adapter.matches(url))
const no = () => false
const ordinaryNavigation: SiteNavigationPolicy = {
  shellHint: '', homeworkHint: '', frameHint: '', isShell: no, sameCourse: no,
  isFrameUrl: no, isCourseListUrl: no, isNavigationTab: no, isHomeworkDetour: no,
}
export const siteNavigationFor = (url: string) => siteBrowserAdapterFor(url)?.navigation ?? ordinaryNavigation
/** Callers retain source, credentials and authorization checks before entering adapters. */
export async function dispatchSiteBrowserTool(ctx: SiteToolContext) {
  for (const adapter of adapters.values()) {
    if (adapter.tools.includes(ctx.name)) return adapter.dispatch(ctx)
  }
  return null
}
export async function handleSitePageTool(ctx: SiteToolContext) {
  const url = ctx.loop?.url || (ctx.liveHref ? await ctx.liveHref(ctx.browserId) : '')
  const adapter = siteBrowserAdapterFor(url)
  if (adapter?.pageTool) return adapter.pageTool(ctx)
  return null
}
