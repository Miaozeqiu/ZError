import { describe, expect, it } from 'vitest'
import { judgeFinish } from '../../src/services/agent/finishGate'
import { applyBrowserTodo, pendingTodos } from '../../src/services/agent/browserTodo'

describe('finishGate', () => {
  it('暂停视频拒绝 done', () => {
    const judged = judgeFinish('done', '已经播完这节', {
      intent: 'play',
      kind: 'player',
      hasVideo: true,
      paused: true,
      playing: false,
      watching: false,
      todos: [{ id: 't1', text: '播视频2', status: 'done' }],
    })
    expect(judged.ok).toBe(false)
    if (!judged.ok) expect(judged.error).toMatch(/暂停/)
  })

  it('pending todo 拒绝 done', () => {
    const judged = judgeFinish('done', '做完了', {
      intent: 'play',
      kind: 'player',
      playing: true,
      todos: [{ id: 't1', text: '播视频2', status: 'pending' }],
    })
    expect(judged.ok).toBe(false)
    if (!judged.ok) expect(judged.error).toMatch(/清单/)
  })

  it('一条视频在播不能当成整门课做完', () => {
    const judged = judgeFinish('done', '已经在播了', {
      intent: 'play',
      kind: 'player',
      playing: true,
      watching: true,
      hasCard: false,
      url: 'https://www.zjooc.cn/ucenter/student/course/study/abc/plan/detail/xyz',
      todos: [{ id: 't1', text: '播完当前课', status: 'done' }],
    })
    expect(judged.ok).toBe(false)
    if (!judged.ok) expect(judged.error).toMatch(/在播|watching/)
  })

  it('watching 无监控拒绝', () => {
    const judged = judgeFinish('watching', '交给监控了', {
      intent: 'play',
      kind: 'player',
      watching: false,
      watchStatus: '',
    })
    expect(judged.ok).toBe(false)
    if (!judged.ok) expect(judged.error).toMatch(/监控/)
  })

  it('课程计划全部完成才可以通过', () => {
    const playing = judgeFinish('done', '视频2正在播', {
      intent: 'play',
      kind: 'player',
      playing: true,
      todos: [{ id: 't1', text: '播视频2', status: 'done' }],
    })
    expect(playing.ok).toBe(false)
    const judged = judgeFinish('done', '计划里的条目都做完了', {
      intent: 'play',
      kind: 'player',
      playing: false,
      planComplete: true,
      planDone: 2,
      planTotal: 2,
      url: 'https://www.zjooc.cn/plan/detail/1',
      todos: [{ id: 't1', text: '播视频2', status: 'done' }],
    })
    expect(judged.ok).toBe(true)
  })

  it('finish 不再批量勾完清单', () => {
    const current = applyBrowserTodo([], { action: 'set', items: ['打开课', '播视频2'] })
    expect(current.ok).toBe(true)
    if (!current.ok) return
    expect(pendingTodos(current.todos)).toHaveLength(2)
    const judged = judgeFinish('done', '好了', {
      intent: 'play',
      kind: 'player',
      playing: true,
      planTotal: 2,
      planDone: 0,
      todos: current.todos,
    })
    expect(judged.ok).toBe(false)
    expect(pendingTodos(current.todos)).toHaveLength(2)
  })
})
