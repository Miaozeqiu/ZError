import { isLoggedIn } from '../app/auth'
import {
  getCampusCourse,
  getUserCampus,
  listCampusCourses,
  listCampusTags,
  type CampusCourse,
  type CampusFolder,
} from '../app/campus'
import { RemoteApiError } from '../app/remoteHttp'

export const campusFail = (err: unknown, fallback: string) => {
  if (err instanceof RemoteApiError) {
    if (err.status === 401) return '校园登录已失效，请先在顶栏重新登录。'
    if (err.status === 403) {
      const msg = String(err.message || '')
      if (/not verified|未认证/i.test(msg)) return '需要先完成校园认证才能上传或改题。'
      if (/not the creator/i.test(msg)) return '只能改自己创建的试卷。'
      if (/archived/i.test(msg)) return '这份试卷已归档，不能再改。'
      return msg || '没有权限做这个操作。'
    }
  }
  return err instanceof Error && err.message ? err.message : fallback
}

export const loadCampusContext = async (opts?: { requireVerified?: boolean }) => {
  if (!isLoggedIn.value) {
    return { error: '还没有登录校园账号。请先在顶栏用微信登录，再到校园题库页绑定学校。' }
  }
  try {
    const identity = await getUserCampus()
    if (!identity.campus) {
      return { error: '还没有绑定学校。请先打开校园题库页选择学校。' }
    }
    if (opts?.requireVerified && identity.status !== 'verified') {
      return { error: '需要先完成校园认证才能上传或改题。请先在校园题库页完成认证。' }
    }
    return { identity }
  } catch (err) {
    return { error: campusFail(err, '读取校园账号失败') }
  }
}

export const summarizeCampusCourse = (item: CampusCourse) => ({
  course_id: item.id,
  name: item.name,
  ...(item.folder_count != null ? { folder_count: item.folder_count } : {}),
  ...(item.question_count != null ? { question_count: item.question_count } : {}),
})

export const summarizeCampusPaper = (item: CampusFolder) => ({
  paper_id: item.id,
  name: item.name,
  tag: item.tag_name || '',
  year: item.year || null,
  ...(item.question_count != null ? { question_count: item.question_count } : {}),
})

export const resolveCampusCourse = async (campusId: number, id?: number, name?: string) => {
  const keyword = String(name || '').trim()
  const courses = await listCampusCourses(campusId, keyword)
  if (Number(id) > 0) {
    const found = courses.find((item) => item.id === Number(id))
    if (found) return found
    try {
      return (await getCampusCourse(Number(id))).course
    } catch {
      throw new Error(`没有找到课程 ${id}`)
    }
  }
  if (!keyword) return null
  const exact = courses.filter((item) => item.name === keyword)
  if (exact.length === 1) return exact[0]
  const fuzzy = courses.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0]
  if (fuzzy.length > 1 || exact.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多门课程叫「${keyword}」，请改用 course_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`没有找到课程「${keyword}」`)
}

export const resolveCampusPaper = async (courseId: number, id?: number, name?: string) => {
  const detail = await getCampusCourse(courseId)
  const papers = detail.folders.filter((item) => !item.archived)
  if (Number(id) > 0) {
    const found = papers.find((item) => item.id === Number(id))
    if (found) return { course: detail.course, paper: found, papers }
    throw new Error(`这门课里没有试卷 ${id}`)
  }
  const keyword = String(name || '').trim()
  if (!keyword) return { course: detail.course, paper: null, papers }
  const exact = papers.filter((item) => item.name === keyword)
  if (exact.length === 1) return { course: detail.course, paper: exact[0], papers }
  const fuzzy = papers.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return { course: detail.course, paper: fuzzy[0], papers }
  if (fuzzy.length > 1 || exact.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多份试卷叫「${keyword}」，请改用 paper_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`这门课里没有试卷「${keyword}」`)
}

export const resolveCampusTagId = async (id?: number, name?: string) => {
  if (Number(id) > 0) return Number(id)
  const keyword = String(name || '').trim()
  if (!keyword) return undefined
  const tags = await listCampusTags()
  const exact = tags.filter((item) => item.name === keyword)
  if (exact.length === 1) return exact[0].id
  const fuzzy = tags.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0].id
  if (exact.length > 1 || fuzzy.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多个标签叫「${keyword}」，请改用 tag_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`没有找到标签「${keyword}」`)
}

export const parseCampusDrafts = (raw: unknown) => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      return {
        question: String(rec.question || rec.content || '').trim(),
        options: rec.options,
        answer: String(rec.answer || '').trim(),
        question_type: String(rec.question_type || rec.type || '').trim(),
      }
    })
    .filter((item) => item.question && item.answer)
}

export const campusTagArg = (args: Record<string, unknown> | null | undefined) =>
  String(args?.tag || args?.tag_name || args?.platform || '').trim()
