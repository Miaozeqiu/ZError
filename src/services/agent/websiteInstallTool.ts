import { peekAppBrowserUrl } from '../browser/appBrowser'
import { normalizeWebsiteHost, websitePrimaryHost } from './websiteIdentity'
import { installWebsiteExperience } from './websiteRepository'
import type { ChatToolContext } from './toolContext'

export async function installWebsiteRepositoryTool(args: Record<string, unknown>, ctx: ChatToolContext) {
  if (ctx.role === 'explore') return JSON.stringify({ ok: false, denied: true, error: '探路任务不能安装网站仓库。' })
  try {
    ctx.abort.throwIfAborted()
    const website = typeof args.website === 'string' ? args.website.trim() : peekAppBrowserUrl(ctx.browserId())
    const host = normalizeWebsiteHost(website)
    if (!host) return JSON.stringify({ ok: false, installed: false, error: '请指定网站域名或先打开目标网站。' })
    // Only a canonical public host is sent to the resolver. Page paths and tokens stay local.
    const result = await installWebsiteExperience(`https://${websitePrimaryHost(host)}`, ctx.abort)
    ctx.abort.throwIfAborted()
    return JSON.stringify(result)
  } catch (error) {
    if (ctx.abort.aborted) throw error
    return JSON.stringify({ ok: false, installed: false, error: error instanceof Error ? error.message : String(error) })
  }
}
