/** 智慧慕课播放页的只读解析；其它智慧树页面继续使用各自的站点手册。 */
export type WisdomStudyCard = {
  ok: true
  url: string
  role: 'study'
  page: 'course-study-player'
  title: string
  current: string
  hint: string
  next: string
  chapters: Array<{ title: string; done: boolean; active: boolean; status: string }>
  handles: Array<{ kind: 'chapter'; label: string; selector: string; expandSelectors: string[] }>
  questions: Array<{ title: string; status: string }>
  video: { current: number; duration: number; paused: boolean; ended: boolean; error: number | null } | null
  controls: Record<string, string>
  progress: { done: number; total: number; source: 'page-markers' }
}

export const isWisdomMoocStudyUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) && parsed.hostname === 'wisdom-mooc.zhihuishu.com' && /^\/study\/index\/?$/.test(parsed.pathname)
  } catch {
    return false
  }
}

// 与实际注入使用同一份脚本，离线 DOM 测试不需要 CEF 或登录态。
export const WISDOM_MOOC_STUDY_SCRIPT = String.raw`(function () {
  if (!/^https?:$/.test(location.protocol) || location.hostname !== 'wisdom-mooc.zhihuishu.com' || !/^\/study\/index\/?$/.test(location.pathname)) return null;
  function text(el) { return String(el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
  function shown(el) {
    if (!el) return false;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var style = getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return el.getClientRects().length > 0;
  }
  function path(el) {
    var parts = [];
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var tag = node.tagName.toLowerCase();
      var n = 1;
      for (var prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) if (prev.tagName === node.tagName) n++;
      parts.unshift(tag + ':nth-of-type(' + n + ')');
    }
    return parts.join(' > ');
  }
  function firstShown(selector) { return Array.from(document.querySelectorAll(selector)).find(shown) || null; }
  var selector = '.chapter-content .chapter-item, .chapter-content-second';
  var candidates = Array.from(document.querySelectorAll(selector));
  // 父级章/节不能因包含一个完成图标而被当作已完成的视频。
  var leaves = candidates.filter(function (el) { return !el.querySelector(selector); });
  var chapters = leaves.map(function (el) {
    var label = el.querySelector('.chapter-name, .chapter-title, .video-name, [title]');
    var title = String(label && label.getAttribute('title') || text(label) || text(el));
    var expandSelectors = [];
    var sidebar = el.closest('.chapter-wrapper.hidden');
    var toggle = sidebar && document.querySelector('.collapse-box');
    if (toggle) expandSelectors.push(path(toggle));
    var group = el.closest('.el-collapse-item');
    var header = group && group.querySelector('.el-collapse-item__header');
    if (header && header.getAttribute('aria-expanded') === 'false') expandSelectors.push(path(header));
    return {
      title: title,
      done: !!el.querySelector('.finish-icon'),
      active: el.matches('.current, .active, .is-active, .selected, .is-playing') || !!el.querySelector('.item-box.current, .is-playing'),
      selector: path(el),
      expandSelectors: expandSelectors,
      visible: shown(el)
    };
  }).filter(function (row) { return !!row.title; });
  var handles = chapters.filter(function (row) { return row.visible || row.expandSelectors.length; }).map(function (row) {
    return { kind: 'chapter', label: row.title, selector: row.selector, expandSelectors: row.expandSelectors };
  });
  var active = chapters.find(function (row) { return row.active; });
  var done = chapters.filter(function (row) { return row.done; }).length;
  var next = chapters.find(function (row) { return !row.done; });
  var videoEl = Array.from(document.querySelectorAll('video')).find(shown);
  var video = videoEl ? {
    current: Number(videoEl.currentTime) || 0,
    duration: Number.isFinite(videoEl.duration) ? videoEl.duration : 0,
    paused: videoEl.paused,
    ended: videoEl.ended,
    error: videoEl.error ? videoEl.error.code : null
  } : null;
  var quiz = firstShown('.ai-class-exercise-dialog');
  var captcha = firstShown('.yidun_popup');
  var limit = Array.from(document.querySelectorAll('.el-overlay')).find(function (el) {
    return shown(el) && text(el).includes('保持良好的学习习惯');
  });
  var questions = quiz ? [{ title: text(quiz.querySelector('.ques-title, .question-title, .question-stem')) || text(quiz).slice(0, 500), status: '随堂练习待处理' }] : [];
  var hint = chapters.length ? '目录标记已完成 ' + done + '/' + chapters.length + '；完成后刷新页面复核保存状态' : '尚未读到章节，请展开课程目录';
  if (captcha) hint = '出现滑块验证码，需要用户处理后继续';
  else if (limit) hint = '出现学习习惯提示，请读取并遵守平台限制';
  else if (quiz) hint = '出现随堂练习；按用户授权作答，提交后确认弹窗消失并检查播放是否恢复';
  else if (video && video.error) hint = '播放器报错（代码 ' + video.error + '），请检查媒体加载与解码';
  else if (video && video.ended) hint += '；当前视频已播完';
  else if (video && video.paused) hint += '；当前视频暂停';
  return {
    ok: true, url: location.href, role: 'study', page: 'course-study-player', title: '智慧树课程播放',
    current: active ? active.title : '', hint: hint, next: next ? next.title : '',
    chapters: chapters.map(function (row) { return { title: row.title, done: row.done, active: row.active, status: row.done ? '' : '未完成' }; }),
    handles: handles, questions: questions, video: video,
    controls: quiz ? { '随堂练习': 'active' } : captcha ? { '验证码': 'active' } : {},
    progress: { done: done, total: chapters.length, source: 'page-markers' }
  };
})()`
