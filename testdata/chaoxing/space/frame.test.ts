import { describe, expect, it } from 'vitest'
import { isChaoxingCourseListUrl } from '../../../src/services/browser/engine/courseList'
import { isSpaceListTopUrl } from '../../../src/services/browser/engine/spaceTab'

describe('禁止课表外路', () => {
  it('visit/courses / interaction / courselist 一律禁止顶层打开', () => {
    expect(isSpaceListTopUrl('https://mooc1-1.chaoxing.com/visit/courses?s=1')).toBe(true)
    expect(isSpaceListTopUrl('https://mooc1-1.chaoxing.com/visit/interaction?s=abc')).toBe(true)
    expect(isSpaceListTopUrl('https://mooc1-1.chaoxing.com/visit/courselist')).toBe(true)
    expect(isSpaceListTopUrl('https://i.chaoxing.com/base')).toBe(false)
    expect(isSpaceListTopUrl('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1')).toBe(false)
  })

  it('站点自己切到 visit/courses 只认页签，不当地址去打开', () => {
    expect(isChaoxingCourseListUrl('https://mooc1-1.chaoxing.com/visit/courses?s=1', 'student')).toBe(true)
    expect(isChaoxingCourseListUrl('https://i.chaoxing.com/base', 'student')).toBe(false)
  })
})
