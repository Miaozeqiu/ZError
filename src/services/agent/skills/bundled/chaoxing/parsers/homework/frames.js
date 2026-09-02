// 作业 · frames：iframe、点击、取图/取文
function abs(img){
      var s = String((img && (img.getAttribute('data-original') || img.getAttribute('src') || img.src)) || '');
      if (!s || s.indexOf('data:') === 0) return '';
      if (/logo|avatar|pixel|spacer|blank.gif|radio|check/i.test(s)) return '';
      if (s.indexOf('//') === 0) s = 'https:' + s;
      if (s.indexOf('http://') === 0) s = 'https://' + s.slice(7);
      if (s.charAt(0) === '/') s = (location.origin || 'https://mooc1.chaoxing.com') + s;
      return s.length > 800 ? '' : s;
    }

function __sameFrames(win, depth){
    var out = [win];
    if ((depth || 0) > 4) return out;
    try {
      var list = win.document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try {
          var child = list[i].contentWindow;
          if (child && child.document) out = out.concat(__sameFrames(child, (depth || 0) + 1));
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

function __findEl(sel){
    var frames = __sameFrames(window, 0);
    for (var i = 0; i < frames.length; i++) {
      try {
        var el = frames[i].document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

function __clickEl(el){
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
    if (typeof el.click === 'function') el.click();
  }

function __navHref(el){
    if (!el) return '';
    var a = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
    if (!a) return '';
    var href = '';
    try { href = String(a.href || a.getAttribute('href') || ''); } catch (e) { href = String(a.getAttribute('href') || ''); }
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return '';
    return href;
  }

function imgs(el){
      if (!el) return [];
      var out = [], list = el.querySelectorAll('img');
      for (var i = 0; i < list.length && out.length < 6; i++) {
        var s = abs(list[i]);
        if (s && out.indexOf(s) < 0) out.push(s);
      }
      return out;
    }

function txt(el){
      if (!el) return '';
      return String(el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
    }

function findBoxes(){
      var frames = __sameFrames(window, 0);
      for (var f = 0; f < frames.length; f++) {
        try {
          var found = __hwQuestionBoxes(frames[f].document);
          if (found.length) return found;
        } catch (e) {}
      }
      return [];
    }
