import type { CliHandlerGroup } from '../contracts'
import { hostName, webUrl } from '../values'

export const websiteHandlers = {
  'websites.list': async () => (await import('../../agent/websiteSettings')).listWebsiteSettings(),
  'websites.remove': async (p, context) => {
    const sites = await import('../../agent/websiteSettings')
    await context.assertActive(); await sites.deleteWebsiteSettings(hostName(p.host))
    return { removed: p.host }
  },
  'websites.refresh': async (p, context) => {
    const repo = await import('../../agent/websiteRepository')
    const host = hostName(p.host)
    await context.assertActive(); await repo.refreshWebsiteRepository(host, true)
    return repo.websiteRepositoryStates[host]
  },
  'websites.install': async (p, context) => {
    const repo = await import('../../agent/websiteRepository')
    const candidates = await repo.previewWebsiteRepository(webUrl(p.url))
    if (candidates.length !== 1) throw new Error(candidates.length ? '发现多个经验，请在软件中选择' : 'Open 中未找到匹配的网站经验')
    await context.assertActive(); await repo.importWebsiteRepository(candidates[0])
    return { installed: candidates[0].website.host }
  },
} satisfies CliHandlerGroup<'websites'>
