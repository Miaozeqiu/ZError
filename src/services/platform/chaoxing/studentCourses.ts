const studentCoursePath = /^\/(?:(?:mooc2?-ans)\/)?(?:visit\/stucoursemiddle|mycourse\/stu)\/?$/i

export const chaoxingUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && (url.hostname === 'chaoxing.com' || url.hostname.endsWith('.chaoxing.com'))) return url
  } catch { /* not a navigable website URL */ }
  return null
}

export const studentCourseUrl = (value: string) => {
  const url = chaoxingUrl(value)
  const id = url?.searchParams.get('courseid') ?? url?.searchParams.get('courseId')
  return url && id && /^\d+$/.test(id) && studentCoursePath.test(url.pathname) ? { url: url.href, id, clazz: url.searchParams.get('clazzid') ?? url.searchParams.get('clazzId') } : null
}

export const isCourseListFrame = (value: string) => {
  const url = chaoxingUrl(value)
  return Boolean(url && /\/visit\/(?:interaction|courses)\/?$|\/courselist\/?$/i.test(url.pathname))
}

const listFields = ['active', 'type', 'studentTab', 'menuName', 'list', 'item', 'card', 'heading', 'teacher', 'more', 'disabled'] as const
export type CourseListRules = Record<(typeof listFields)[number], string> & { studentNames: string[]; actionNames: string[] }
export function courseListRules(value: unknown): CourseListRules {
  const rules = value as CourseListRules
  if (!rules || listFields.some(key => typeof rules[key] !== 'string' || !rules[key] || rules[key].length > 512)
    || [rules.studentNames, rules.actionNames].some(list => !Array.isArray(list) || list.length > 20
      || list.some(name => typeof name !== 'string' || name.length > 120))) throw new Error('网站脚本提供的课表规则无效。')
  return rules
}

// This trusted collector runs in one confirmed frame. The HTTP script only receives names and indexes.
export const readStudentCoursesScript = (rules: CourseListRules) => String.raw`(function(rules){
  const active = document.querySelector(rules.active);
  const type = document.querySelector(rules.type)?.value || active?.getAttribute('coursetype');
  const label = active?.textContent?.replace(/\s/g, '') || '';
  const student = type === '1' || (!type && rules.studentNames.includes(label));
  if (!student) return { student: false, courses: [] };
  const list = document.querySelector(rules.list);
  const knownEmpty = /(?:暂无|还没有|没有)(?:参加|学习|任何|相关|找到)?(?:课程|课)/.test(list?.innerText || '');
  if (!list) return { student, knownEmpty, courses: [] };

  const courses = [];
  for (const item of list.querySelectorAll(rules.item)) {
    const direct = item.getAttribute('href');
    const attributes = [direct, item.getAttribute('data-href'), item.getAttribute('data-url'), item.getAttribute('onclick')];
    const link = attributes.flatMap(value => value?.match(/(?:https?:\/\/[^\s'"<>]+|(?:\/[^\s'"<>/?]+)*\/(?:stucoursemiddle|stu)\?[^\s'"<>);]+)/gi) || [])
      .find(value => /\/(?:visit\/stucoursemiddle|mycourse\/stu)\?/i.test(value));
    if (!link || !item.getClientRects().length || getComputedStyle(item).visibility === 'hidden') continue;
    const card = item.closest(rules.card) || item.parentElement;
    const heading = card?.querySelector(rules.heading);
    const title = String(heading?.getAttribute('title') || heading?.textContent || item.getAttribute('title') || item.getAttribute('aria-label') || item.innerText || item.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim();
    if (!title || rules.actionNames.includes(title)) continue;
    const teacher = String(card?.querySelector(rules.teacher)?.textContent || '').replace(/\s+/g, ' ').trim();
    try { courses.push({ title: title.slice(0, 180), teacher: teacher.slice(0, 100), href: new URL(link, location.href).href }); } catch {}
  }
  const hasMore = [...list.querySelectorAll(rules.more)]
    .some(item => item.getClientRects().length && !item.matches(rules.disabled));
  return { student, knownEmpty, courses: courses.slice(0, 240), truncated: hasMore || courses.length > 240 };
})(${JSON.stringify(rules)})`
