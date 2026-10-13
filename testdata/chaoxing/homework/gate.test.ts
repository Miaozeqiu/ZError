import { describe, expect, it } from 'vitest'
import { classifyBrowserPage } from '../../../src/services/agent/browserLoop'
import { homeworkEnteringList, homeworkPageUrl, isHomeworkCourseShell } from '../../../src/services/agent/homeworkGate'
import { siteGraphNodeForUrl } from '../../../src/services/browser/siteGraphCore'

const middle = 'https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3&ismooc2=1'
const workList = 'https://mooc1.chaoxing.com/mooc2/work/list?courseId=1&classId=2'
const space = 'https://i.chaoxing.com/base'
const stu = 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&clazzid=2&cpi=3'

const adapter = {
  isCourseUrl: (url: string) => siteGraphNodeForUrl(url)?.id === 'course',
  isHomeworkDoUrl: (url: string) => siteGraphNodeForUrl(url)?.id === 'homework-do',
}

describe('homework list gate', () => {
  it('stucoursemiddle + work/list iframe 认成作业列表', () => {
    const page = homeworkPageUrl(middle, [workList])
    expect(page).toBe(workList)
    expect(siteGraphNodeForUrl(page)?.id).toBe('course')
    expect(classifyBrowserPage(page)).toBe('homework-list')
    expect(siteGraphNodeForUrl(middle)?.id).toBe('course')
    expect(homeworkEnteringList(adapter, 'list', middle, page)).toBe(true)
  })

  it('课程中间页还没载入名单时，list/open 仍能进门去点作业', () => {
    expect(isHomeworkCourseShell(adapter, middle)).toBe(true)
    expect(isHomeworkCourseShell(adapter, stu)).toBe(true)
    expect(homeworkEnteringList(adapter, 'list', middle, middle)).toBe(true)
    expect(homeworkEnteringList(adapter, 'open', stu, stu)).toBe(true)
    expect(homeworkEnteringList(adapter, 'inspect', middle, middle)).toBe(false)
  })

  it('空间首页不能进作业工具', () => {
    const page = homeworkPageUrl(space, ['https://mooc1-1.chaoxing.com/visit/courses?s=1'])
    expect(siteGraphNodeForUrl(page)?.id).toBe('space')
    expect(homeworkEnteringList(adapter, 'list', space, page)).toBe(false)
  })
})
