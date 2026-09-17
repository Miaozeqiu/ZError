// 刷课 · frames：旧辅助。新包用 helpers.js。仅给未改 // files: 的覆盖目录兜底。
function __cxClean(s){
    return String(s || '').split('\n').join(' ').split('\t').join(' ').split('\r').join(' ').split('  ').join(' ').trim();
  }

function __cxHas(text, piece){
    return String(text || '').indexOf(piece) >= 0;
  }

function __cxSkipParseFrame(href, doc){
    if (!doc) return true;
    if (doc.querySelector('#coursetree, .posCatalog_select, .catalog_title, .posCatalog_name, a.clicktitle')) return false;
    if (/studentcourse|studentstudy|stucoursemiddle|\/mycourse\/stu/.test(href || '')) return false;
    return /ananas|insertvideo|modules\/video|knowledge\/cards|about:blank/.test(href || '');
  }
