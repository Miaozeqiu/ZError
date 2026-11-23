import type { CliHandlerGroup } from '../contracts'
import { hostName, requiredText } from '../values'

export const accountHandlers = {
  'accounts.list': async () => {
    const { siteAccountsReady, siteAccountsState } = await import('../../agent/siteAccounts')
    await siteAccountsReady
    if (!siteAccountsState.ready) throw new Error('安全存储尚未解锁')
    return Object.entries(siteAccountsState.rows).map(([host, row]) => ({ host, accountConfigured: Boolean(row?.account), passwordConfigured: Boolean(row?.password), updatedAt: row?.updatedAt }))
  },
  'accounts.set': async (p, context) => {
    const { websiteAccountId, loadWebsiteIdentities } = await import('../../agent/websiteIdentity')
    const { commitSiteAccounts } = await import('../../agent/siteAccounts')
    await loadWebsiteIdentities()
    const host = hostName(p.host)
    if (!p.password) throw new Error('password 不能为空')
    await commitSiteAccounts(async draft => {
      await context.assertActive()
      const id = websiteAccountId(host)
      draft[id] = { ...draft[id], account: requiredText(p.account, 'account'), password: p.password, note: draft[id]?.note || '', updatedAt: Date.now() }
    })
    return { host, saved: true }
  },
  'accounts.remove': async (p, context) => {
    const { loadWebsiteIdentities } = await import('../../agent/websiteIdentity')
    const { removeWebsiteAccounts } = await import('../../agent/siteAccounts')
    await loadWebsiteIdentities(); await context.assertActive()
    const host = hostName(p.host)
    await removeWebsiteAccounts(host)
    return { removed: host }
  },
} satisfies CliHandlerGroup<'accounts'>
