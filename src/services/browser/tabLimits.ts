import { ref } from 'vue'
import type { ActResult } from './engine/types'

export const MAX_BROWSER_TABS = 16
export type BrowserTabLimitNotice = {
  code: 'tab_limit'
  message: string
  source: 'manual' | 'popup'
  openerId?: string
  sessionId: string
  sequence: number
}

export const browserTabLimitNotice = ref<BrowserTabLimitNotice | null>(null)
let sequence = 0
const popupLimits = new Map<string, BrowserTabLimitNotice>()
export const browserTabLimitSequence = () => sequence

export const recordBrowserTabLimit = (source: 'manual' | 'popup', openerId = '', sessionId = '') => {
  const notice: BrowserTabLimitNotice = {
    code: 'tab_limit', source, openerId: openerId || undefined, sessionId,
    message: `当前对话最多打开 ${MAX_BROWSER_TABS} 个标签页。请关闭不用的标签页后再打开。`,
    sequence: ++sequence,
  }
  browserTabLimitNotice.value = notice
  if (source === 'popup' && openerId) {
    popupLimits.delete(openerId)
    popupLimits.set(openerId, notice)
    if (popupLimits.size > 64) popupLimits.delete(popupLimits.keys().next().value as string)
  }
  return notice
}

export const popupTabLimitSince = (openerId: string, after: number) => {
  const notice = popupLimits.get(openerId)
  return notice && notice.sequence > after ? notice : null
}

export const withPopupTabLimit = (openerId: string, result: ActResult, after?: number): ActResult => {
  const notice = result.ok && after != null ? popupTabLimitSince(openerId, after) : null
  return notice ? {
    ...result, ok: false, reason: 'tab_limit', clickDispatched: true, error: notice.message,
    hint: '点击已送达，但新标签没有打开。用 browser_tabs 查看并关闭已完成且不再需要的标签；涉及提交时先核对页面，避免重复提交。',
  } : result
}
export const clearBrowserTabLimitNotice = (sessionId: string) => {
  if (browserTabLimitNotice.value?.sessionId === sessionId) browserTabLimitNotice.value = null
}
