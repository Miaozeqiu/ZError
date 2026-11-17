import { writeDebugDump } from '../../agent/debugLog'
import { evalBrowserView } from '../../browser/eval'

const READ_DUMP_META = `(function(){
  var html = document.documentElement ? document.documentElement.outerHTML : '';
  var text = ((document.body && document.body.innerText) || '');
  window.__ZE_DUMP_HTML__ = html;
  window.__ZE_DUMP_TEXT__ = text;
  var iframes = [];
  try {
    var list = document.querySelectorAll('iframe');
    for (var i = 0; i < list.length && i < 16; i++) {
      var el = list[i];
      iframes.push({
        i: i,
        id: el.id || '',
        cls: String(el.className || '').slice(0, 80),
        src: String(el.src || el.getAttribute('src') || ''),
        w: el.offsetWidth || 0,
        h: el.offsetHeight || 0
      });
    }
  } catch (e) {}
  return {
    url: location.href || '',
    title: String(document.title || ''),
    htmlLen: html.length,
    textLen: text.length,
    catalogLi: document.querySelectorAll('#coursetree .posCatalog_select, .catalog_title, a.clicktitle, .posCatalog_name, .chapter_item').length,
    iframes: iframes
  };
})()`

const READ_DUMP_OUTLINE = `(function(){
  var sels = [
    '#coursetree', '.posCatalog_name', '.posCatalog_select', '.posCatalog_active',
    '.catalog_title', '.catalog_task', '.catalog_name', 'a.clicktitle',
    '.chapter_item', '.orangeNew', '.jobUnfinishCount', '.prevHoverTips',
    '.catalog_points', '.roundpointStudent'
  ];
  var hits = [];
  for (var s = 0; s < sels.length; s++) {
    var nodes = [];
    try { nodes = document.querySelectorAll(sels[s]); } catch (e) { nodes = []; }
    var samples = [];
    for (var i = 0; i < nodes.length && samples.length < 5; i++) {
      samples.push(String(nodes[i].outerHTML || '').slice(0, 1200));
    }
    hits.push({ sel: sels[s], count: nodes.length, samples: samples });
  }
  return {
    url: location.href,
    title: document.title,
    bodyText: ((document.body && document.body.innerText) || '').slice(0, 8000),
    hits: hits
  };
})()`

const dumpChunk = (key: 'html' | 'text', start: number, size: number) => `(function(){
  var s = String(window.${key === 'html' ? '__ZE_DUMP_HTML__' : '__ZE_DUMP_TEXT__'} || '');
  return {
    start: ${start},
    chunk: s.slice(${start}, ${start + size}),
    left: Math.max(0, s.length - ${start} - ${size})
  };
})()`

const readEvalChunks = async (id: string, key: 'html' | 'text', max = 400000) => {
  const size = 6000
  let start = 0
  let out = ''
  while (start < max) {
    const part = await evalBrowserView(id, dumpChunk(key, start, size)).catch(() => null) as {
      chunk?: string
      left?: number
    } | null
    if (!part) break
    out += String(part.chunk || '')
    if (!Number(part.left)) break
    start += size
  }
  return out
}

export const dumpChaoxingParseHtml = async (id: string, reason = 'parse') => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const latest = 'chaoxing-parse/latest'
  const archive = `chaoxing-parse/${stamp}`
  const writeBoth = (name: string, text: string, ext: 'html' | 'md' | 'json' | 'txt' = 'html') => {
    writeDebugDump(`${latest}/${name}`, text, ext)
    writeDebugDump(`${archive}/${name}`, text, ext)
    const fallbackExt = ext === 'md' ? 'md' : 'txt'
    writeDebugDump(`cx-dump-${name.replace(/[^\w.-]+/g, '_')}`, text, fallbackExt)
  }
  try {
    const meta = await evalBrowserView(id, READ_DUMP_META) as {
      url?: string
      title?: string
      htmlLen?: number
      textLen?: number
      catalogLi?: number
      iframes?: Array<{ i: number; id: string; cls: string; src: string; w: number; h: number }>
    }
    const outline = await evalBrowserView(id, READ_DUMP_OUTLINE).catch(() => null)
    writeBoth('index', JSON.stringify({ reason, ts: new Date().toISOString(), ...meta }, null, 2), 'json')
    writeBoth('outline', JSON.stringify(outline, null, 2), 'json')
    const html = await readEvalChunks(id, 'html')
    const text = await readEvalChunks(id, 'text')
    writeBoth('00-cdp-frame', html || '<!-- empty -->', 'html')
    writeBoth('00-cdp-frame-text', text || '', 'txt')
    const iframes = meta?.iframes || []
    const summary = [
      `# 学习通解析快照`,
      `reason: ${reason}`,
      `url: ${meta?.url || ''}`,
      `title: ${meta?.title || ''}`,
      `catalogLi: ${meta?.catalogLi || 0}`,
      `htmlLen: ${meta?.htmlLen || 0} textLen: ${meta?.textLen || 0}`,
      `iframes: ${iframes.length}（只记 src，不另发请求、不走 contentWindow）`,
      '',
      ...iframes.map((frame) => `- iframe[${frame.i}] id=${frame.id} ${frame.w}x${frame.h} ${frame.src}`),
      '',
    ]
    writeBoth('README', `${summary.join('\n').trim()}\n`, 'md')
    return { ok: true, dir: latest, frames: 1 }
  } catch (error) {
    writeBoth('error', String((error as Error)?.message || error), 'txt')
    return { ok: false, error: String((error as Error)?.message || error) }
  }
}
