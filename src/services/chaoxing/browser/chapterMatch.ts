/** 节名 / 任务点是否同一条。 */

export const catalogIndex = (value: unknown) => {
  const hit = String(value || '').trim().match(/^(\d+(?:\.\d+)+)\b/)
  return hit?.[1] || ''
}

export const titlesMatch = (a: unknown, b: unknown) => {
  const ia = catalogIndex(a)
  const ib = catalogIndex(b)
  if (ia && ib && ia !== ib) return false
  const left = String(a || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ia
  const right = String(b || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ib
  if (!left || !right) return ia && ib && ia === ib
  if (ia && ib) return left === right
  return left === right || left.includes(right) || right.includes(left)
}

export const sameChapterJob = (
  left: { mid?: string; jobid?: string; label?: string; kind?: string },
  right: { mid?: string; jobid?: string; label?: string; kind?: string },
) => {
  const leftMid = String(left.mid || '').trim()
  const rightMid = String(right.mid || '').trim()
  if (leftMid && rightMid && leftMid === rightMid) return true
  const leftJob = String(left.jobid || '').trim()
  const rightJob = String(right.jobid || '').trim()
  if (leftJob && rightJob && leftJob === rightJob) return true
  return Boolean(
    left.kind
    && left.kind === right.kind
    && String(left.label || '').trim()
    && String(left.label || '').trim() === String(right.label || '').trim(),
  )
}

/** 同一节里任务点一旦完成，页面图标回闪未完成也不能再当未做。跨节同名「视频1」不继承。 */
export const stickyJobDone = (
  prev: Array<{ mid?: string; jobid?: string; label?: string; kind?: string; jobDone?: boolean }>,
  item: { mid?: string; jobid?: string; label?: string; kind?: string; jobDone?: boolean },
  sameChapter: boolean,
) => {
  if (item.jobDone) return true
  if (!sameChapter) return false
  return prev.some((row) => row.jobDone && sameChapterJob(row, item))
}

/** 直播页任务点是否属于面板上的当前节。切章后上一节的 jobs 不能跟过来。 */
export const liveJobsBelongHere = (
  here: { title?: string; chapterId?: string },
  live: { title?: string; chapterId?: string },
) => {
  const hereTitle = String(here.title || '').trim()
  const liveTitle = String(live.title || '').trim()
  if (hereTitle && liveTitle) return titlesMatch(hereTitle, liveTitle)
  const hereId = String(here.chapterId || '').replace(/\D/g, '')
  const liveId = String(live.chapterId || '').replace(/\D/g, '')
  if (hereId && liveId) return hereId === liveId
  return true
}

/** 刚切章或还没任务点时必须整页重读，不能因为上一节还在 watch 就只打 live。 */
export const studyNeedsFullJobRead = (
  state: { expectChapterTitle?: string; jobs?: Array<{ kind?: string }> } | null | undefined,
) => (
  Boolean(state?.expectChapterTitle)
  || !(state?.jobs || []).some((job) => job.kind === 'video')
)


export const isCatalogSectionTitle = (title: string) => {
  const text = String(title || '').trim()
  if (!text) return false
  if (/^[一二三四五六七八九十]+[、.]/.test(text)) return false
  if (/单选题|多选题|判断题|填空题|共\s*\d+\s*题/.test(text)) return false
  if (/待完成任务点|已完成任务点|个任务点/.test(text)) return false
  return true
}

