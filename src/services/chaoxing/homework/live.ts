import { lastHomeworkCard, publishHomeworkCard } from '../../browser/abstractions'
import { asObject, evalBrowserView } from '../../browser/eval'
import { INSTALL_HW_LIVE_HOOK, READ_HW_DIRTY, READ_HW_FILL_STATE } from './scripts'
import type { HomeworkLiveState } from './types'

let liveTimer = 0
let liveId = ''
let pickLock = 0
let quietUntil = 0
let lastDirty = 0
let hookReady = false

export const beginHomeworkPick = () => {
  pickLock += 1
}

export const endHomeworkPick = () => {
  pickLock = Math.max(0, pickLock - 1)
  quietUntil = Date.now() + 400
}

export const applyHomeworkLiveState = (state: HomeworkLiveState | null | undefined) => {
  const last = lastHomeworkCard.value
  let rows = state?.states
  if (!last?.questions?.length || !rows?.length) return false
  // 多出来的第一行通常是 .TiMu 包裹层，会把各题已选项拼成「全选」
  if (rows.length === last.questions.length + 1 && String(rows[0]?.selected || '').length > 2) {
    rows = rows.slice(1)
  }
  let changed = false
  const questions = last.questions.map((q) => {
    const row = rows.find((item) => Number(item.index) === Number(q.index)) || rows[Number(q.index) - 1]
    if (!row) return q
    const selected = String(row.selected || '')
    const filled = Boolean(row.filled)
    const options = (q.options || []).map((opt) => {
      const on = selected.includes(opt.letter)
      if (on !== Boolean(opt.selected)) changed = true
      return { ...opt, selected: on }
    })
    if (filled !== Boolean(q.filled)) changed = true
    return { ...q, filled, options }
  })
  const filledCount = questions.filter((item) => item.filled).length
  if (filledCount !== last.filledCount) changed = true
  if (!changed) return false
  publishHomeworkCard({ ...last, questions, filledCount })
  return true
}

export const readHomeworkLiveState = async (id: string) => {
  const state = asObject(await evalBrowserView(id, READ_HW_FILL_STATE).catch(() => null))
  if (!state || !Array.isArray(state.states)) return null
  return state as HomeworkLiveState
}

const installHomeworkHook = async (id: string) => {
  const installed = asObject(await evalBrowserView(id, INSTALL_HW_LIVE_HOOK).catch(() => null))
  hookReady = Boolean(installed.ok)
  if (Number(installed.dirty) > 0) lastDirty = Number(installed.dirty)
  return installed
}

const tickHomeworkLive = async (id: string) => {
  if (pickLock || liveId !== id || Date.now() < quietUntil) return
  if (!hookReady) await installHomeworkHook(id).catch(() => null)
  const pulse = asObject(await evalBrowserView(id, READ_HW_DIRTY).catch(() => null))
  const dirty = Number(pulse.n) || 0
  if (!dirty || dirty === lastDirty) return
  lastDirty = dirty
  const state = await readHomeworkLiveState(id).catch(() => null)
  if (state) applyHomeworkLiveState(state)
}

export const stopHomeworkLiveSync = () => {
  if (liveTimer) window.clearInterval(liveTimer)
  liveTimer = 0
  liveId = ''
  lastDirty = 0
  hookReady = false
}

export const startHomeworkLiveSync = async (id: string) => {
  const next = String(id || '').trim()
  if (!next) {
    stopHomeworkLiveSync()
    return null
  }
  if (liveId !== next || !liveTimer) {
    stopHomeworkLiveSync()
    liveId = next
    liveTimer = window.setInterval(() => {
      void tickHomeworkLive(next)
    }, 220)
  }
  await installHomeworkHook(next).catch(() => null)
  const state = await readHomeworkLiveState(next).catch(() => null)
  if (state) applyHomeworkLiveState(state)
  return state
}

export const installHomeworkLiveSync = startHomeworkLiveSync
