/** 统一 Agent 的浏览器工作区。会话拥有标签，收起预览不会关闭网页。 */
import { computed, ref } from 'vue'
import {
  browserHomeUrl, createAppBrowser, listAppBrowsers,
  listenBrowserOpened, listenBrowserState, openBrowserView, patchAppBrowser,
  closeBrowserView, removeAppBrowser, setSelectedBrowserId, type AppBrowser,
} from '../browser/appBrowser'
import { activeChat, chatStoreReady, createChat, liveSession, patchSession, sessions } from './chatStore'
import { listenBrowserControl, registerBrowserControl } from '../browser/control'

export const agentBrowserTabs = ref<AppBrowser[]>(listAppBrowsers())
export const agentBrowserExpanded = ref(false)
const opening = new Map<string, Promise<void>>()
let listeners: Promise<void> | undefined
const unlisteners: Array<() => void> = []

export const refreshAgentBrowsers = () => { agentBrowserTabs.value = listAppBrowsers() }
export const browserIdsForChat = (session: { browserId?: string; browserIds?: string[] } | null | undefined) => (
  [...new Set([...(session?.browserIds || []), session?.browserId || ''].filter(Boolean))]
)
export const currentAgentBrowsers = computed(() => {
  const ids = browserIdsForChat(activeChat.value)
  return agentBrowserTabs.value.filter(tab => ids.includes(tab.id))
})
export const currentAgentBrowser = computed(() => (
  agentBrowserTabs.value.find(tab => tab.id === activeChat.value?.browserId) || null
))

export const bindChatBrowser = (sessionId: string, browserId: string) => {
  patchSession(sessionId, session => ({
    ...session, browserId: browserId || undefined,
    browserIds: [...new Set([...browserIdsForChat(session), browserId].filter(Boolean))],
  }))
  setSelectedBrowserId(activeChat.value?.browserId || '')
  refreshAgentBrowsers()
}

export const releaseChatBrowsers = async (ids: string[]) => {
  for (const id of ids) {
    if (sessions.value.some(session => browserIdsForChat(session).includes(id))) continue
    removeAppBrowser(id)
    await opening.get(id)?.catch(() => undefined)
    opening.delete(id)
    await closeBrowserView(id).catch(() => undefined)
  }
  refreshAgentBrowsers()
}

/** 不选取别的会话的标签；只有首次使用浏览器时才创建。 */
export const ensureChatBrowserTab = (sessionId: string) => {
  const session = liveSession(sessionId)
  if (!session) throw new Error('对话已不存在')
  const existing = listAppBrowsers().find(tab => tab.id === session.browserId)
  if (existing) return existing
  const tab = createAppBrowser({ url: browserHomeUrl(), title: '导航' })
  bindChatBrowser(sessionId, tab.id)
  return tab
}

/** 原生视图首次在后台创建；已经打开的标签不重复 open，避免抢显示和改变网址。 */
export const ensureAgentBrowser = async (sessionId: string): Promise<string> => {
  const tab = ensureChatBrowserTab(sessionId)
  let flight = opening.get(tab.id)
  if (!flight) {
    flight = (async () => {
      await registerBrowserControl(tab.id, sessionId)
      await openBrowserView(tab.id, tab.url, { x: 0, y: 0, width: 960, height: 540 }, true)
    })().catch(error => { opening.delete(tab.id); throw error })
    opening.set(tab.id, flight)
  }
  await flight
  if (!liveSession(sessionId)) throw new Error('对话已不存在')
  if (liveSession(sessionId)?.browserId !== tab.id) return ensureAgentBrowser(sessionId)
  return tab.id
}

/** 应用生命周期内只安装一组监听，背景对话的弹窗仍归属它自己的会话。 */
export const startAgentBrowserWorkspace = () => {
  if (listeners) return listeners
  listeners = (async () => {
    await chatStoreReady
    // 同一标签只归属一个根对话；兼容旧版启动竞态产生的空白重复会话。
    const claimed = new Set<string>()
    const owners = [...sessions.value].filter(session => !session.parentId).sort((left, right) =>
      Number(Boolean(right.messages.length)) - Number(Boolean(left.messages.length)) || right.updatedAt - left.updatedAt)
    for (const owner of owners) {
      const ids = browserIdsForChat(owner)
      const keep = ids.filter(id => !claimed.has(id))
      keep.forEach(id => claimed.add(id))
      if (keep.length !== ids.length) patchSession(owner.id, current => ({ ...current,
        browserIds: keep, browserId: keep.includes(current.browserId || '') ? current.browserId : keep.at(-1),
      }))
    }
    // 旧浏览器页的未归属标签保留到一个对话中，升级时不删除历史记录。
    const owned = new Set(sessions.value.flatMap(browserIdsForChat))
    const legacy = listAppBrowsers().filter(tab => !owned.has(tab.id))
    if (legacy.length) {
      const session = createChat({ title: '浏览器', browserId: legacy[0].id, activate: false })
      patchSession(session.id, current => ({ ...current, browserIds: legacy.map(tab => tab.id) }))
    }
    unlisteners.push(await listenBrowserState(state => {
      if (!listAppBrowsers().some(tab => tab.id === state.id)) return
      patchAppBrowser(state.id, { ...(state.url ? { url: state.url } : {}), ...(state.title ? { title: state.title } : {}) })
      refreshAgentBrowsers()
    }))
    unlisteners.push(await listenBrowserControl())
    unlisteners.push(await listenBrowserOpened(state => {
      const owner = state.openerId
        ? sessions.value.find(session => !session.parentId && browserIdsForChat(session).includes(state.openerId!))
        : activeChat.value
      if (!owner) return
      const tab = createAppBrowser({ id: state.id, url: state.url, title: state.title })
      bindChatBrowser(owner.id, tab.id)
      void ensureAgentBrowser(owner.id).catch(error => console.error('[agent browser popup]', error))
    }))
  })().catch(error => {
    for (const off of unlisteners.splice(0)) off()
    listeners = undefined
    console.error('[agent browser workspace]', error)
  })
  return listeners
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void listeners?.finally(() => { for (const off of unlisteners.splice(0)) off() })
  })
}
