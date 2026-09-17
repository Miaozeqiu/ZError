import { describe, expect, it } from 'vitest'
import {
  browserChapterStates,
  ingestChapterSnap,
  liveJobsBelongHere,
  stickyJobDone,
  studyNeedsFullJobRead,
  type ChapterParseState,
} from '../../../src/services/chaoxing/browser/chapters'

const section = (title: string, chapterId: string, active = false) => ({
  title,
  unfinished: true,
  active,
  chapterId,
  kind: 'section' as const,
  jobs: chapterId === '11' ? 5 : 2,
})

const staleJobs = [
  { mid: '1', jobid: '', label: '视频1', kind: 'video' as const, jobDone: true, unfinished: false, active: false },
  { mid: '2', jobid: '', label: '视频2', kind: 'video' as const, jobDone: true, unfinished: false, active: false },
  { mid: '3', jobid: '', label: '视频3', kind: 'video' as const, jobDone: false, unfinished: true, active: true },
  { mid: '4', jobid: '', label: '视频4', kind: 'video' as const, jobDone: true, unfinished: false, active: false },
  { mid: '', jobid: '', label: '测验', kind: 'quiz' as const, jobDone: false, unfinished: true, active: false },
]

const baseState = (over: Partial<ChapterParseState>): ChapterParseState => ({
  browserId: 't1',
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=11',
  page: 'player',
  kind: 'player',
  current: '1.2 函数（二）',
  currentTitle: '1.2 函数（二）',
  unfinished: ['1.2 函数（二）'],
  unfinishedCount: 1,
  chapters: [
    section('1.1 函数（一）', '11'),
    section('1.2 函数（二）', '12', true),
  ],
  progress: { done: 6, total: 120 },
  video: null,
  jobs: staleJobs,
  jobChapterId: '11',
  status: 'ready',
  updatedAt: Date.now(),
  ...over,
})

describe('liveJobsBelongHere', () => {
  it('切到 1.2 后，直播页还停在 1.1 不算本节', () => {
    expect(liveJobsBelongHere(
      { title: '1.2 函数（二）', chapterId: '' },
      { title: '1.1 函数（一）', chapterId: '11' },
    )).toBe(false)
  })

  it('同节标题一致才算本节', () => {
    expect(liveJobsBelongHere(
      { title: '1.2 函数（二）' },
      { title: '1.2 函数（二）' },
    )).toBe(true)
  })

  it('chapterId 不同也不算', () => {
    expect(liveJobsBelongHere(
      { title: '1.2 函数（二）', chapterId: '12' },
      { title: '1.2 函数（二）', chapterId: '11' },
    )).toBe(false)
  })
})

describe('ingestChapterSnap 切章后任务点', () => {
  it('目录刷新不会把 1.1 的任务点钉到 1.2 下面', () => {
    browserChapterStates.value = { t1: baseState({}) }
    const next = ingestChapterSnap('t1', {
      page: 'player',
      url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=12',
      current: '1.2 函数（二）',
      unfinished: ['1.2 函数（二）'],
      unfinishedCount: 1,
      chapters: [
        { title: '1.1 函数（一）', unfinished: true, jobs: 5, chapterId: '11' },
        { title: '1.2 函数（二）', unfinished: true, jobs: 2, chapterId: '12' },
      ],
    })
    expect(next?.currentTitle).toBe('1.2 函数（二）')
    expect(next?.jobs).toEqual([])
    expect(next?.jobChapterId).toBe('12')
  })

  it('刚切章时目录 tick 也不能把上一节 jobs 带回来', () => {
    browserChapterStates.value = {
      t1: baseState({ jobs: [], jobChapterId: '', expectChapterTitle: '1.2 函数（二）' }),
    }
    const next = ingestChapterSnap('t1', {
      page: 'player',
      url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=11',
      current: '1.1 函数（一）',
      unfinished: ['1.1 函数（一）', '1.2 函数（二）'],
      chapters: [
        { title: '1.1 函数（一）', unfinished: true, jobs: 5, chapterId: '11' },
        { title: '1.2 函数（二）', unfinished: true, jobs: 2, chapterId: '12' },
      ],
    })
    expect(next?.currentTitle).toBe('1.2 函数（二）')
    expect(next?.jobs).toEqual([])
    expect(next?.expectChapterTitle).toBe('1.2 函数（二）')
  })
})

describe('studyNeedsFullJobRead', () => {
  it('刚切章即使还在 watch 也要整页重读任务点', () => {
    expect(studyNeedsFullJobRead({ expectChapterTitle: '1.6 两个重要极限', jobs: [] })).toBe(true)
  })

  it('已经有视频任务点且不在切章就不用整页重读', () => {
    expect(studyNeedsFullJobRead({
      jobs: [{ kind: 'video' }],
    })).toBe(false)
  })
})

describe('stickyJobDone', () => {
  const done = { mid: '', jobid: '', label: '视频1', kind: 'video', jobDone: true }

  it('同节页面回闪未完成时仍算已完成', () => {
    expect(stickyJobDone([done], { ...done, jobDone: false }, true)).toBe(true)
  })

  it('下一节同名视频1不继承上一节的完成状态', () => {
    expect(stickyJobDone([done], { ...done, jobDone: false }, false)).toBe(false)
  })
})
