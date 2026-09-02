// 刷课 · frames：iframe 遍历、点击、文本清理
function __cxClean(s){
    return String(s || '').split('\n').join(' ').split('\t').join(' ').split('\r').join(' ').split('  ').join(' ').trim();
  }

function __cxHas(text, piece){
    return String(text || '').indexOf(piece) >= 0;
  }

function __cxFrames(win, depth){
    var out = [win];
    if ((depth || 0) > 4) return out;
    try {
      var list = win.document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try {
          var child = list[i].contentWindow;
          if (child && child.document) out = out.concat(__cxFrames(child, (depth || 0) + 1));
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

function __cxIframeTree(win, depth){
    var out = [];
    if ((depth || 0) > 4) return out;
    try {
      var list = win.document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var item = {
          depth: depth || 0,
          id: el.id || '',
          cls: String(el.className || '').slice(0, 80),
          src: String(el.src || '').slice(0, 220),
          sameOrigin: false,
          video: false,
          playBtn: false,
        };
        try {
          var child = el.contentWindow;
          if (child && child.document) {
            item.sameOrigin = true;
            item.video = !!child.document.querySelector('video');
            item.playBtn = !!child.document.querySelector('.vjs-big-play-button, .vjs-play-control');
            out.push(item);
            out = out.concat(__cxIframeTree(child, (depth || 0) + 1));
          } else {
            out.push(item);
          }
        } catch (e) {
          item.error = 'cross-origin';
          out.push(item);
        }
      }
    } catch (e) {}
    return out;
  }

function __cxClick(el){
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
    if (typeof el.click === 'function') el.click();
  }

function __cxSkipParseFrame(href, doc){
    if (!doc) return true;
    if (doc.querySelector('#coursetree, .posCatalog_select, .catalog_title, .posCatalog_name, a.clicktitle')) return false;
    if (/studentcourse|studentstudy|stucoursemiddle|\/mycourse\/stu/.test(href || '')) return false;
    return /ananas|insertvideo|modules\/video|knowledge\/cards|about:blank/.test(href || '');
  }
