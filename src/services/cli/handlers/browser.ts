import type { CliHandlerGroup } from '../contracts'
import { requiredText, webUrl } from '../values'
import { sessionBusy } from '../tasks'

export const browserHandlers = {
  'browser.list': async () => (await import('../../browser/appBrowser')).listAppBrowsers(),
  'browser.state': async p => (await import('../../browser/appBrowser')).getBrowserState(p.id),
  'browser.open': async (p, context) => {
    const url = webUrl(p.url)
    const [store, { createChatBrowserTab, ensureAgentBrowser }] = await Promise.all([import('../../agent/chatStore'), import('../../agent/agentBrowser')])
    await store.chatStoreReady; await context.assertActive()
    const session = p.sessionId !== undefined ? store.liveSession(requiredText(p.sessionId, 'sessionId')) : store.createChat({ title: new URL(url).hostname, activate: false })
    if (!session) throw new Error('对话不存在')
    if (sessionBusy(session) || store.chatAborts.has(session.id)) throw new Error('该对话正在运行')
    const tab = createChatBrowserTab(session.id, { url })
    await ensureAgentBrowser(session.id)
    return { id: tab.id, sessionId: session.id, url }
  },
} satisfies CliHandlerGroup<'browser'>
