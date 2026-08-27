import { writeDebugDump } from '../../agent/debugLog'
import { evalBrowserView } from '../../browser/eval'

const CHAOXING_DUMP_CAPTURE = `(function(){
  var out = [];
  function one(win, depth, label){
    var item = {
      label: label,
      depth: depth || 0,
      href: '',
      title: '',
      sameOrigin: false,
      html: '',
      text: '',
      iframeMeta: [],
      error: ''
    };
    try {
      item.href = (win.location && win.location.href) || '';
      item.title = (win.document && win.document.title) || '';
      item.sameOrigin = true;
      var doc = win.document;
      item.html = (doc.documentElement && doc.documentElement.outerHTML) || '';
      item.text = ((doc.body && doc.body.innerText) || '').slice(0, 40000);
      var list = doc.querySelectorAll('iframe');
      for (var i = 0; i < list.length && i < 16; i++) {
        var el = list[i];
        var src = '';
        try { src = el.src || el.getAttribute('src') || ''; } catch (e) {}
        item.iframeMeta.push({
          i: i,
          id: el.id || '',
          cls: String(el.className || '').slice(0, 80),
          src: src,
          w: el.offsetWidth || 0,
          h: el.offsetHeight || 0
        });
        try {
          if (el.contentWindow) one(el.contentWindow, (depth || 0) + 1, label + '/iframe' + i);
        } catch (e) {
          out.push({
            label: label + '/iframe' + i,
            depth: (depth || 0) + 1,
            href: src,
            title: '',
            sameOrigin: false,
            html: '',
            text: '',
            iframeMeta: [],
            error: 'cross-origin'
          });
        }
      }
    } catch (e) {
      item.error = String(e && e.message || e);
    }
    out.push(item);
  }
  one(window, 0, 'top');
  window.__cxHtmlDump = out;
  return {
    url: location.href,
    count: out.length,
    frames: out.map(function(x){
      return {
        label: x.label,
        href: x.href,
        title: x.title,
        sameOrigin: x.sameOrigin,
        htmlLen: (x.html || '').length,
        textLen: (x.text || '').length,
        error: x.error,
        iframes: x.iframeMeta
      };
    })
  };
})()`

const CHAOXING_DUMP_OUTLINE = `(function(){
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

const dumpChunk = (index: number, start: number, size: number) => `(function(){
  var d = (window.__cxHtmlDump || [])[${index}];
  if (!d) return { done: true };
  var html = d.html || '';
  return {
    label: d.label,
    href: d.href || '',
    start: ${start},
    chunk: html.slice(${start}, ${start + size}),
    left: Math.max(0, html.length - ${start} - ${size})
  };
})()`

const dumpTextChunk = (index: number, start: number, size: number) => `(function(){
  var d = (window.__cxHtmlDump || [])[${index}];
  if (!d) return { done: true };
  var text = d.text || '';
  return {
    label: d.label,
    start: ${start},
    chunk: text.slice(${start}, ${start + size}),
    left: Math.max(0, text.length - ${start} - ${size})
  };
})()`

const readEvalChunks = async (id: string, scriptFor: (start: number) => string, max = 400000) => {
  const size = 6000
  let start = 0
  let out = ''
  let label = ''
  let href = ''
  while (start < max) {
    const part = await evalBrowserView(id, scriptFor(start)).catch(() => null) as {
      done?: boolean
      label?: string
      href?: string
      chunk?: string
      left?: number
    } | null
    if (!part || part.done) break
    if (part.label) label = part.label
    if (part.href) href = part.href
    out += String(part.chunk || '')
    if (!Number(part.left)) break
    start += size
  }
  return { label, href, text: out }
}

export const dumpChaoxingParseHtml = async (id: string, reason = 'parse') => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const latest = 'chaoxing-parse/latest'
  const archive = `chaoxing-parse/${stamp}`
  const writeBoth = (name: string, text: string, ext: 'html' | 'md' | 'json' | 'txt' = 'html') => {
    writeDebugDump(`${latest}/${name}`, text, ext)
    writeDebugDump(`${archive}/${name}`, text, ext)
    // vite 未重启时新目录写不进去，同时落到已有的 agent-chat 日志
    const fallbackExt = ext === 'md' ? 'md' : 'txt'
    writeDebugDump(`cx-dump-${name.replace(/[^\w.-]+/g, '_')}`, text, fallbackExt)
  }
  try {
    const index = await evalBrowserView(id, CHAOXING_DUMP_CAPTURE) as {
      url?: string
      count?: number
      frames?: Array<{
        label: string
        href: string
        title?: string
        sameOrigin: boolean
        htmlLen: number
        textLen: number
        error?: string
        iframes?: Array<{ i: number; id: string; cls: string; src: string; w: number; h: number }>
      }>
    }
    const outline = await evalBrowserView(id, CHAOXING_DUMP_OUTLINE).catch(() => null)
    writeBoth('index', JSON.stringify({ reason, ts: new Date().toISOString(), ...index }, null, 2), 'json')
    writeBoth('outline', JSON.stringify(outline, null, 2), 'json')
    const frames = index?.frames || []
    const summary: string[] = [
      `# 学习通解析快照`,
      `reason: ${reason}`,
      `url: ${index?.url || ''}`,
      `frames: ${frames.length}`,
      '',
    ]
    for (let i = 0; i < frames.length; i++) {
      const meta = frames[i]
      const html = await readEvalChunks(id, (start) => dumpChunk(i, start, 6000))
      const text = await readEvalChunks(id, (start) => dumpTextChunk(i, start, 6000))
      const file = `${String(i).padStart(2, '0')}-${(meta.label || 'frame').replace(/[^\w.-]+/g, '_')}`
      writeBoth(file, html.text || `<!-- empty sameOrigin=${meta.sameOrigin} error=${meta.error || ''} -->`, 'html')
      writeBoth(`${file}-text`, text.text || '', 'txt')
      summary.push(`## ${meta.label}`)
      summary.push(`href: ${meta.href}`)
      summary.push(`sameOrigin: ${meta.sameOrigin} htmlLen: ${meta.htmlLen} textLen: ${meta.textLen} error: ${meta.error || ''}`)
      if (meta.iframes?.length) {
        for (const frame of meta.iframes) {
          summary.push(`- iframe[${frame.i}] id=${frame.id} ${frame.w}x${frame.h} ${frame.src}`)
        }
      }
      summary.push('')
    }
    writeBoth('README', `${summary.join('\n').trim()}\n`, 'md')
    return { ok: true, dir: latest, frames: frames.length }
  } catch (error) {
    writeBoth('error', String((error as Error)?.message || error), 'txt')
    return { ok: false, error: String((error as Error)?.message || error) }
  }
}
