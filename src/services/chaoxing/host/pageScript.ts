/** 把学习通宿主脚本拼成页内 IIFE。第二次起复用已经挂上的 helpers。 */

export const joinParts = (...chunks: string[]) => (
  chunks.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
)

export const pageScript = (source: string, body: string) => (
  `(function(){\n${source}\n${body}\n})()`
)

export const tickScript = (source: string, body: string) => (
  `(function(){
  var __zeHas = false;
    try { __zeHas = (window.top && window.top.__zeStudyReady) === 7; } catch (e0) { try { __zeHas = window.__zeStudyReady === 7; } catch (e1) {} }
  if (!__zeHas) {
${source}
  }
  var api = window;
  try { if (window.top && window.top.__zeStudyReady === 7) api = window.top; } catch (e2) {}
  var zeFindVideo = api.__zeFindVideo;
  var zeTickOf = api.__zeTickOf;
  var zePinVideo = api.__zePinVideo;
  var zePinMid = api.__zePinMid;
  var zeClearPinnedVideo = api.__zeClearPinnedVideo;
  var zePinnedMid = api.__zeGetPinnedMid || api.__zePinnedMid;
  var zeMidOfVideo = api.__zeMidOfVideo;
  var zeDur = api.__zeDur;
  var zeVideoJobDone = api.__zeVideoJobDone;
  var zeHostBox = api.__zeHostBox;
  var zeDocs = api.__zeDocs;
  var boxOf = api.__zeBoxOf;
  var zePierceClick = api.__zePierceClick;
  var zeControlVideo = api.__zeControlVideo;
  var collectSteps = api.__zeCollectSteps;
  var collectAllSteps = api.__zeCollectAllSteps;
  var __cxFindChapterEl = api.__cxFindChapterEl;
  var __cxClean = api.__cxClean;
${body}
})()`
)

export const locateTickScript = (helpers: string, locate: string, body: string) => (
  `(function(){
  var __zeHas = false;
    try { __zeHas = (window.top && window.top.__zeStudyReady) === 7; } catch (e0) { try { __zeHas = window.__zeStudyReady === 7; } catch (e1) {} }
  if (!__zeHas) {
${helpers}
  } else {
    var api = window;
    try { if (window.top && window.top.__zeStudyReady === 7) api = window.top; } catch (e2) {}
    var zeFindVideo = api.__zeFindVideo;
    var zeTickOf = api.__zeTickOf;
    var zePinVideo = api.__zePinVideo;
    var zePinMid = api.__zePinMid;
    var zeClearPinnedVideo = api.__zeClearPinnedVideo;
    var zePinnedMid = api.__zeGetPinnedMid || api.__zePinnedMid;
    var zeMidOfVideo = api.__zeMidOfVideo;
    var zeDur = api.__zeDur;
    var zeVideoJobDone = api.__zeVideoJobDone;
    var zeHostBox = api.__zeHostBox;
    var zeDocs = api.__zeDocs;
    var boxOf = api.__zeBoxOf;
    var zePierceClick = api.__zePierceClick;
    var zeControlVideo = api.__zeControlVideo;
    var collectSteps = api.__zeCollectSteps;
    var collectAllSteps = api.__zeCollectAllSteps;
    var __cxFindChapterEl = api.__cxFindChapterEl;
    var __cxClean = api.__cxClean;
  }
${locate}
${body}
})()`
)

export const evalLocalApi = <T extends Record<string, unknown>>(source: string, names: string[]): T => (
  new Function(`${source}\nreturn { ${names.join(', ')} };`)() as T
)
