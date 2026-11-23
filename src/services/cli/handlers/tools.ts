import type { CliHandlerGroup } from '../contracts'
import { webUrl } from '../values'

export const toolHandlers = {
  'tools.list': async p => {
    const { cliToolCatalog } = await import('../catalog')
    return (await cliToolCatalog(p.url ? webUrl(p.url) : '')).filter(tool => !['browser_package_read', 'browser_package_act'].includes(tool.function.name))
  },
  'tools.run': async (p, context) => (await import('../tools')).startCliTool(p, context),
  'tools.result': async p => {
    const store = await import('../../agent/chatStore'); await store.chatStoreReady
    const session = store.liveSession(p.id)
    const message = p.messageId !== undefined ? session?.messages.find(row => row.id === p.messageId && row.role === 'assistant') : session?.messages.filter(row => row.role === 'assistant').at(-1)
    if (!session || !message) throw new Error('工具任务或消息不存在')
    let result: unknown = message.content
    try { result = JSON.parse(message.content) } catch { /* Plain text tool result. */ }
    return { id: session.id, messageId: message.id, status: message.status, result, error: message.error }
  },
} satisfies CliHandlerGroup<'tools'>
