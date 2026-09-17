import { afterEach, describe, expect, it } from 'vitest'
import { inspectEvalScript } from '../../src/services/agent/browserEvalGuard'
import {
  classifyBrowserPage,
  evalPolicyForPage,
  recipeForPage,
} from '../../src/services/agent/browserLoop'
import {
  browserTaskIntent,
  clearBrowserTaskIntent,
  intentFromText,
  rememberBrowserTaskIntent,
} from '../../src/services/agent/browserTask'

const space = 'https://i.chaoxing.com/base'
const course = 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&clazzid=2&cpi=3'
const player = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1&courseId=1'
const login = 'https://passport2.chaoxing.com/login?fid=&newversion=true'
const home = 'http://localhost:1420/browser-home.html'

describe('browser task intent', () => {
  afterEach(() => clearBrowserTaskIntent())

  it('章节任务且测试不用做 → play', () => {
    expect(intentFromText('帮我完成下 应该高等数学的 章节任务，测试不用做')).toBe('play')
  })

  it('写作业 → homework', () => {
    expect(intentFromText('把高等数学作业写了')).toBe('homework')
  })

  it('不把上一次作业意图漏到新会话', () => {
    rememberBrowserTaskIntent('a', '把作业交了')
    expect(browserTaskIntent('a')).toBe('homework')
    expect(browserTaskIntent('b')).toBe('unknown')
    expect(browserTaskIntent()).toBe('unknown')
  })

  it('同一会话保留上次意图，直到新任务改写', () => {
    rememberBrowserTaskIntent('a', '刷完这节')
    expect(rememberBrowserTaskIntent('a', '继续')).toBe('play')
    expect(rememberBrowserTaskIntent('a', '改去做作业')).toBe('homework')
  })
})

describe('browser page loop', () => {
  it('认登录 / 空间 / 课程 / 播放 / 导航', () => {
    expect(classifyBrowserPage(login)).toBe('login')
    expect(classifyBrowserPage(space)).toBe('space')
    expect(classifyBrowserPage(course)).toBe('course')
    expect(classifyBrowserPage(player)).toBe('player')
    expect(classifyBrowserPage(home)).toBe('home')
  })

  it('空间页刷课：先点课，不要登录也不要 play', () => {
    const recipe = recipeForPage({ kind: 'space', intent: 'play', focus: '高等数学' })
    expect(recipe).toContain('我学的课')
    expect(recipe).toContain('高等数学')
    expect(recipe).toContain('不要再登录')
    expect(recipe).toContain('不要 study_play')
  })

  it('导航页刷课：先开空间，不要先走登录页', () => {
    const recipe = recipeForPage({ kind: 'home', intent: 'play' })
    expect(recipe).toContain('i.chaoxing.com')
    expect(recipe).not.toContain('passport2')
  })

  it('播放页视频暂停：要 play，禁止当成正在播放去 watch', () => {
    const recipe = recipeForPage({
      kind: 'player',
      intent: 'play',
      panel: { event: 'video_paused', thisSection: { next: { label: '视频2', kind: 'video' } } },
    })
    expect(recipe).toContain('视频2暂停了')
    expect(recipe).toContain('browser_study_play')
    expect(recipe).toContain('禁止 watch')
    expect(recipe).toContain('禁止说正在播放')
  })

  it('播放页只剩测验：跳过并 next', () => {
    const recipe = recipeForPage({
      kind: 'player',
      intent: 'play',
      panel: { event: 'quiz_left', leftJobs: ['测验'] },
    })
    expect(recipe).toContain('browser_study_next')
    expect(recipe).toContain('不要 homework')
  })

  it('播放页禁止 eval，空间页只读', () => {
    expect(evalPolicyForPage('player')).toBe('deny')
    expect(evalPolicyForPage('space')).toBe('read')
    expect(evalPolicyForPage('unknown')).toBe('full')
  })
})

describe('eval guard', () => {
  it('播放页一律拒绝', () => {
    expect(inspectEvalScript('return document.title', 'deny')).toMatch(/禁止 eval/)
  })

  it('拦 contentDocument 和改 location', () => {
    expect(inspectEvalScript('iframe.contentDocument.querySelector("a")', 'full')).toMatch(/contentDocument/)
    expect(inspectEvalScript("location.href = 'https://x'", 'full')).toMatch(/location/)
  })

  it('空间页允许只读，拒绝 click', () => {
    expect(inspectEvalScript('return document.title', 'read')).toBeNull()
    expect(inspectEvalScript('document.querySelector("a").click()', 'read')).toMatch(/只允许只读/)
  })
})
