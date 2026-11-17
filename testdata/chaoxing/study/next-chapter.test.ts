import { describe, expect, it } from 'vitest'
import {
  decidePanelEvent,
  formatStudyPanelNudge,
  packAgentPanel,
  pickNextStudyChapter,
  pickPanelActionJob,
  pickPlayableJob,
} from '../../../src/services/chaoxing/browser/panelStudy'
import { recipeForPage } from '../../../src/services/agent/browserLoop'
import { videoIsPlaying } from '../../../src/services/chaoxing/study/video'
import { browserChapterStates } from '../../../src/services/chaoxing/browser/chapters'

const sections = [
  { title: '1.1 函数（一）', unfinished: true, active: true, chapterId: '1065429912', kind: 'section' as const },
  { title: '1.2 函数（二）', unfinished: true, active: false, chapterId: '1065429913', kind: 'section' as const },
  { title: '1.3 极限的概念', unfinished: true, active: false, chapterId: '1065429914', kind: 'section' as const },
]

describe('pickNextStudyChapter', () => {
  it('当前节只剩测验时，下一节是 1.2 不是再打开 1.1', () => {
    const next = pickNextStudyChapter(sections, { chapterId: '1065429912', title: '1.1 函数（一）' })
    expect(next?.title).toBe('1.2 函数（二）')
  })

  it('没有 active 时也按 chapterId 跳过当前节', () => {
    const stale = sections.map((item) => ({ ...item, active: false }))
    const next = pickNextStudyChapter(stale, { chapterId: '1065429912' })
    expect(next?.title).toBe('1.2 函数（二）')
  })
})

describe('解析面板暂停要写给 Agent', () => {
  it('还有测验时提示先处理，不默认跳过', () => {
    browserChapterStates.value = { t1: {
      browserId: 't1', url: '', page: 'player', kind: 'player', current: '1.1', currentTitle: '1.1',
      unfinished: ['1.1'], unfinishedCount: 1, chapters: [], progress: null, video: null,
      jobs: [
        { mid: '1', jobid: '', label: '视频1', kind: 'video', jobDone: true, unfinished: false, active: false },
        { mid: '', jobid: '', label: '测验', kind: 'quiz', jobDone: false, unfinished: true, active: true },
      ], status: 'ready', updatedAt: Date.now(),
    } }
    const panel = packAgentPanel('t1')
    expect(panel?.event).toBe('quiz_left')
    expect(panel?.hint).toContain('完成剩余任务')
    expect(panel?.hint).not.toContain('默认跳过')
  })
  it('当前视频暂停时 event 是 video_paused', () => {
    expect(decidePanelEvent([
      { kind: 'video', jobDone: true, paused: false },
      { kind: 'video', jobDone: false, active: true, paused: true },
    ])).toBe('video_paused')
  })

  it('当前是后面的视频暂停时，下一步是它而不是视频1', () => {
    expect(pickPanelActionJob([
      { kind: 'video', jobDone: false, active: false, label: '视频1' },
      { kind: 'video', jobDone: false, active: true, paused: true, label: '视频2' },
      { kind: 'video', jobDone: false, active: false, label: '视频3' },
    ])?.label).toBe('视频2')
  })

  it('继续时的 nudge 必须写出当前暂停的视频', () => {
    browserChapterStates.value = {
      t1: {
        browserId: 't1',
        url: '',
        page: 'player',
        kind: 'player',
        current: '1.3 极限的概念',
        currentTitle: '1.3 极限的概念',
        unfinished: ['1.3 极限的概念'],
        unfinishedCount: 1,
        chapters: [],
        progress: null,
        video: null,
        jobs: [
          { mid: '1', jobid: '', label: '视频1', kind: 'video', jobDone: false, unfinished: true, active: false },
          { mid: '2', jobid: '', label: '视频3', kind: 'video', jobDone: false, unfinished: true, active: true, paused: true, percent: 6 },
          { mid: '3', jobid: '', label: '视频4', kind: 'video', jobDone: false, unfinished: true, active: false },
        ],
        status: 'ready',
        updatedAt: Date.now(),
      },
    }
    const panel = packAgentPanel('t1')
    expect(panel?.event).toBe('video_paused')
    expect(panel?.thisSection.next?.label).toBe('视频3')
    expect(panel?.jobLine).toContain('暂停')
    expect(panel?.hint).toContain('视频3')
    const nudge = formatStudyPanelNudge('t1')
    expect(nudge).toContain('暂停')
    const recipe = recipeForPage({
      siteId: 'chaoxing',
      kind: 'player',
      intent: 'play',
      panel: { event: 'video_paused', thisSection: { next: { label: '视频3', kind: 'video' } } },
    })
    expect(recipe).toContain('视频3暂停了')
    expect(recipe).toContain('没有在播')
    expect(recipe).toContain('快照 ref')
    expect(recipe).toContain('browser_watch')
  })
})

describe('pickPlayableJob', () => {
  const jobs = [
    { mid: '1', jobid: '', label: '视频1', kind: 'video' as const, jobDone: true, unfinished: false, active: true },
    { mid: '2', jobid: '', label: '视频2', kind: 'video' as const, jobDone: false, unfinished: true, active: false },
    { mid: '', jobid: '', label: '测验', kind: 'quiz' as const, jobDone: false, unfinished: true, active: false },
  ]

  it('指定已完成的视频1时改播未完成的视频2', () => {
    expect(pickPlayableJob(jobs, { label: '视频1' })?.label).toBe('视频2')
    expect(pickPlayableJob(jobs, { videoIndex: 1 })?.label).toBe('视频2')
  })

  it('skipIfDone=false 时点名的已完成视频照样播', () => {
    expect(pickPlayableJob(jobs, { videoIndex: 1, skipIfDone: false })?.label).toBe('视频1')
  })

  it('本节视频都完成时不再挑已完成的当前视频', () => {
    const onlyQuiz = [
      { mid: '1', jobid: '', label: '视频1', kind: 'video' as const, jobDone: true, unfinished: false, active: true },
      { mid: '', jobid: '', label: '测验', kind: 'quiz' as const, jobDone: false, unfinished: true, active: false },
    ]
    expect(pickPlayableJob(onlyQuiz, { label: '视频1' })).toBeNull()
    expect(pickPlayableJob(onlyQuiz, {})).toBeNull()
  })
})

describe('videoIsPlaying', () => {
  it('paused 缺省或 true 都不能当成在播', () => {
    expect(videoIsPlaying({ current: 152, duration: 632 })).toBe(false)
    expect(videoIsPlaying({ current: 152, duration: 632, paused: true })).toBe(false)
    expect(videoIsPlaying({ current: 152, duration: 632, playing: false, paused: false })).toBe(false)
    expect(videoIsPlaying({ current: 152, duration: 632, paused: false })).toBe(true)
  })
})
