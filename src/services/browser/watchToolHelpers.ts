import { cachedPageSnap } from './engine/pageSnap'
import { coursePlanFor, coursePlanNudge } from './coursePlan'
export const watchFollowHint = (browserId: string, already: boolean) => {
  const base = already
    ? '已经在监控。现在 finish(watching) 进入当前任务的事件等待；播完或出现异常后继续本任务，不能提前输出最终结果。'
    : '进度条实时更新。现在 finish(watching) 进入当前任务的事件等待；播完或出现异常后继续本任务，不能提前输出最终结果。'
  const nudge = coursePlanNudge(cachedPageSnap(browserId)?.snapshot || '', Boolean(coursePlanFor(browserId)))
  return nudge ? `${base} ${nudge}。` : base
}

export const mediaRefOf = (browserId: string, ref: string, listRefs: (id: string) => Array<{ id?: string; role?: string; locator?: { role?: string; value?: string } }>) => {
  const id = String(ref || '').trim()
  if (!id) return ''
  const hit = listRefs(browserId).find((item) => item.id === id)
  if (!hit) return ''
  const role = String(hit.role || hit.locator?.role || hit.locator?.value || '')
  return role === 'video' || role === 'audio' ? id : ''
}
