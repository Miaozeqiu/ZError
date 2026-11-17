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

// This trusted collector runs in one confirmed frame. The HTTP script only receives names and indexes.
export const READ_STUDENT_COURSES = String.raw`(function(){
  const active = document.querySelector('.tab-item.current, .tab-item.active, .tab-item.selected');
  const type = document.querySelector('#courseType')?.value || active?.getAttribute('coursetype');
  const label = active?.textContent?.replace(/\s/g, '') || '';
  const student = type === '1' || (!type && /^(我学的课|已学的课)$/.test(label));
  if (!student) return { student: false, courses: [] };
  const list = document.querySelector('#courselistArea, .courselistArea, .course-list');
  const knownEmpty = /(?:暂无|还没有|没有)(?:参加|学习|任何|相关|找到)?(?:课程|课)/.test(list?.innerText || '');
  if (!list) return { student, knownEmpty, courses: [] };

  const courses = [];
  for (const item of list.querySelectorAll('a[href], [data-href], [data-url], [onclick]')) {
    const direct = item.getAttribute('href');
    const attributes = [direct, item.getAttribute('data-href'), item.getAttribute('data-url'), item.getAttribute('onclick')];
    const link = attributes.flatMap(value => value?.match(/(?:https?:\/\/[^\s'"<>]+|(?:\/[^\s'"<>/?]+)*\/(?:stucoursemiddle|stu)\?[^\s'"<>);]+)/gi) || [])
      .find(value => /\/(?:visit\/stucoursemiddle|mycourse\/stu)\?/i.test(value));
    if (!link || !item.getClientRects().length || getComputedStyle(item).visibility === 'hidden') continue;
    const card = item.closest('li, .course, .course-item, .courseItem, .course-card, .courseCard') || item.parentElement;
    const heading = card?.querySelector('[class*="course-name"], [class*="courseName"], .course-title, .courseTitle, h3, h4');
    const title = String(heading?.getAttribute('title') || heading?.textContent || item.getAttribute('title') || item.getAttribute('aria-label') || item.innerText || item.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim();
    if (!title || /^(进入学习|进入课程|课程封面|学习)$/.test(title)) continue;
    const teacher = String(card?.querySelector('.teacher, .teacher-name, .teacherName, [class*="courseTeacher"], .course-info > p.line2:last-child')?.textContent || '').replace(/\s+/g, ' ').trim();
    try { courses.push({ title: title.slice(0, 180), teacher: teacher.slice(0, 100), href: new URL(link, location.href).href }); } catch {}
  }
  const hasMore = [...list.querySelectorAll('.folder, .course-folder, [folderid], [data-folder-id], .pagination .next, .load-more')]
    .some(item => item.getClientRects().length && !item.matches(':disabled, .disabled, [aria-disabled="true"]'));
  return { student, knownEmpty, courses: courses.slice(0, 240), truncated: hasMore || courses.length > 240 };
})()`
