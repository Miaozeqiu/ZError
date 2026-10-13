/** 学习通目录和监控。通用课程循环只在能力打开时调用这里。 */

export const readChaoxingCourseItems = async (browserId: string) => {
  const { readChaoxingChapterSnap } = await import('../../chaoxing/study/chapters')
  const snap = await readChaoxingChapterSnap(browserId).catch(() => null)
  const chapters = Array.isArray(snap?.chapters) ? snap.chapters : []
  return chapters
    .filter((row) => row.unfinished || row.active)
    .map((row) => String(row.title || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export const startChaoxingCourseWatch = async (
  browserId: string,
  sessionId: string,
  seed: { title?: string; current?: number; paused?: boolean; ended?: boolean },
) => {
  const { startChaoxingWatch } = await import('../../chaoxing/browser/watch')
  startChaoxingWatch(browserId, sessionId, seed)
}
