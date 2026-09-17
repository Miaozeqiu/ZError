/** 学习通课程壳侧栏：图标 / data-url / title / ::before，注入到 snapshot 与 act。 */
export const CHROME_HELPERS = String.raw`
function __zeHookOf(el){
  if (!el || !el.getAttribute) return '';
  try {
    return String(el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('onclick') || el.getAttribute('href') || el.href || '');
  } catch (e) { return ''; }
}
function __zeChromeWord(value){
  var t = String(value || '').replace(/\s+/g, ' ').trim();
  if (t === '已学的课') return '我学的课';
  if (/^(章节|作业|任务|统计|资料|考试|讨论|通知|测验|我学的课|我教的课)$/.test(t)) return t;
  if (/^作业/.test(t) && t.length <= 8) return '作业';
  return '';
}
function __zePseudoText(el){
  if (!el) return '';
  try {
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var out = '';
    var before = view.getComputedStyle(el, '::before');
    var after = view.getComputedStyle(el, '::after');
    var pick = function(st){
      var c = String((st && st.content) || '').trim();
      if (!c || c === 'none' || c === 'normal') return '';
      return c.replace(/^["']|["']$/g, '');
    };
    out += pick(before) + pick(after);
    return out.replace(/\s+/g, '');
  } catch (e) { return ''; }
}
function __zeChromeName(el){
  if (!el) return '';
  var hook = __zeHookOf(el);
  var attr = '';
  try { attr = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || ''); } catch (e3) {}
  var own = '';
  try {
    var bits = [];
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var tx = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (tx) bits.push(tx);
      }
    }
    own = bits.join(' ');
  } catch (e4) {}
  var inner = '';
  try { inner = String(el.innerText || el.textContent || '').replace(/\s+/g, ''); } catch (e5) {}
  var visible = String(attr || own || inner || __zePseudoText(el) || '').replace(/\s+/g, '');
  if (visible.indexOf('删除') >= 0) return '';
  var named = __zeChromeWord(attr) || __zeChromeWord(own) || __zeChromeWord(visible);
  if (named) return named;
  var courseType = '';
  try { courseType = String(el.getAttribute('coursetype') || ''); } catch (eType) {}
  if (courseType === '1') return '我学的课';
  if (courseType === '0') return '我教的课';
  if (/visit\/(?:courses|interaction)|courselist/i.test(hook) && !/stucoursemiddle|mycourse\/stu|courseid=/i.test(hook)) return '';
  if (/pageHeader=8|\/mooc2\/work|\/work\/list|studentwork|workEnc|mooc-ans\/work/i.test(hook)) return '作业';
  if (/pageHeader=1|studentcourse/i.test(hook)) return '章节';
  if (/pageHeader=0|stuActiveList|\/active\/stu/i.test(hook)) return '任务';
  if (/exam-list|\/mooc2\/exam|pageHeader=\d+.*exam/i.test(hook)) return '考试';
  var dataId = '';
  try { dataId = String(el.getAttribute('data-id') || el.getAttribute('data-header') || ''); } catch (e1) {}
  if (dataId === '8') return '作业';
  if (dataId === '1') return '章节';
  var cls = '';
  try { cls = String(el.className || el.getAttribute('class') || ''); } catch (e2) {}
  if (/icon[-_]?zy\b|icon[-_]?work\b|nav[-_]?work\b|homework|zuoye/i.test(cls + ' ' + hook)) return '作业';
  return '';
}
function __zeChromeHit(el){
  return !!__zeChromeName(el) || /pageHeader=|studentcourse|stuActiveList|\/work\/|exam-list|mooc2\/work/i.test(__zeHookOf(el));
}
`
