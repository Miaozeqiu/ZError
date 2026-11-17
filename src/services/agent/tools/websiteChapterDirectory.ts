import { parseHtml, readFrameHtml } from '../../browser/domRead'
import { actOnceOnBrowser } from '../../browser/engine'
import { waitMs } from '../../browser/eval'
import { callProtocol } from '../../browser/protocol'
import { chapterRow, courseChapterRows, studentChapterDirectoryUrl, studentChapterUrl } from '../../chaoxing/host/chapterTasks'
import { videoWatchFor } from '../../platform/panelAccess'
import { studentCourseUrl } from '../../platform/chaoxing/studentCourses'

export async function openNextWebsiteChapter(ctx: {
  browserId: string; role?: string; wait?: (ms: number) => Promise<void>; openDirectory?: boolean
}) {
  const { browserId, wait = waitMs } = ctx
  const fail = (reason: string, error: string, clickDispatched = false) => JSON.stringify({ ok: false, reason, error, clickDispatched })
  if (ctx.role === 'explore') return fail('invalid', '当前权限只能查看网页。')
  const watch = videoWatchFor(browserId)
  if (watch?.sessionId && !['done', 'lost'].includes(watch.status)) return fail('invalid', '当前标签仍有视频监控。等待处理完本节后再切换章节。')

  const main = await readFrameHtml(browserId)
  const player = studentChapterUrl(main.url)
  const course = player ? null : studentCourseUrl(main.url)
  const courseKey = player?.courseKey || (course?.clazz ? `${course.id}:${course.clazz}` : '')
  if (!courseKey) return fail('invalid', '请先打开目标课程的学生章节目录或小节。')

  const readDirectory = () => readFrameHtml(browserId, '/mycourse/studentcourse')
  const matchesDirectory = (url: string) => studentChapterDirectoryUrl(url) === courseKey
  let source = player ? main : await readDirectory()
  if (!player && !matchesDirectory(source.url)) {
    if (!ctx.openDirectory) return fail('not_found', '当前课程的章节目录框尚未就绪。请打开本课「章节」页签后重试。')
    const snapshot = await callProtocol(browserId, 'snapshot', { acted: true, maxFrames: 1 }).catch(() => null)
    const frames = Array.isArray(snapshot?.frames) ? snapshot.frames : []
    const root = frames.find(frame => frame.frameId === main.frameId && frame.url === main.url)
    if (!root?.loaderId) return fail('stale', '当前学生课程已切换，请重新核对。')
    await wait(0)
    const tab = await actOnceOnBrowser(browserId, {
      by: 'css', value: 'a[title="章节"][data-url*="/mycourse/studentcourse"]', frameId: root.frameId, loaderId: root.loaderId,
    }, 'click')
    if (!tab.ok) return fail('not_found', '没有找到当前学生课程的「章节」入口。', tab.dispatched)
    for (let i = 0; i < 12; i++) {
      source = await readDirectory()
      if (source.ok && matchesDirectory(source.url)) break
      await wait(250)
    }
    if (!matchesDirectory(source.url)) return fail('stale', '点击章节后尚未读到本课目录，请核对当前页面。', true)
  }
  const doc = source.ok && parseHtml(source.html)
  if (!doc) return fail('not_found', '学习通章节目录尚未加载。')
  const rows = player
    ? [...doc.querySelectorAll('#coursetree .posCatalog_select[id^="cur"]:not(.firstLayer)')]
      .filter(row => /^cur\d+$/.test(row.id))
      .map(row => ({ chapterId: row.id.slice(3), ...chapterRow(row) }))
    : courseChapterRows(doc)
  if (!rows.length) return fail('not_found', '当前目录未读到可核对的小节。请查看目录页是否已加载。')
  const left = rows.filter(row => Number(row.remaining) > 0)
  const active = player && left.find(row => row.chapterId === player.chapterId)
  const next = active || left[0]
  const summary = { pending: left.length, completed: rows.filter(row => row.remaining === 0).length, unknown: rows.filter(row => row.remaining === null).length }
  if (!next) return JSON.stringify({ ok: true, opened: false, ...summary,
    hint: '目录没有明确标出的待完成小节。需要汇报整门课程完成时，核对目录的任务点总数。' })
  if (active && player) return JSON.stringify({ ok: true, opened: true, already: true, chapterKey: player.key, ...next, ...summary })

  const snapshot = await callProtocol(browserId, 'snapshot', {
    acted: true, maxFrames: 1, ...(player ? {} : { frame: source.frameId }),
  }).catch(() => null)
  const frames = Array.isArray(snapshot?.frames) ? snapshot.frames : []
  const target = frames.find(frame => frame.frameId === source.frameId && frame.url === source.url)
  if (!target?.loaderId || snapshot?.url && snapshot.url !== main.url) return fail('stale', '章节目录已经刷新，请重新读取。')
  const selector = player
    ? `#coursetree .posCatalog_select[id="cur${next.chapterId}"] .posCatalog_name`
    : `.chapter_item[id="cur${next.chapterId}"] > .catalog_title[role="link"]`
  await wait(0)
  const clicked = await actOnceOnBrowser(browserId, {
    by: 'css', value: selector, frameId: target.frameId, loaderId: target.loaderId,
  }, 'click')
  if (!clicked.ok) return fail('invalid', '未能打开目录里标出的待完成小节。', clicked.dispatched)

  for (let i = 0; i < 16; i++) {
    const landing = studentChapterUrl((await readFrameHtml(browserId)).url)
    if (landing?.courseKey === courseKey && landing.chapterId === next.chapterId) {
      return JSON.stringify({ ok: true, opened: true, chapterKey: landing.key, ...next, ...summary })
    }
    await wait(350)
  }
  return fail('stale', '未确认进入目标课程的待完成小节，请核对当前页面。', true)
}
