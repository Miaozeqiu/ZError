import { describe, expect, it } from 'vitest'
import {
  applySkips,
  classifyPageSignal,
  clearCoursePlan,
  coursePlanFor,
  courseProgress,
  decideWatchdog,
  itemsFromSnapshot,
  navigationProven,
  nextCourseItem,
  normalizeCourseItem,
  parseRecipe,
  rememberCoursePlan,
  snapshotRecipe,
} from '../../src/services/browser/coursePlan'
import {
  bindCourseRun,
  createCoursePlan,
  noteCourseVideoDone,
  stepCourse,
  stopCourseRun,
} from '../../src/services/browser/courseRunner'

describe('course plan', () => {
  it('跳过测验后，下一条是视频，完成数不含跳过项', () => {
    const items = applySkips([
      normalizeCourseItem({ label: '测验1', kind: 'quiz' }, 0)!,
      normalizeCourseItem({ label: '视频1', kind: 'video' }, 1)!,
    ], { quiz: 'skip' })
    expect(items[0].status).toBe('skipped')
    expect(nextCourseItem(items)?.label).toBe('视频1')
    expect(courseProgress(items)).toEqual({ done: 0, total: 1, complete: false })
  })

  it('配方多出来的字段不收', () => {
    const bad = parseRecipe({ next: 'next-undone', selector: '.foo' })
    expect(bad.ok).toBe(false)
    const good = parseRecipe({ next: 'next-button', nextButton: '下一节', done: { text: '已完成' } })
    expect(good.ok).toBe(true)
  })

  it('登录错误次数直接交给用户，视频卡住先自救两次', () => {
    expect(classifyPageSignal({ text: '今日已错误3次', url: 'https://example.com/login' })).toBe('locked')
    expect(classifyPageSignal({ url: 'https://example.com/login', text: '' })).toBe('login')
    expect(decideWatchdog({ kind: 'locked', heals: 0, incidentRounds: 0 })).toBe('user')
    expect(decideWatchdog({ kind: 'video-stall', heals: 0, incidentRounds: 0 })).toBe('heal')
    expect(decideWatchdog({ kind: 'video-stall', heals: 2, incidentRounds: 0 })).toBe('wake')
    expect(decideWatchdog({ kind: 'login', heals: 2, incidentRounds: 0 })).toBe('wake')
    expect(decideWatchdog({ kind: 'open-failed', heals: 1, incidentRounds: 15 })).toBe('user')
  })

  it('快照目录变成清单，完成标记不再是待办', () => {
    const snapshot = [
      '- treeitem "第一章" [ref=e1]',
      '- treeitem "概述：成衣的概念" [ref=e2] [current]',
      '- treeitem "成衣生产-吊挂传输系统" [ref=e3] [done]',
      '- treeitem "未解锁" [ref=e4] [locked]',
      '- treeitem "课后测验" [ref=e5]',
      '- video "概述：成衣的概念" playing 0:07/17:18 [ref=e9]',
    ].join('\n')
    const { role, items } = itemsFromSnapshot(snapshot)
    expect(role).toBe('treeitem')
    expect(items.map((item) => [item.label, item.kind, item.status])).toEqual([
      ['第一章', 'video', 'pending'],
      ['概述：成衣的概念', 'video', 'pending'],
      ['成衣生产-吊挂传输系统', 'video', 'done'],
      ['未解锁', 'video', 'skipped'],
      ['课后测验', 'quiz', 'pending'],
    ])
    expect(snapshotRecipe(role).current).toBe('[current]')
    expect(snapshotRecipe(role).done).toEqual({ text: '[done]' })
  })

  it('网址或当前标记变了才算打开了下一条', () => {
    const before = '- treeitem "概述" [ref=e1] [current]\n- video "概述" paused 0:00/17:18 [ref=e2]'
    const same = before
    const moved = '- treeitem "概述" [ref=e1] [done]\n- treeitem "下一节" [ref=e3] [current]\n- video "下一节" playing 0:01/10:00 [ref=e4]'
    expect(navigationProven(before, same, { changed: false })).toBe(false)
    expect(navigationProven(before, same, { changed: true })).toBe(true)
    expect(navigationProven(before, moved, { changed: false })).toBe(true)
  })

  it('未验证的配方在打开下一条之后记下，没变就叫醒', async () => {
    const deps = {
      now: () => 0,
      open: async () => ({ ok: true, url: 'https://www.zjooc.cn/plan/detail/2', changed: true, text: '' }),
      play: async () => ({ playing: true }),
      readTick: async () => ({ current: 3, paused: false, ended: false, ageMs: 0, hasVideo: true }),
      readText: async () => '',
      doneCount: async () => 0,
      wake: () => {},
      notifyUser: () => {},
      readSnapshot: async () => '- video "下一节" playing 0:03/10:00 [ref=e1]',
    }
    const plan = createCoursePlan({
      host: 'zjooc.cn',
      courseId: 'course',
      items: [normalizeCourseItem({ label: '下一节', kind: 'video' }, 0)!],
    })
    plan.recipe = snapshotRecipe('treeitem')
    const step = await stepCourse('b-verify', plan, deps)
    expect(plan.recipeVerified).toBe(true)
    expect(step.action).toBe('watching')

    let woke = ''
    const stuck = createCoursePlan({
      host: 'zjooc.cn',
      courseId: 'course',
      items: [normalizeCourseItem({ label: '概述', kind: 'video' }, 0)!],
    })
    stuck.recipe = snapshotRecipe('treeitem')
    const snap = '- treeitem "概述" [ref=e1] [current]\n- video "概述" paused 0:00/17:18 [ref=e2]'
    const blocked = await stepCourse('b-stuck', stuck, {
      ...deps,
      open: async () => ({ ok: true, url: 'https://www.zjooc.cn/plan', changed: false, text: '' }),
      readSnapshot: async () => snap,
      wake: (text) => { woke = text },
    })
    expect(stuck.recipeVerified).toBe(false)
    expect(blocked.action).toBe('needs-agent')
    expect(woke).toMatch(/没有变/)
    clearCoursePlan('b-verify')
    clearCoursePlan('b-stuck')
    expect(coursePlanFor('b-verify')).toBeNull()
  })

  it('播完后宿主打开下一条', async () => {
    const plan = createCoursePlan({
      host: 'zjooc.cn',
      courseId: 'c',
      items: [
        normalizeCourseItem({ label: '第一节', kind: 'video' }, 0)!,
        normalizeCourseItem({ label: '第二节', kind: 'video' }, 1)!,
      ],
    })
    plan.recipeVerified = true
    plan.recipe = snapshotRecipe('treeitem')
    rememberCoursePlan('b-next', plan)
    const opened: string[] = []
    bindCourseRun('b-next', 's-next', {
      now: () => 1,
      open: async (item) => {
        opened.push(item.label)
        return { ok: true, url: 'https://www.zjooc.cn/plan/detail/2', changed: true, text: '' }
      },
      play: async () => ({ playing: true }),
      readTick: async () => ({ current: 1, paused: false, ended: false, ageMs: 0, hasVideo: true }),
      readText: async () => '',
      doneCount: async () => 1,
      wake: () => {},
      notifyUser: () => {},
    })
    await noteCourseVideoDone('s-next')
    expect(opened).toEqual(['第二节'])
    stopCourseRun('s-next')
    clearCoursePlan('b-next')
  })

  it('同一条打转三次算卡住', () => {
    expect(classifyPageSignal({ spinCount: 3 })).toBe('spin')
    expect(classifyPageSignal({ opened: true, changed: false })).toBe('open-failed')
    expect(classifyPageSignal({ videoStalled: true, opened: true, changed: true })).toBe('video-stall')
  })
})
