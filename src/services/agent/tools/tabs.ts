import { browserAutomationEpoch, controlForSession } from '../../browser/control'
import { MAX_BROWSER_TABS } from '../../browser/tabLimits'
import { closeAgentBrowserTab, tabsForChat } from '../agentBrowser'
import { liveSession } from '../chatStore'

export const handleTabTools = async (ctx: Record<string, any>): Promise<string | null> => {
  if (ctx.name !== 'browser_tabs') return null
  const { args, sessionId, browserId } = ctx
  const action = String(args.action || 'list')
  if (action !== 'list' && action !== 'close') return JSON.stringify({ ok: false, error: 'action 必须是 list 或 close' })
  let closed: string | undefined
  if (action === 'close') {
    const id = String(args.id || '').trim()
    if (!id) return JSON.stringify({ ok: false, error: '先 list 核对，再传入要关闭的标签 id' })
    const epoch = browserAutomationEpoch(browserId) ?? controlForSession(sessionId)?.epoch ?? 0
    try { await closeAgentBrowserTab(sessionId, id, epoch); closed = id }
    catch (error) { return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  const current = liveSession(sessionId)?.browserId || ''
  return JSON.stringify({ ok: true, closed, current, maxPerChat: MAX_BROWSER_TABS,
    tabs: tabsForChat(sessionId).map(tab => ({ id: tab.id, title: tab.title || tab.name, url: tab.url, openerId: tab.openerId, current: tab.id === current })),
    hint: closed ? '已关闭标签并保留其他页面。先 get_page 读取当前页，再继续操作。'
      : '结果已核对、内容已保存且不再需要的临时页可 close；保留正在播放、未提交表单和仍需核对的页面。',
  })
}
