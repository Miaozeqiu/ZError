import { actOnceOnBrowser } from '../../browser/engine'
import { evalBrowserViewInFrame } from '../../browser/eval'
import { callProtocol } from '../../browser/protocol'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'
import { readStudentChapterCard, revealChapterJob, sameStudentChapterPage } from './chapterTasks'
import source from './chapterDiscussionPage.js?raw'
import { pageScript } from './pageScript'

type Chapter = NonNullable<Awaited<ReturnType<typeof readStudentChapterCard>>>
type Frame = { frameId: string; loaderId: string; url: string }
type Topic = {
  title: string; question: string; hasImages: boolean; replies: string[]; matchingReplyIds: string[]
  input: string; submit: string; draft: 'empty' | 'matches' | 'other'
}
type Options = { browserId: string; chapterKey: string; discussionId: string; tab: number; wait: (ms: number) => Promise<unknown>; reply?: string }
type SendState = { reply: string; seen: Set<string>; posted: boolean }
const sending = new Set<string>()
const sent = new Map<string, SendState>()

function discussionUrl(raw: string, chapter: Chapter) {
  const url = chaoxingUrl(raw)
  if (!url || url.hostname !== 'groupweb.chaoxing.com'
    || !/^\/course\/topic\/v3\/bbs\/[\w-]+\/[\w-]+\/replysList\/?$/i.test(url.pathname)) return null
  const [course, clazz] = chapter.identity.courseKey.split(':')
  return url.searchParams.get('courseId') === course && url.searchParams.get('classId') === clazz ? url : null
}

function cardMatches(raw: string, chapter: Chapter, discussionId: string) {
  const url = chaoxingUrl(raw)
  if (!url || !/^\/(?:(?:mooc2?-ans)\/)?bbscircle\/chapter\/?$/i.test(url.pathname)) return false
  const params = new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]))
  const [course, clazz] = chapter.identity.courseKey.split(':')
  return params.get('mtopicid') === discussionId && params.get('knowledgeid') === chapter.identity.chapterId
    && params.get('courseid') === course && params.get('clazzid') === clazz && params.get('ut') === 's'
}

const receipt = (chapter: Chapter, discussionId: string, status: string, extra: Record<string, unknown> = {}) => ({
  ok: true, status, chapterKey: chapter.identity.key, tab: chapter.header.tab, discussion_id: discussionId,
  remaining: chapter.header.remaining, chapterComplete: chapter.header.remaining === 0, ...extra,
})
const unavailable = (reason: string, error: string, clickDispatched = false) => ({ ok: false, reason, error, clickDispatched })

