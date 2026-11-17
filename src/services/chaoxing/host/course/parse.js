// 课程壳 · parse：当前侧栏页签。目录不是播放页。
function parse(doc, href){
  var hit = __cxReadCourseTab(doc, href);
  var tab = String((hit && hit.tab) || '');
  var known = tab === '章节' || tab === '任务' || tab === '作业';
  var shell = /mycourse\/stu|stucoursemiddle|studentcourse/i.test(String(href || (hit && hit.href) || ''));
  return {
    ok: known || shell,
    page: 'course',
    role: 'course',
    current: known ? tab : undefined,
    title: known ? ('课程 · ' + tab) : '课程',
    url: hit && hit.href ? hit.href : href,
    confidence: known ? 0.85 : (shell ? 0.45 : 0.2),
    handles: [
      { kind: 'control', name: 'task-tab' },
      { kind: 'control', name: 'chapter-tab' },
      { kind: 'control', name: 'homework-tab' },
    ],
    next: tab === '章节' ? 'open 节名进 studentstudy' : (tab === '作业' ? 'homework list / open' : '点侧栏章节'),
    hint: tab === '章节'
      ? '这是章节目录，不是播放页。用 study_chapters 读未完成，open 节名进 studentstudy 后才能 play。'
      : tab === '作业'
        ? '这是作业名单。用 homework list / open，不要 play。'
        : '课程壳。点侧栏「章节」才是目录，「作业」才是名单。顶层网址常不变。',
  };
}
