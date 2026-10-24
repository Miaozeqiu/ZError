import { describe, expect, it, vi } from 'vitest'
import { collectFinishEvidence, judgeFinish } from '../../src/services/agent/finishGate'
import { applyBrowserTodo, pendingTodos } from '../../src/services/agent/browserTodo'
import * as appBrowser from '../../src/services/browser/appBrowser'
import { lastHomeworkCard } from '../../src/services/browser/abstractions'
import { clearBrowserTaskIntent, setBrowserTaskIntent } from '../../src/services/agent/browserTask'

describe('finishGate', () => {
  it('遗留未填题卡缓存不能干扰已完成的通用浏览器任务', async () => {
    const prev = lastHomeworkCard.value
    const peek = vi.spyOn(appBrowser, 'peekAppBrowserUrl').mockReturnValue('https://www.zjooc.cn/ucenter/student/course/build/homework')
    lastHomeworkCard.value = { questionCount: 10, filledCount: 0, next: 'fill', url: 'https://another.example/old-work' }
    setBrowserTaskIntent('legacy-test', 'homework')
    try {
      const evidence = await collectFinishEvidence('current-tab', 'legacy-test', {
        todos: [{ id: '1', text: '提交并核对回执', status: 'done' }],
      })
      expect(judgeFinish('done', '绦虫作业已批阅，20/20', evidence).ok).toBe(true)
    } finally {
      lastHomeworkCard.value = prev
      clearBrowserTaskIntent('legacy-test')
      peek.mockRestore()
    }
  })
  it('通用浏览器提交作业后可以结束，不依赖已删除的题卡计数', () => {
    const judged = judgeFinish('done', '绦虫作业已提交，列表显示20/20、已批阅', {
      intent: 'homework', kind: 'unknown', multiStep: true,
      url: 'https://www.zjooc.cn/ucenter/student/course/build/homework',
      todos: ['打开作业', '读取题目', '作答核对', '提交并核对回执'].map((text, i) => ({ id: String(i), text, status: 'done' as const })),
    })
    expect(judged.ok).toBe(true)
  })

  it('作答页不要求解析器字段，未完成清单仍拦截', () => {
    const evidence = { intent: 'homework' as const, kind: 'homework-do' as const, todos: [{ id: '1', text: '保存答案', status: 'done' as const }] }
    expect(judgeFinish('done', '已保存，页面显示保存成功', evidence).ok).toBe(true)
    expect(judgeFinish('done', '做完了', { ...evidence, todos: [{ id: '1', text: '保存答案', status: 'pending' }] }).ok).toBe(false)
  })

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
