import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { classifyBrowserPage, readBrowserLoop } from '../../src/services/agent/browserLoop'
import { listBundledSkillFiles } from '../../src/services/agent/skills/builtinSkillAssets'
import { applyLearnedSiteGraphContent, seedBundledLearnedSites } from '../../src/services/agent/skillRuntime'
import { siteGraphForUrl, siteGraphNodeForUrl, parserPageKindOf, hydrateSite } from '../../src/services/browser/siteGraphCore'
import { isChaoxingPlayerUrl, isChaoxingHomeworkUrl, isChaoxingStudyUrl } from '../../src/services/platform/chaoxing/nav'

const pack = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../src/services/agent/skills/bundled/site-learn/sites/zhihuishu.com')
const href = 'https://online.zhihuishu.com/student/course'

const pages = [
  {
    label: 'passport 登录',
    url: 'https://passport.zhihuishu.com/login?service=https%3A%2F%2Fonline.zhihuishu.com',
    nodeId: 'login',
    parserIds: ['login'],
    kind: 'login',
  },
  {
    label: 'login 子域登录',
    url: 'https://login.zhihuishu.com/',
    nodeId: 'login',
    parserIds: ['login'],
    kind: 'login',
  },
  {
    label: 'onlineweb 课程列表',
    url: 'https://onlineweb.zhihuishu.com/onlinestuh5',
    nodeId: 'course-list',
    parserIds: ['list'],
    kind: 'space',
  },
  {
    label: 'online 课程列表',
    url: href,
    nodeId: 'course-list',
    parserIds: ['list'],
    kind: 'space',
  },
  {
    label: 'onlineh5 课程列表',
    url: 'https://onlineh5.zhihuishu.com/',
    nodeId: 'course-list',
    parserIds: ['list'],
    kind: 'space',
  },
  {
    label: '新形态课程计划',
    url: 'https://smartcoursestudent.zhihuishu.com/singleCourse?courseId=1',
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  },
  {
    label: '新域名课程计划',
    url: 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse#/chapter',
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  },
  {
    label: '智慧慕课掌握度',
    url: 'https://wisdom-mooc.zhihuishu.com/study/analysis?recruitAndCourseId=abc',
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  },
  ...['courseIndex', 'masteryHistory', 'point'].map((path) => ({
    label: `fusion ${path}`,
    url: `https://fusioncourseh5.zhihuishu.com/${path}?courseId=1#/detail`,
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  })),
  {
    label: 'polymas AI 课程中心',
    url: 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center?courseId=1',
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  },
  {
    label: 'polymas 课程首页',
    url: 'https://teaching.polymas.com/stu-hike/agent-course-full/42/stu/course-home#/catalog',
    nodeId: 'course-study-plan',
    parserIds: ['course'],
    kind: 'course',
  },
  {
    label: '智慧慕课播放',
    url: 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=abc#/chapter/1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '共享课播放',
    url: 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '新共享课播放',
    url: 'https://studyplush5.zhihuishu.com/videoStudy?courseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '新智慧共享课播放',
    url: 'https://studywisdomh5.zhihuishu.com/study/index?courseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: 'fusion 播放',
    url: 'https://fusioncourseh5.zhihuishu.com/stuStudy?courseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '新形态播放',
    url: 'https://smartcoursestudent.zhihuishu.com/learnPage?courseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '新域名新形态播放',
    url: 'https://ai-smart-course-student-pro.zhihuishu.com/learnPage#/video/1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '校内课播放',
    url: 'https://hike.zhihuishu.com/aidedteaching/sourceLearning?courseId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: 'polymas 旧版资源播放',
    url: 'https://tools-hike.polymas.com/stu-hike/42/studentStudyResource?sourceId=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: 'polymas 新版资源播放',
    url: 'https://teaching.polymas.com/stu-hike/agent-course-full/42/stu/study/resource-detail?id=1',
    nodeId: 'course-study-player',
    parserIds: ['study', 'captcha'],
    kind: 'player',
  },
  {
    label: '共享课作业列表',
    url: 'https://onlineh5.zhihuishu.com/stuExamWeb.html#/webExamList?courseId=1&type=homework',
    nodeId: 'course-homework-list',
    parserIds: ['homework'],
    kind: 'homework-list',
  },
  {
    label: '其它实际子域作业列表',
    url: 'https://studentexam.zhihuishu.com/stuExamWeb.html?recruitAndCourseId=1#/webExamList?',
    nodeId: 'course-homework-list',
    parserIds: ['homework'],
    kind: 'homework-list',
  },
  ...['dohomework', 'doexamination'].map((action) => ({
    label: `共享课 ${action}`,
    url: `https://onlineh5.zhihuishu.com/stuExamWeb.html#/webExamList/${action}?examId=1`,
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  })),
  {
    label: '新形态 ReviewExam',
    url: 'https://smartcourseexam.zhihuishu.com/ReviewExam?examId=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  {
    label: '学生复习测验',
    url: 'https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam#/question/1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  ...['fusioncourseh5', 'studywisdomh5', 'wisdom-mooc', 'examloop'].map((host) => ({
    label: `${host} exam`,
    url: `https://${host}.zhihuishu.com/exam?examId=1`,
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  })),
  {
    label: '校内课作业',
    url: 'https://hike.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList?workId=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  {
    label: '校内课考试',
    url: 'https://hike.zhihuishu.com/atHomeworkExam/stu/examQ/examexercise?examId=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  {
    label: 'polymas stuHomeworkDo',
    url: 'https://tools-hike.polymas.com/stu-hike/stuHomeworkDo?id=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  {
    label: 'polymas answer-homework',
    url: 'https://teaching.polymas.com/stu-hike/agent-course-full/42/stu/answer-homework?id=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
  {
    label: 'polymas answer-exam',
    url: 'https://teaching.polymas.com/stu-hike/agent-course-full/42/stu-exam/answer-exam?id=1',
    nodeId: 'course-homework-do',
    parserIds: ['homework'],
    kind: 'homework-do',
  },
]

