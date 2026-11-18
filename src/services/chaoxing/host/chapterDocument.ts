import source from './chapterDocumentViewer.js?raw'
import { pageScript } from './pageScript'
import { callProtocol } from '../../browser/protocol'
import { actOnceOnBrowser } from '../../browser/engine'
import { evalBrowserViewInFrame } from '../../browser/eval'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'

type Frame = { frameId: string; loaderId: string; url: string }
type Reader = { action: 'next' | 'scroll' | 'select' | 'wait' | 'end' | 'unavailable'; position: string; selector?: string; delay: number }
type Context = {
  browserId: string; cards: { frameId: string; url: string }; selector: string
  wait: (ms: number) => Promise<unknown>
  observe: () => Promise<'done' | 'pending' | 'stale'>
}
type Status = 'done' | 'stale' | 'needs_document'

const isViewer = (frame: Frame) => {
  const url = chaoxingUrl(frame.url)
  return Boolean(url && /\/(?:ananas\/modules\/(?:pdf|ppt|doc|document|innerbook|book|read)\/|insert(?:doc|book)\b|readsvr\/book\/mooc\b|mtiView\/reader\b|screen\/file\b|pdfjs\/)/i.test(url.pathname))
}

export async function readChapterDocument({ browserId, cards, selector, wait, observe }: Context): Promise<Status> {
  const peek = await observe()
  if (peek !== 'pending') return peek
  if (!selector) return 'needs_document'
  const snapshot = await callProtocol(browserId, 'snapshot', { acted: true, frame: cards.frameId, maxFrames: 1 }).catch(() => null)
  const card = (Array.isArray(snapshot?.frames) ? snapshot.frames : [])
    .find(frame => frame.frameId === cards.frameId && frame.url === cards.url && frame.loaderId)
  if (!card) return 'needs_document'
  const candidates = async () => {
    const result = await callProtocol(browserId, 'attachment_frames', {
      locator: { by: 'css', value: selector, frameId: card.frameId, loaderId: card.loaderId },
    }).catch(() => null)
    return (Array.isArray(result?.frames) ? result.frames : []).filter((frame: Frame) =>
      frame.frameId && frame.loaderId && isViewer(frame)) as Frame[]
  }
  const read = async (frame: Frame, advance = false): Promise<Reader | null> => {
    const script = pageScript(source, 'return location.href === ' + JSON.stringify(frame.url) + ' ? chapterDocument(' + advance + ') : null;')
    return evalBrowserViewInFrame(browserId, script, '', frame).catch(() => null)
  }
  const advanced = new Set<string>()
  let timedWait = ''
  let idle = 0
  let frames: Frame[] = []
  while (true) {
    await wait(0)
    const status = await observe()
    if (status !== 'pending') return status
    if (!frames.length) frames = await candidates()
    const readings = await Promise.all(frames.map(async frame => ({ frame, viewer: await read(frame) })))
    const active = readings.filter(entry => entry.viewer && entry.viewer.action !== 'unavailable')
    // Prefer the reader that can scroll or turn pages, not the surrounding toolbar.
    const actionable = active.filter(entry => ['next', 'scroll', 'select'].includes(entry.viewer?.action || ''))
    if (actionable.length > 1) return 'needs_document'
    const current = actionable[0]
    const viewer = current?.viewer
    const position = current && viewer ? current.frame.frameId + '|' + viewer.position : ''
    if (!viewer || advanced.has(position)) {
      if (++idle >= 12) return 'needs_document'
      const cooling = active.find(entry => (entry.viewer?.action === 'wait' || entry.viewer?.action === 'end') && entry.viewer.delay)?.viewer
      if (cooling && cooling.position !== timedWait) {
        timedWait = cooling.position
        await wait(cooling.delay)
      }
      if (!viewer) frames = []
      await wait(350)
      continue
    }
    // A timed reader specifies the minimum dwell for each page.
    await wait(viewer.delay || 450)
    const settled = await observe()
    if (settled !== 'pending') return settled
    const live = await read(current.frame)
    if (live?.action !== viewer.action || live.position !== viewer.position || live.selector !== viewer.selector) {
      if (++idle >= 12) return 'needs_document'
      frames = []
      continue
    }
    idle = 0
    advanced.add(position)
    await wait(0)
    if (viewer.action === 'scroll' || viewer.action === 'select') {
      await read(current.frame, true)
    } else if (viewer.selector) {
      const clicked = await actOnceOnBrowser(browserId, { ...current.frame, by: 'css', value: viewer.selector }, 'click')
      if (!clicked.dispatched) return 'needs_document'
    }
    await wait(350)
  }
}
