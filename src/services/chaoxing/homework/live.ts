import { lastHomeworkCard, publishHomeworkCard } from '../../browser/abstractions'
import { asObject, evalBrowserView } from '../../browser/eval'
import { createDebounce, onHomeworkChanged, readLastTick } from '../../browser/pushEvents'
import { READ_HW_FILL_STATE } from './scripts'
import type { HomeworkLiveState } from './types'

let liveOff: (() => void) | null = null
let liveId = ''
let pickLock = 0
let quietUntil = 0
const debounceLive = createDebounce(300)

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
  const cached = await readLastTick(id, '', 'hw').catch(() => null)
  if (cached?.ok && cached.states?.length && cached.ageMs <= 2000) {
    return { states: cached.states } as HomeworkLiveState
  }
  const state = asObject(await evalBrowserView(id, READ_HW_FILL_STATE()).catch(() => null))
  if (!state || !Array.isArray(state.states)) return null
  return state as HomeworkLiveState
}

const tickHomeworkLive = async (id: string) => {
  if (pickLock || liveId !== id || Date.now() < quietUntil) return
  const state = await readHomeworkLiveState(id).catch(() => null)
  if (state) applyHomeworkLiveState(state)
}

export const stopHomeworkLiveSync = () => {
  liveOff?.()
  liveOff = null
  liveId = ''
}

export const startHomeworkLiveSync = async (id: string) => {
  const next = String(id || '').trim()
  if (!next) {
    stopHomeworkLiveSync()
    return null
  }
  if (liveId !== next || !liveOff) {
    stopHomeworkLiveSync()
    liveId = next
    liveOff = onHomeworkChanged(next, (_id, states) => {
      debounceLive(() => {
        if (pickLock || liveId !== next || Date.now() < quietUntil) return
        if (states.length) applyHomeworkLiveState({ states })
        else void tickHomeworkLive(next)
      })
    })
  }
  const state = await readHomeworkLiveState(next).catch(() => null)
  if (state) applyHomeworkLiveState(state)
  return state
}

export const installHomeworkLiveSync = startHomeworkLiveSync
