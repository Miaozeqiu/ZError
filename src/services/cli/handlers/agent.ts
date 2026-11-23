import type { CliHandlerGroup } from '../contracts'
import { requiredText } from '../values'
import { taskSnapshot, sessionBusy } from '../tasks'

async function storeReady() {
  const store = await import('../../agent/chatStore')
  await store.chatStoreReady
  return store
}
export const agentHandlers = {
  'agent.list': async () => (await storeReady()).chatSessions.value.map(session => taskSnapshot(session)),
  'agent.run': async (p, context) => {
    const store = await storeReady()
    const [{ modelConfigManager }, { sendChatMessage }, { redactNative }] = await Promise.all([
      import('../../model/configManager'), import('../../agent/chatLoop'), import('../../security/secureStore'),
    ])
    await modelConfigManager.ready; await context.assertActive()
    if (!modelConfigManager.getSelectedAgentModel()) throw new Error('请先使用 models select 选择 Agent 模型')
    const text = requiredText(p.text, 'text')
    const session = p.sessionId !== undefined ? store.liveSession(requiredText(p.sessionId, 'sessionId')) : store.createChat({ title: text.slice(0, 40), activate: false })
    if (!session) throw new Error('对话不存在')
    if (sessionBusy(session) || store.chatAborts.has(session.id)) throw new Error('对话正在运行，请等待或先停止')
    const messageId = crypto.randomUUID()
    const execution = sendChatMessage(text, undefined, { sessionId: session.id, assistantId: messageId })
    if (!session.messages.some(message => message.id === messageId)) {
      await execution
      throw new Error('任务未被接受，没有创建任务消息')
    }
    void execution.catch(async error => {
      const safeError = await redactNative(String(error)).catch(() => '任务失败，安全存储未解锁')
      store.patchMessage(session.id, messageId, { status: 'failed', error: safeError })
    })
    return { id: session.id, messageId, accepted: true }
  },
  'agent.status': async p => {
    const store = await storeReady()
    const session = store.liveSession(requiredText(p.id, 'id'))
    if (!session) throw new Error('对话不存在')
    const snapshot = taskSnapshot(session, p.messageId, true)
    const [{ agentApprovalState }, { chatLoginRequests, pendingWebsiteVerification }] = await Promise.all([import('../../agent/agentApproval'), import('../../agent/chatLogin')])
    return { ...snapshot, awaitingApproval: snapshot.busy && agentApprovalState.pending?.sessionId === session.id,
      awaitingLogin: snapshot.busy && chatLoginRequests.has(session.id), awaitingVerification: snapshot.busy && pendingWebsiteVerification.has(session.id) }
  },
  'agent.stop': async p => {
    const store = await storeReady()
    const session = store.liveSession(p.id)
    if (!session) throw new Error('对话不存在')
    const snapshot = taskSnapshot(session, p.messageId)
    if (!p.messageId || snapshot.busy) store.stopChat(session.id)
    return taskSnapshot(session, p.messageId)
  },
  'agent.remove': async p => {
    const store = await storeReady()
    if (!store.liveSession(p.id)) throw new Error('对话不存在')
    store.removeChat(p.id)
    return { removed: p.id }
  },
} satisfies CliHandlerGroup<'agent'>
