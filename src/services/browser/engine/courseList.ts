export type CourseListKind = 'student' | 'taught'

/** 只认站点自己切过去的课表地址，禁止用这个地址去 navigate 或改 iframe src。 */
export const isChaoxingCourseListUrl = (url: string, kind: CourseListKind) => {
  const raw = String(url || '')
  if (kind === 'student') {
    return /visit\/courses|courselist/i.test(raw) && !/visit\/interaction/i.test(raw)
  }
  return /visit\/interaction/i.test(raw)
}
