import { chaoxingUrl } from './studentCourses'

const workPath = /^\/(?:mooc2?-ans\/)?(?:mooc2\/)?work\/(task|dowork|view|viewwork|review)\/?$/i
const listPath = /^\/(?:mooc2?-ans\/)?(?:mooc2\/)?work\/(?:list|index)\/?$/i

export const studentHomeworkUrl = (value: string) => {
  const url = chaoxingUrl(value)
  const path = url?.pathname.match(workPath)
  const params = new Map([...url?.searchParams ?? []].map(([key, val]) => [key.toLowerCase(), val]))
  const work = params.get('workid') ?? ''
  const course = params.get('courseid') ?? ''
  const clazz = params.get('classid') ?? params.get('clazzid') ?? ''
  if (!path || !/^\d+$/.test(work) || !/^\d+$/.test(course) || (clazz && !/^\d+$/.test(clazz))) return null
  return { work, course, clazz, kind: path[1].toLowerCase() }
}

export const isStudentHomeworkList = (value: string, course: { id: string; clazz: string | null }) => {
  const url = chaoxingUrl(value)
  if (!url || !listPath.test(url.pathname)) return false
  const id = url.searchParams.get('courseId') ?? url.searchParams.get('courseid')
  const clazz = url.searchParams.get('classId') ?? url.searchParams.get('clazzid')
  return id === course.id && (!course.clazz || clazz === course.clazz)
}

export const READ_STUDENT_HOMEWORK = String.raw`(function(){
  const list = document.querySelector('.bottomList');
  const visible = item => Boolean(item?.getClientRects().length && getComputedStyle(item).visibility !== 'hidden');
  const clean = item => String(item?.getAttribute('title') || item?.innerText || item?.textContent || '').replace(/\s+/g, ' ').trim();
  const entries = [...(list?.querySelectorAll('li[data]') || [])].filter(visible).map(item => ({
    title: clean(item.querySelector('.right-content .overHidden2, .titTxt, .workName, .work-title')),
    status: clean(item.querySelector('.status')),
    address: item.getAttribute('data') || '',
  }));
  const enabled = selector => {
    const item = document.querySelector(selector);
    return visible(item) && !item.matches('.xl-disabled, [aria-disabled="true"], :disabled');
  };
  return { entries, page: Number(clean(document.querySelector('.pageDiv .xl-active'))) || 1,
    previous: enabled('.pageDiv .xl-prevPage'), next: enabled('.pageDiv .xl-nextPage'),
    empty: /暂无(?:任何)?作业|没有(?:任何)?作业/.test(document.body?.innerText || '') };
})()`
