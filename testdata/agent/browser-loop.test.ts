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
  setBrowserTaskIntent,
  intentFromTodoItems,
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
    expect(intentFromText('你帮我完成下1-5题')).toBe('homework')
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
  it('明确继续才继承旧任务，新问题不继承刷课意图和课名', () => {
    rememberBrowserTaskIntent('a', '刷完《成衣工艺学》')
    expect(rememberBrowserTaskIntent('a', '继续')).toBe('play')
    expect(rememberBrowserTaskIntent('a', '当前网页的标题是什么')).toBe('unknown')
    const loop = readBrowserLoop({ url: course, sessionId: 'a' })
    expect(loop.focus).toBe('')
    expect(loop.recipe).not.toContain('点播放')
    expect(loop.recipe).not.toContain('点「章节」')
  })
  it('本轮阶段清单没有写播放关键词时，不抹掉用户明确提出的播放目标', () => {
    rememberBrowserTaskIntent('a', '播放《成衣工艺学》的视频')
    setBrowserTaskIntent('a', intentFromTodoItems(['打开课程页面', '读取目录状态']))
    expect(browserTaskIntent('a')).toBe('play')
  })
})

describe('browser page loop', () => {

















  it('缺少站点身份不能默认套学习通，缺少播放目标不能默认要求播放', () => {
    const unknownSite = recipeForPage({ kind: 'space', intent: 'homework' })
    expect(unknownSite).not.toContain('chaoxing')
    expect(unknownSite).not.toContain('我学的课')
    const inspectCourse = recipeForPage({ kind: 'course', siteId: 'chaoxing' })
    expect(inspectCourse).not.toContain('点「章节」')
    const inspectPlayer = recipeForPage({ kind: 'player', siteId: 'demo' })
    expect(inspectPlayer).not.toContain('browser_watch')
    expect(inspectPlayer).not.toContain('点播放')
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

