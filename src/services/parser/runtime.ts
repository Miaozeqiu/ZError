/** 站点包运行时：拼 helpers / parse / locate，本地 new Function，页内只跑短 IIFE。 */

export const parseFileList = (index: string, fallback: string[]) => {
  const match = String(index || '').match(/^\/\/\s*files:\s*(.+)$/m)
  if (!match) return fallback
  return match[1].split(',').map((item) => item.trim()).filter((item) => item.endsWith('.js') && item !== 'index.js')
}

export const joinParts = (...chunks: string[]) => (
  chunks.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
)

export const pageScript = (source: string, body: string) => (
  `(function(){\n${source}\n${body}\n})()`
)

/** 第二次起复用页内已挂好的 helpers，避免每次打进 23KB。 */
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

/** helpers 已挂好时只再打 locate.js，避免每次点击注入 23KB。 */
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

export const roleOfParserPath = (path: string) => {
  const normalized = String(path || '').replace(/\\/g, '/')
  const match = normalized.match(/(?:^|\/)parsers\/([^/]+)/)
  return match?.[1] || ''
}

export const DEFAULT_PARSER_FILES = ['helpers.js', 'parse.js', 'locate.js']
