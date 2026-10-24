import { afterEach, describe, expect, it } from 'vitest'
import { inspectEvalScript } from '../../src/services/agent/browserEvalGuard'
import {
  classifyBrowserPage,
  displaySiteName,
  evalPolicyForPage,
  formatBrowserLiveContext,
  formatSlimRefs,
  readBrowserLoop,
  recipeForPage,
  shouldAttachLiveRefs,
} from '../../src/services/agent/browserLoop'
import {
  browserTaskIntent,
  clearBrowserTaskIntent,
  focusFromText,
  intentFromText,
  rememberBrowserTaskIntent,
} from '../../src/services/agent/browserTask'
import { lastSiteCard } from '../../src/services/browser/abstractions'

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

  it('课名不带说话的语气词', () => {
    expect(focusFromText('你完成下成衣课程的播放任务')).toBe('成衣课程')
    expect(focusFromText('帮我刷完《成衣工艺学》')).toBe('成衣工艺学')
    expect(focusFromText('把高等数学作业写了')).toBe('高等数学')
    expect(focusFromText('刷课')).toBeUndefined()
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

  it('空间页刷课：看快照点课名', () => {
    const recipe = recipeForPage({ kind: 'space', intent: 'play', focus: '高等数学' })
    expect(recipe).toContain('高等数学')
    expect(recipe).toContain('快照')
    expect(recipe).toContain('ref')
    expect(recipe).not.toContain('不要再登录')
  })

  it('导航页刷课：先开空间', () => {
    const recipe = recipeForPage({ kind: 'home', intent: 'play' })
    expect(recipe).toContain('课程空间')
    expect(recipe).not.toContain('passport2')
  })

  it('播放页视频暂停：指定那条再 play', () => {
    const recipe = recipeForPage({
      kind: 'player',
      intent: 'play',
      panel: { event: 'video_paused', thisSection: { next: { label: '视频2', kind: 'video' } } },
    })
    expect(recipe).toContain('视频2暂停了')
    expect(recipe).toContain('没有在播')
    expect(recipe).toContain('快照 ref')
    expect(recipe).toContain('browser_watch')
  })

  it('播放页只剩测验：可用 next', () => {
    const recipe = recipeForPage({
      kind: 'player',
      intent: 'play',
      panel: { event: 'quiz_left', leftJobs: ['测验'] },
    })
    expect(recipe).toContain('快照 ref')
    expect(recipe.startsWith('建议')).toBe(true)
  })

  it('未知页不要套学习通作业路径', () => {
    expect(recipeForPage({ kind: 'unknown', intent: 'homework' })).toContain('快照')
    expect(recipeForPage({ kind: 'unknown', intent: 'homework' })).not.toContain('我学的课')
    expect(recipeForPage({ kind: 'unknown', intent: 'play' })).toContain('SKILL.md')
  })

  it('非学习通站点即使用户说写作业也不走学习通路径', () => {
    expect(recipeForPage({ kind: 'unknown', intent: 'homework', siteId: 'example' })).not.toContain('我学的课')
    expect(recipeForPage({ kind: 'unknown', intent: 'homework', siteId: 'example' })).toContain('快照')
    expect(classifyBrowserPage('https://example.com/homework')).toBe('unknown')
  })

  it('在浙学按主机认，不叫智慧树', () => {
    expect(displaySiteName('https://www.zjooc.cn/plan/detail/1', {
      id: 'zjooc',
      name: '在浙学',
    })).toBe('在浙学')
    expect(displaySiteName('https://www.zhihuishu.com/student/course', {
      id: 'zhihuishu',
      name: '智慧树',
    })).toBe('智慧树')
    const loop = readBrowserLoop({
      url: 'https://www.zjooc.cn/ucenter/student/course/study/abc/plan/detail/xyz',
    })
    expect(loop.line).toContain('在浙学')
    expect(loop.line).toMatch(/播放页|章节/)
    expect(loop.line).not.toContain('智慧树')
    expect(loop.line).not.toMatch(/\bplayer\b/)
    expect(loop.recipe).toContain('在浙学')
    expect(loop.recipe).toContain('sites/zjooc.cn/SKILL.md')
    expect(loop.recipe).toMatch(/好几条/)
    expect(loop.recipe).toContain('iframe')
    expect(loop.recipe).not.toContain('browser_parser_dryrun')
    expect(loop.recipe).toContain('ref')
    expect(classifyBrowserPage(loop.url)).toBe('player')
    expect(loop.evalPolicy).toBe('read')
    expect(loop.kind).toBe('player')
  })

  it('活上下文用中文标签，不把 play/player 写进旁白', () => {
    const text = formatBrowserLiveContext({
      url: 'https://www.zjooc.cn/ucenter/student/course/study/abc/plan/detail/xyz',
      sessionId: 's',
    })
    expect(text).toContain('在浙学')
    expect(text).toMatch(/播放页/)
    expect(text).toMatch(/用中文/)
    expect(text).toMatch(/不要写英文句子/)
    expect(text.indexOf('【旁白】')).toBeLessThan(text.indexOf('【网页状态】'))
    expect(text).not.toMatch(/任务=play/)
    expect(text).not.toMatch(/\bevent=/)
    expect(text).not.toMatch(/【网页状态】[^\n]*\bplayer\b/)
  })

  it('旁白带瘦可点 refs，有卡也带', () => {
    lastSiteCard.value = null
    expect(shouldAttachLiveRefs(login, false)).toBe(true)
    expect(shouldAttachLiveRefs('https://www.zjooc.cn/login', false)).toBe(true)
    expect(shouldAttachLiveRefs(player, true)).toBe(true)
    const slim = formatSlimRefs([
      { id: 'e1', role: 'textbox', name: '手机号' },
      { id: 'e2', role: 'textbox', name: '密码' },
      { id: 'e3', role: 'button', name: '登录' },
      { id: 'e4', role: 'heading', name: '欢迎' },
      { id: 'e5', role: 'button', name: '下一页', disabled: true },
    ], 12)
    expect(slim).toContain('【页面控件】')
    expect(slim).toContain('e1:textbox「手机号」')
    expect(slim).toContain('e3:button「登录」')
    expect(slim).not.toContain('heading')
    expect(slim).not.toContain('e5')
    expect(slim).toMatch(/browser_find/)
    const live = formatBrowserLiveContext({
      url: login,
      sessionId: 's',
      refs: [
        { id: 'e1', role: 'textbox', name: '用户名' },
        { id: 'e2', role: 'button', name: '登录' },
      ],
    })
    expect(live).toContain('【页面控件】')
    expect(live).toContain('e1:textbox')
    lastSiteCard.value = {
      ok: true,
      page: 'player',
      role: 'study',
      handles: [{ kind: 'play', label: '播放' }],
    }
    const blocked = formatBrowserLiveContext({
      url: player,
      sessionId: 's',
      refs: [{ id: 'e9', role: 'button', name: '播放' }],
    })
    expect(blocked).toContain('【页面控件】')
    expect(blocked).toContain('e9:button')
    lastSiteCard.value = null
  })

  it('课程壳目录不是播放页：不能 play', () => {
    const catalog = recipeForPage({ kind: 'course', intent: 'play', tab: '章节' })
    expect(catalog).toContain('目录')
    expect(catalog).toContain('不是播放页')
    expect(catalog).toContain('click_text')
    expect(catalog).not.toContain('派 execute 去 play')
    const shell = recipeForPage({ kind: 'course', intent: 'play', tab: '任务' })
    expect(shell).toContain('目录')
    expect(shell).toContain('进播放页')
  })

  it('作业名单 URL 按图谱框认成 homework-list', () => {
    expect(classifyBrowserPage('https://mooc1.chaoxing.com/mooc2/work/list?courseId=1&classId=2')).toBe('homework-list')
  })

  it('播放页 eval 只读，未知页可写', () => {
    expect(evalPolicyForPage('player')).toBe('read')
    expect(evalPolicyForPage('space')).toBe('full')
    expect(evalPolicyForPage('login')).toBe('full')
    expect(evalPolicyForPage('unknown')).toBe('full')
    expect(inspectEvalScript('return document.title', 'read')).toBeNull()
    expect(inspectEvalScript('video.play()', 'read')).toMatch(/只读/)
  })
})

describe('eval guard', () => {
  it('播放页 eval 改走播放工具', () => {
    expect(inspectEvalScript('return document.title', 'deny')).toMatch(/播放页/)
  })

  it('拦 contentDocument 和改 location', () => {
    expect(inspectEvalScript('iframe.contentDocument.querySelector("a")', 'full')).toMatch(/contentDocument/)
    expect(inspectEvalScript("location.href = 'https://x'", 'full')).toMatch(/location/)
  })

  it('空间页允许只读，拒绝 click', () => {
    expect(inspectEvalScript('return document.title', 'read')).toBeNull()
    expect(inspectEvalScript('document.querySelector("a").click()', 'read')).toMatch(/只读/)
  })
})