describe('zhihuishu 图谱', () => {
  beforeAll(() => {
    seedBundledLearnedSites()
  })

  it('内置 bundle 注册 zhihuishu 图谱并能从 polymas 查到', () => {
    expect(listBundledSkillFiles('site-learn')).toContain('sites/zhihuishu.com/site-graph.json')
    expect(siteGraphForUrl('https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center')?.id)
      .toBe('zhihuishu')
  })

  it('网址落到 list 节点', () => {
    seedBundledLearnedSites()
    applyLearnedSiteGraphContent(readFileSync(resolve(pack, 'site-graph.json'), 'utf8'))
    expect(siteGraphForUrl(href)?.id).toBe('zhihuishu')
    expect(siteGraphNodeForUrl(href)?.parserIds).toContain('list')
  })

  it('课程问答路由识别为独立页面，不启用视频或作业解析器', () => {
    const url = 'https://qah5.zhihuishu.com/qa.html#/web/home/123?role=2'
    expect(siteGraphNodeForUrl(url)?.id).toBe('course-qa')
    expect(siteGraphNodeForUrl(url)?.parserIds).toEqual([])
    expect(classifyBrowserPage(url)).toBe('unknown')
    expect(siteGraphNodeForUrl('https://qah5.zhihuishu.com/qa.htmlx#/web/home/123')).toBeNull()
    expect(listBundledSkillFiles('site-learn')).toContain('sites/zhihuishu.com/references/qa.md')
  })

  it.each(pages)('$label 匹配 $nodeId 且 loop 为 $kind', ({ url, nodeId, parserIds, kind }) => {
    const site = siteGraphForUrl(url)
    const node = siteGraphNodeForUrl(url)
    const loop = readBrowserLoop({ url })

    expect(site?.id).toBe('zhihuishu')
    expect(node?.id).toBe(nodeId)
    expect(node?.parserIds).toEqual(parserIds)
    expect(classifyBrowserPage(url)).toBe(kind)
    expect(loop.nodeId).toBe(nodeId)
    expect(loop.kind).toBe(kind)
    expect(loop.line).toContain('智慧树')
    expect(isChaoxingPlayerUrl(url)).toBe(false)
    expect(isChaoxingHomeworkUrl(url)).toBe(false)
    expect(isChaoxingStudyUrl(url)).toBe(false)
  })

  it('兼容网站设置生成的完整 URL 正则，并拒绝查询串中的伪域名', () => {
    const site = hydrateSite({ id: 'example', name: 'example', host: 'example.test', hostPattern: '^https?://(?:www\\.)?(?:example\\.test)(?::\\d+)?(?:[/?#]|$)', nodes: [], edges: [] })
    expect(site.match('https://example.test/path')).toBe(true)
    expect(site.match('https://example.test.evil.test/path')).toBe(false)
    expect(site.match('https://evil.test/?next=https://example.test/')).toBe(false)
  })

  it('智慧树播放页走通用 player/native-video 路径，不冒充学习通 study', () => {
    const url = 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=abc'
    const node = siteGraphNodeForUrl(url)
    const loop = readBrowserLoop({ url })

    expect(node?.id).toBe('course-study-player')
    expect(parserPageKindOf(node)).toBe('site')
    expect(loop.kind).toBe('player')
    expect(loop.evalPolicy).toBe('read')
    expect(isChaoxingPlayerUrl(url)).toBe(false)
  })

  it('非学习通作业节点仍走通用 site 卡，但 loop 身份正确', () => {
    for (const [url, kind] of [
      ['https://onlineh5.zhihuishu.com/stuExamWeb.html#/webExamList?courseId=1', 'homework-list'],
      ['https://wisdom-mooc.zhihuishu.com/exam?examId=1', 'homework-do'],
    ] as const) {
      const node = siteGraphNodeForUrl(url)
      expect(node?.parserIds).toEqual(['homework'])
      expect(parserPageKindOf(node)).toBe('site')
      expect(classifyBrowserPage(url)).toBe(kind)
      expect(readBrowserLoop({ url }).kind).toBe(kind)
      expect(isChaoxingPlayerUrl(url)).toBe(false)
    }
  })

  it.each([
    ['伪后缀域名', 'https://evilzhihuishu.com/student/course', null, null],
    ['域名后再拼后缀', 'https://zhihuishu.com.evil.test/student/course', null, null],
    ['polymas 伪后缀域名', 'https://evilpolymas.com/stu/course-home', null, null],
    ['查询串夹带播放网址', 'https://example.com/?next=https%3A%2F%2Fwisdom-mooc.zhihuishu.com%2Fstudy%2Findex', null, null],
    ['课程列表路径前缀误匹配', 'https://online.zhihuishu.com/student/coursework', 'zhihuishu', null],
    ['播放路径前缀误匹配', 'https://wisdom-mooc.zhihuishu.com/study/indexed', 'zhihuishu', null],
    ['作业列表缺 literal 问号', 'https://studentexam.zhihuishu.com/stuExamWeb.html#/webExamList', 'zhihuishu', null],
    ['作答页不误判列表', 'https://onlineh5.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework?examId=1', 'zhihuishu', 'course-homework-do'],
    ['courseIndex 不误判播放', 'https://fusioncourseh5.zhihuishu.com/courseIndex?courseId=1', 'zhihuishu', 'course-study-plan'],
    ['stuStudy 不误判计划', 'https://fusioncourseh5.zhihuishu.com/stuStudy?courseId=1', 'zhihuishu', 'course-study-player'],
    ['查询串夹带作答页仍是列表', 'https://online.zhihuishu.com/student/course?next=https%3A%2F%2Fwisdom-mooc.zhihuishu.com%2Fexam', 'zhihuishu', 'course-list'],
  ])('%s', (_label, url, siteId, nodeId) => {
    expect(siteGraphForUrl(url)?.id || null).toBe(siteId)
    expect(siteGraphNodeForUrl(url)?.id || null).toBe(nodeId)
    expect(isChaoxingPlayerUrl(url)).toBe(false)
  })
})