export async function handleChapterDiscussion({ browserId, chapterKey, discussionId, tab, wait, reply }: Options) {
  const chapter = await readStudentChapterCard(browserId)
  if (!chapter || chapter.identity.key !== chapterKey || chapter.header.tab !== tab || !chapter.cards?.frameId) {
    return unavailable('stale', '当前讨论所属的章节或页签已切换。')
  }
  const jobs = chapter.jobs?.filter(job => job.discussionId === discussionId) ?? []
  const job = jobs[0]
  if (jobs.length !== 1 || !job?.selector) return unavailable('not_found', '没有定位到唯一的章节讨论任务点。')
  const isDone = (state: Chapter) => state.header.remaining === 0 || state.jobs?.some(item => item.discussionId === discussionId && item.done)
  if (isDone(chapter)) return receipt(chapter, discussionId, 'discussion_completed', { jobDone: true })

  const snapshot = await callProtocol(browserId, 'snapshot', { acted: true, frame: chapter.cards.frameId, maxFrames: 1 }).catch(() => null)
  const cards = (Array.isArray(snapshot?.frames) ? snapshot.frames : []).find(frame =>
    frame.frameId === chapter.cards?.frameId && frame.url === chapter.cards?.url && frame.loaderId) as Frame | undefined
  if (!cards) return unavailable('stale', '章节讨论卡片已刷新。')
  const frameSelector = `iframe[data-ze-discussion="${discussionId}"]`
  const inFrame = <T>(frame: Frame, script: string): Promise<T | null> =>
    evalBrowserViewInFrame(browserId, `(function(){ if(location.href !== ${JSON.stringify(frame.url)}) return null; return (${script}); })()`, '', frame)
      .catch(() => null)
  const getFrames = async (selector: string): Promise<Frame[]> => {
    const result = await callProtocol(browserId, 'attachment_frames', {
      locator: { by: 'css', value: selector, frameId: cards.frameId, loaderId: cards.loaderId },
    }).catch(() => null)
    return (Array.isArray(result?.frames) ? result.frames : []).filter(frame => frame.frameId && frame.loaderId)
  }
  await wait(0)
  if (!await inFrame(cards, revealChapterJob(cards.url, job.selector, chapter.rules))) return unavailable('stale', '没有打开目标讨论卡片。')
  let card: Frame | undefined
  let target: URL | null = null
  let cardCompleted = false
  const readCard = (frame: Frame) => inFrame<{ href: string; done: boolean }>(frame, `({
    href: document.querySelector('#topicMainDiv')?.getAttribute('data') || '',
    done: document.querySelector('#isFinished')?.value === 'true',
  })`)
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = (await getFrames(job.selector)).filter(frame => cardMatches(frame.url, chapter, discussionId))
    if (found.length > 1) return unavailable('ambiguous', '检测到多个同名讨论框。')
    card = found[0]
    const data = card && await readCard(card)
    if (data?.href && card) {
      try { target = discussionUrl(new URL(data.href, card.url).href, chapter) } catch { /* invalid link */ }
      cardCompleted = data.done
      break
    }
    await wait(200)
  }
  if (cardCompleted) return receipt(chapter, discussionId, 'discussion_completed', { jobDone: true })
  if (!target || !card) return unavailable('not_found', '学习通讨论卡片暂未提供可核对的话题。')

  // Keep the original student chapter open while showing the native topic next to its task card.
  const topicKey = target.pathname + '|' + chapter.identity.courseKey
  const currentChapter = async () => {
    const state = await readStudentChapterCard(browserId)
    return state && sameStudentChapterPage(state, chapter)
      && state.cards?.frameId === cards.frameId && state.cards.url === cards.url ? state : null
  }
  const opened = await inFrame<boolean>(cards, `(function(){
    const owners = document.querySelectorAll(${JSON.stringify(job.selector)});
    if (owners.length !== 1) return false;
    const box = owners[0].closest('.ans-attach-ct');
    if (!box?.querySelector('.ans-job-icon')) return false;
    const url = ${JSON.stringify(target.href)};
    for (const old of document.querySelectorAll('iframe[data-ze-discussion]')) {
      if (old.dataset.zeDiscussion === ${JSON.stringify(discussionId)} && old.src === url) return true;
      old.remove();
    }
    const frame = document.createElement('iframe');
    frame.dataset.zeDiscussion = ${JSON.stringify(discussionId)};
    frame.title = '章节讨论';
    frame.style.cssText = 'display:block;width:100%;height:560px;border:0;';
    frame.src = url;
    box.after(frame);
    return true;
  })()`)
  if (!opened) return unavailable('stale', '当前任务点的位置已变化。')
  const readTopic = (frame: Frame, text = reply) => inFrame<Topic>(frame,
    pageScript(source, `return discussionPage(${JSON.stringify(text ?? '')});`))
  const topicFrames = async () => (await getFrames(frameSelector)).filter(frame =>
    discussionUrl(frame.url, chapter)?.pathname === target.pathname)
  let topicFrame: Frame | undefined
  let topic: Topic | null = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const frames = await topicFrames()
    if (frames.length > 1) return unavailable('ambiguous', '检测到多个讨论回复页。')
    topicFrame = frames[0]
    topic = topicFrame ? await readTopic(topicFrame, sent.get(topicKey)?.reply ?? reply) : null
    if (topic && (topic.title || topic.question || topic.hasImages)) break
    await wait(200)
  }
  if (!topicFrame || !topic || !(topic.title || topic.question || topic.hasImages)) return unavailable('not_found', '讨论内容尚未加载，或页面受访问限制。')
  if (!await currentChapter()) return unavailable('stale', '章节页签已改变。')

  const action = (selector: string, op: 'click' | 'fill', text?: string) =>
    actOnceOnBrowser(browserId, { ...topicFrame!, by: 'css', value: selector }, op, text)
  const setPosted = (state: SendState, current: Topic | null) => {
    if (current?.matchingReplyIds.some(id => !state.seen.has(id))) state.posted = true
    return state.posted
  }
  const verify = async (state: SendState, poll: boolean) => {
    setPosted(state, topic)
    if (poll || state.posted) await inFrame(card!, 'location.reload()')
    for (let attempt = 0; attempt < (poll ? 8 : 1); attempt++) {
      await wait(attempt ? 300 : 0)
      if (poll && !state.posted) {
        let current = await readTopic(topicFrame!, state.reply)
        if (!current) {
          const frames = await topicFrames()
          if (frames.length === 1) {
            topicFrame = frames[0]
            current = await readTopic(topicFrame, state.reply)
          }
        }
        setPosted(state, current)
      }
      const live = await currentChapter()
      if (!live) return unavailable('stale', '回复后章节已切换，请核对原讨论回执。', poll)
      if (isDone(live)) {
        await inFrame(cards, `document.querySelector(${JSON.stringify(frameSelector)})?.remove()`)
        return receipt(live, discussionId, 'discussion_completed', { posted: state.posted, jobDone: true, clickDispatched: poll })
      }
      if (poll && attempt === 3) {
        const refreshed = (await getFrames(job.selector)).find(frame => cardMatches(frame.url, chapter, discussionId))
        if (refreshed) await inFrame(refreshed, 'location.reload()')
      }
    }
    if (state.posted) return receipt(chapter, discussionId, 'awaiting_discussion_credit', {
      posted: true, jobDone: false, clickDispatched: poll, hint: '已在讨论列表核对到本次回复，等待学习通登记任务点。请复核原讨论，勿重复发送。',
    })
    return !poll && !reply ? receipt(chapter, discussionId, 'discussion_unverified', {
      hint: '本话题的回复结果仍待核对，请查看实际回复列表与任务点。勿重复发送。',
    }) : unavailable(poll ? 'unstable' : 'verification_required', '上一条回复的结果仍待核对。请查看当前讨论的回复列表。', poll)
  }

  if (sending.has(topicKey)) return unavailable('verification_required', '已有回复正在发送或核对。')
  const prior = sent.get(topicKey)
  if (prior) {
    if (reply && reply !== prior.reply) return unavailable('verification_required', '这个话题已有一条回复发送记录。请用讨论复核工具查看原回执。')
    return verify(prior, false)
  }
  if (!reply) return receipt(chapter, discussionId, 'needs_discussion', {
    discussion: { title: topic.title || job.name, question: topic.question, hasImages: topic.hasImages,
      replies: topic.replies, canReply: Boolean(topic.input && topic.submit) },
    hint: '按用户授权根据题目和参考回复写原创正文。用本次返回的章、页签和话题标识调用 browser_reply_chapter_discussion。',
  })

  sending.add(topicKey)
  try {
    const live = await currentChapter()
    if (!live) return unavailable('stale', '当前课程或讨论已切换。')
    if (isDone(live)) return receipt(live, discussionId, 'discussion_completed', { jobDone: true })
    if (!topic.input || !topic.submit) return unavailable('disabled', '当前话题没有可用的回复表单。')
    if (topic.draft === 'other') return unavailable('verification_required', '讨论框已有其他草稿，请先核对。')
    if (topic.draft !== 'matches' && !(await action(topic.input, 'fill', reply)).ok) {
      return unavailable('stale', '没有核对到讨论框中的回复草稿。')
    }
    topic = await readTopic(topicFrame)
    const beforeSend = await currentChapter()
    if (!topic?.submit || topic.draft !== 'matches' || !beforeSend) return unavailable('stale', '讨论题目或待发送内容已改变。')
    if (isDone(beforeSend)) return receipt(beforeSend, discussionId, 'discussion_completed', { jobDone: true })
    const before = { reply, seen: new Set(topic.matchingReplyIds), posted: false }
    await wait(0)
    sent.set(topicKey, before)
    const clicked = await action(topic.submit, 'click')
    if (!clicked.dispatched) {
      sent.delete(topicKey)
      return unavailable('stale', '没有点击讨论回复按钮，请重新核对表单。')
    }
    return await verify(before, true)
  } finally {
    sending.delete(topicKey)
  }
}
