import { lastHomeworkCard, publishHomeworkCard } from '../browserAbstractions'
import { askFrames, asObject, evalBrowserView } from '../browserEval'
import type { HomeworkLiveState } from './types'

export const applyHomeworkLiveState = (state: HomeworkLiveState | null | undefined) => {
  const last = lastHomeworkCard.value
  const rows = state?.states
  if (!last?.questions?.length || !rows?.length) return false
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
  const state = asObject(await evalBrowserView(id, `(function(){ return window.__ZE_HW_STATE__ || null; })()`).catch(() => null))
  if (!state || !Array.isArray(state.states)) return null
  return state as HomeworkLiveState
}

export const installHomeworkLiveSync = async (id: string) => {
  await askFrames(id, 'hwstate')
  const state = await readHomeworkLiveState(id)
  if (state) applyHomeworkLiveState(state)
  return state
}
