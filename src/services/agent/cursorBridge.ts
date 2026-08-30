import {
  clickBrowserText,
  evalBrowserView,
  getBrowserState,
  getSelectedBrowserId,
  listAppBrowsers,
  screenshotBrowserView,
} from '../browser/appBrowser'
import { siteGraphAgentSnap } from '../browser/siteGraph'
import { inspectChaoxingHomework } from '../chaoxing/homework'
import { browserChatSessions, ensureBrowserChat, sendChatMessage, stopChat } from './chat'
import { modelConfigManager } from '../model/config'

const enabled = () => import.meta.env.DEV

const postResult = (payload: Record<string, unknown>) => {
  fetch('/__agent-bridge/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

const resolveBrowserId = (want?: string) => {
  const list = listAppBrowsers()
  const asked = String(want || '').trim()
  if (asked) return asked
  const selected = getSelectedBrowserId()
  if (selected && list.some((item) => item.id === selected)) return selected
  const chaoxing = [...list].reverse().find((item) => /chaoxing\.com/i.test(item.url || ''))
  if (chaoxing) return chaoxing.id
  const latest = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  return latest?.id || list[0]?.id || ''
}

const snapshotOf = async (browserId: string, withImage: boolean) => {
  const state = await getBrowserState(browserId).catch(() => null)
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  const url = state?.url || item?.url || ''
  const title = state?.title || item?.title || item?.name || ''
  let image = ''
  if (withImage) {
    const shot = await screenshotBrowserView(browserId).catch(() => null)
    image = shot?.image || ''
  }
  return {
    ok: true,
    browserId,
    url,
    title,
    siteGraph: siteGraphAgentSnap(url),
    image,
  }
}

const clip = (text: string, max = 400) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

const ensureAgentModel = () => {
  if (modelConfigManager.getSelectedAgentModel() || modelConfigManager.getSelectedTextModel()) {
    return modelConfigManager.getSelectedAgentModel()?.displayName
      || modelConfigManager.getSelectedTextModel()?.displayName
      || ''
  }
  const models = modelConfigManager.getSettings().platforms
    .filter((platform) => platform.enabled !== false)
    .flatMap((platform) => platform.models || [])
    .filter((model) => model.enabled !== false)
  const prefer = models.find((model) => /qwen3\.7-flash/i.test(`${model.modelId || ''} ${model.id} ${model.displayName || ''}`))
    || models[0]
  if (prefer) modelConfigManager.setSelectedAgentModel(prefer.id)
  return prefer?.displayName || ''
}

const runCommand = async (cmd: { id?: string; action?: string; args?: Record<string, unknown> }) => {
  const action = String(cmd.action || 'snapshot')
  const browserId = resolveBrowserId(String(cmd.args?.browserId || ''))
  try {
    if (action === 'stop') {
      const session = browserChatSessions.value.find((item) => item.browserId === browserId)
        || browserChatSessions.value[0]
      if (session) stopChat(session.id)
      return { ok: true, id: cmd.id, action, sessionId: session?.id || '', stopped: Boolean(session) }
    }
    if (action === 'send' || action === 'prompt') {
      const text = String(cmd.args?.text || '').trim()
      if (!text) return { ok: false, id: cmd.id, action, error: '缺少 text' }
      if (!browserId) return { ok: false, id: cmd.id, action, error: '没有打开的浏览器' }
      const session = ensureBrowserChat({ browserId })
      if (!session) return { ok: false, id: cmd.id, action, error: '没有浏览器对话' }
      const agentModel = ensureAgentModel()
      if (!agentModel) {
        return { ok: false, id: cmd.id, action, error: '没有可用的 agent 模型', sessionId: session.id }
      }
      if (session.messages.some((item) => item.status === 'streaming')) stopChat(session.id)
      void sendChatMessage(text, undefined, { sessionId: session.id })
      return { ok: true, id: cmd.id, action, browserId, sessionId: session.id, agentModel, sent: clip(text, 120) }
    }
    if (action === 'chat') {
      const session = browserChatSessions.value.find((item) => item.browserId === browserId)
        || browserChatSessions.value[0]
        || null
      const last = session?.messages[session.messages.length - 1]
      return {
        ok: Boolean(session),
        id: cmd.id,
        action,
        browserId: session?.browserId || browserId,
        sessionId: session?.id || '',
        streaming: last?.status === 'streaming',
        agentModel: modelConfigManager.getSelectedAgentModel()?.displayName
          || modelConfigManager.getSelectedTextModel()?.displayName
          || '',
        lastRole: last?.role || '',
        lastText: clip(last?.content || last?.error || '', 240),
        steps: (last?.steps || []).slice(-6).map((step) => ({
          name: step.name,
          status: step.status,
          label: step.label,
        })),
      }
    }
    if (!browserId) return { ok: false, error: '没有打开的浏览器', id: cmd.id, action }
    if (action === 'list') {
      return {
        id: cmd.id,
        action,
        ok: true,
        selected: getSelectedBrowserId(),
        browsers: listAppBrowsers().map((item) => ({
          id: item.id,
          url: item.url,
          title: item.title || item.name,
          updatedAt: item.updatedAt,
        })),
      }
    }
    if (action === 'state') {
      return { id: cmd.id, action, ...(await snapshotOf(browserId, false)) }
    }
    if (action === 'snapshot' || action === 'screenshot') {
      return { id: cmd.id, action, ...(await snapshotOf(browserId, true)) }
    }
    if (action === 'click_text') {
      const text = String(cmd.args?.text || '').trim()
      if (!text) return { ok: false, id: cmd.id, action, error: '缺少 text' }
      const clicked = await clickBrowserText(browserId, text)
      const snap = await snapshotOf(browserId, true)
      return { id: cmd.id, action, ...snap, clicked }
    }
    if (action === 'eval') {
      const script = String(cmd.args?.script || '').trim()
      if (!script) return { ok: false, id: cmd.id, action, error: '缺少 script' }
      const result = await evalBrowserView(browserId, script)
      return { id: cmd.id, action, ok: true, browserId, result, ...(await snapshotOf(browserId, false)) }
    }
    if (action === 'inspect') {
      const card = await inspectChaoxingHomework(browserId)
      return { id: cmd.id, action, ok: true, browserId, card, ...(await snapshotOf(browserId, true)) }
    }
    return { ok: false, id: cmd.id, action, error: `未知动作 ${action}` }
  } catch (error) {
    return {
      ok: false,
      id: cmd.id,
      action,
      browserId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

let pollTimer = 0
let busy = false

const tick = async () => {
  if (!enabled() || busy) return
  busy = true
  try {
    const res = await fetch('/__agent-bridge/cmd')
    if (res.status === 204) return
    const cmd = await res.json()
    if (!cmd?.id) return
    postResult(await runCommand(cmd))
  } catch {
    // 桥没起来时安静跳过
  } finally {
    busy = false
  }
}

export const dumpCursorSnapshot = async (browserId?: string) => {
  if (!enabled()) return
  const id = resolveBrowserId(browserId)
  if (!id) return
  postResult(await snapshotOf(id, true))
}

export const startCursorBridge = () => {
  if (!enabled() || pollTimer) return
  void tick()
  pollTimer = window.setInterval(() => { void tick() }, 400)
}

export const stopCursorBridge = () => {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = 0
}

if (enabled()) {
  startCursorBridge()
  if (import.meta.hot) {
    import.meta.hot.dispose(() => stopCursorBridge())
  }
}
