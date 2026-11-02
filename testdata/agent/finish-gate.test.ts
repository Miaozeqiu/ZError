import { describe, expect, it, vi } from 'vitest'
import { collectFinishEvidence, judgeFinish } from '../../src/services/agent/finishGate'
import { applyBrowserTodo, pendingTodos } from '../../src/services/agent/browserTodo'
import * as appBrowser from '../../src/services/browser/appBrowser'
import { lastHomeworkCard } from '../../src/services/browser/abstractions'
import { clearBrowserTaskIntent, rememberBrowserTaskIntent, setBrowserTaskIntent } from '../../src/services/agent/browserTask'
import * as study from '../../src/services/chaoxing/study'

describe('finishGate', () => {
  it('当前用户的只读复核有新页面证据时，不要求完成当前页面的整门课程', async () => {
    const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=2'
    const peek = vi.spyOn(appBrowser, 'peekAppBrowserUrl').mockReturnValue(url)
    const read = vi.spyOn(study, 'readChaoxingVideoTick').mockResolvedValue(null)
    setBrowserTaskIntent('review-production', 'play') // Previous course intent cannot redefine the new user request.
    const steps = [{ id: 'review', kind: 'tool' as const, name: 'browser_get_page', label: '只读核对', status: 'done' as const,
      result: JSON.stringify({ ok: true, url, observation_id: 'review', observed_browser_id: 'review-tab', observed_at: Date.now() }) }]
    try {
      const evidence = await collectFinishEvidence('review-tab', 'review-production', { goalText: '只读复核当前已提交结果，不答题，不提交', steps })
      expect(evidence.reviewObservationId).toBe('review')
      expect(evidence.reviewRequested).toBe(true)
      expect(judgeFinish('done', '仅核对题号，保留已有成绩', evidence).ok).toBe(true)
      expect(judgeFinish('done', '复核完成', { ...evidence, watching: true }).ok).toBe(false)
      expect(judgeFinish('done', '复核完成', { ...evidence, playing: true }).ok).toBe(false)
      expect(judgeFinish('done', '复核完成', { ...evidence, planTotal: 2, planDone: 1 }).ok).toBe(false)
      expect(judgeFinish('done', '复核完成', { ...evidence, todos: [{ id: 'pending', text: '未完成', status: 'pending' }] }).ok).toBe(false)
      expect(judgeFinish('done', '复核完成', { ...evidence, reviewObservationId: undefined })).toMatchObject({ ok: false, error: expect.stringContaining('本次是只读复核') })
      const whole = await collectFinishEvidence('review-tab', 'review-production', { goalText: '完成整门课程', steps })
      expect(whole.reviewObservationId).toBeUndefined()
      expect(judgeFinish('done', '复核完成', whole).ok).toBe(false)
    } finally { peek.mockRestore(); read.mockRestore(); clearBrowserTaskIntent('review-production') }
  })
  it('没有播放器或已结束的视频不能误判为正在播放', async () => {
    const peek = vi.spyOn(appBrowser, 'peekAppBrowserUrl').mockReturnValue('https://mooc1.chaoxing.com/mycourse/studentstudy')
    const read = vi.spyOn(study, 'readChaoxingVideoTick')
    try {
      read.mockResolvedValueOnce({ current: 0, duration: 0, paused: false, ended: false, hasVideo: false, src: '', mid: '', ready: 0 })
      expect((await collectFinishEvidence('empty-player', 'empty-session')).playing).toBe(false)
      read.mockResolvedValueOnce({ current: 10, duration: 10, paused: false, ended: true, hasVideo: true, src: 'video', mid: '1', ready: 4 })
      expect((await collectFinishEvidence('finished-player', 'finished-session')).playing).toBe(false)
      read.mockResolvedValueOnce({ current: 5, duration: 10, paused: false, ended: false, hasVideo: true, src: 'video', mid: '1', ready: 4 })
      expect((await collectFinishEvidence('playing-player', 'playing-session')).playing).toBe(true)
    } finally { peek.mockRestore(); read.mockRestore() }
  })
  it('课程目录已有本轮完整完成统计时，不强迫重新播放或创建课程计划', () => {
    const evidence = { intent: 'play' as const, kind: 'course' as const, todos: [{ id: 'check', text: '核对完成统计', status: 'done' as const }],
      courseCompletion: { stepId: 'real-read', completed: 29, total: 29 } }
    expect(judgeFinish('done', '本轮页面读取显示任务点 29/29，课程已完成', evidence).ok).toBe(true)
    expect(judgeFinish('done', '已完成', { ...evidence, courseCompletion: { ...evidence.courseCompletion, completed: 28 } }).ok).toBe(false)
    expect(judgeFinish('done', '已完成', { ...evidence, playing: true }).ok).toBe(false)
  })
  it('生产收尾证据收集读取本轮工具记录中的已完成统计', async () => {
    const peek = vi.spyOn(appBrowser, 'peekAppBrowserUrl').mockReturnValue('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1')
    setBrowserTaskIntent('already-complete', 'play')
    try {
      const evidence = await collectFinishEvidence('complete-browser', 'already-complete', {
        todos: [{ id: 'verified', text: '核对课程状态', status: 'done' }],
        steps: [{ id: 'read-stats', kind: 'tool', name: 'browser_eval', label: '读取任务点统计', status: 'done',
          result: JSON.stringify({ ok: true, result: { head: '已完成任务点: 29/29' } }) }],
      })
      expect(evidence.courseCompletion).toEqual({ stepId: 'read-stats', completed: 29, total: 29 })
      expect(judgeFinish('done', '课程任务点已全部完成', evidence).ok).toBe(true)
    } finally { peek.mockRestore(); clearBrowserTaskIntent('already-complete') }
  })
  it('普通文章路径或查询参数出现 login/passport2 不能误判成登录页', () => {
    for (const url of ['https://example.com/login-guide', 'https://example.com/docs?return=passport2.chaoxing.com/login']) {
      expect(judgeFinish('done', '已打开用户指定页面', { url, kind: 'unknown' }).ok).toBe(true)
    }
    expect(judgeFinish('done', '已登录', { url: 'https://example.com/login' }).ok).toBe(false)
  })
  it('限定章节的最新完成证据可以收尾，但不越过播放、等待、清单或课程计划门禁', () => {
    const evidence = { intent: 'play' as const, kind: 'player' as const, todos: [{ id: 'check', text: '核对2.1和2.2', status: 'done' as const }],
      scopedCompletion: { stepId: 'fresh-page', targets: ['2.1', '2.2'], evidence: '目录标记与提交回执均已核对' } }
    expect(judgeFinish('done', '仅用户指定两节已完成，其他章节未执行', evidence).ok).toBe(true)
    expect(judgeFinish('done', '已完成', { ...evidence, playing: true }).ok).toBe(false)
    expect(judgeFinish('done', '已完成', { ...evidence, watching: true }).ok).toBe(false)
    expect(judgeFinish('done', '已完成', { ...evidence, todos: [{ id: 'pending', text: '尚未完成', status: 'pending' }] }).ok).toBe(false)
    expect(judgeFinish('done', '已完成', { ...evidence, planTotal: 3, planDone: 2 }).ok).toBe(false)
  })
  it('生产路径只接纳用户限定的章节和本轮宿主签发的观察，整课目标不能缩成两节', async () => {
    const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=2'
    const peek = vi.spyOn(appBrowser, 'peekAppBrowserUrl').mockReturnValue(url)
    const read = vi.spyOn(study, 'readChaoxingVideoTick').mockResolvedValue(null)
    const extras = {
      todos: [{ id: 'all', text: '核对全部指定章节', status: 'done' as const }],
      steps: [{ id: 'fresh', kind: 'tool' as const, name: 'browser_screenshot', label: '目录截图', status: 'done' as const,
        result: JSON.stringify({ ok: true, image: '[attached]', url, observation_id: 'fresh', observed_browser_id: 'scope-tab', observed_at: Date.now() }) }],
      completion: { observation_id: 'fresh', targets: ['2.1', '2.2'], evidence: '目录中两节均为完成标记且有提交回执。' },
    }
    try {
      rememberBrowserTaskIntent('scope-production', '只完成2.1和2.2章节视频')
      const evidence = await collectFinishEvidence('scope-tab', 'scope-production', extras)
      expect(evidence.scopedCompletion?.targets).toEqual(['2.1', '2.2'])
      expect(judgeFinish('done', '指定章节完成', evidence).ok).toBe(true)
      rememberBrowserTaskIntent('scope-production', '完成整门课程，包括2.1和2.2')
      const whole = await collectFinishEvidence('scope-tab', 'scope-production', extras)
      expect(whole.scopedCompletion).toBeUndefined()
      expect(judgeFinish('done', '两节完成', whole).ok).toBe(false)
      clearBrowserTaskIntent('scope-production')
      const restored = await collectFinishEvidence('scope-tab', 'scope-production', { ...extras, goalText: '只完成2.1和2.2章节' })
      expect(restored.scopedCompletion?.targets).toEqual(['2.1', '2.2'])
      rememberBrowserTaskIntent('scope-production', '只完成2.1和2.2')
      expect((await collectFinishEvidence('scope-tab', 'scope-production', { ...extras, goalText: '完成整门课程' })).scopedCompletion).toBeUndefined()
    } finally { peek.mockRestore(); read.mockRestore(); clearBrowserTaskIntent('scope-production') }
  })
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
