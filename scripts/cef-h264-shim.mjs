#!/usr/bin/env node
/**
 * 开源 CEF 没有 H.264。只做解码：mp4 → VP8 WebM。
 * 第一次：有片头就开播，边转边推；时长用探测补上。转完后按普通文件 Range 输出。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.ZERROR_H264_PORT || 1430)
const CDP = process.env.ZERROR_CDP || 'http://127.0.0.1:9333'
const localFf = path.join(os.homedir(), '.local/bin/ffmpeg')
const localProbe = path.join(os.homedir(), '.local/bin/ffprobe')
const FFMPEG = process.env.FFMPEG || (fs.existsSync(localFf) ? localFf : 'ffmpeg')
const FFPROBE = process.env.FFPROBE || (
  fs.existsSync(localProbe) ? localProbe : FFMPEG.replace(/ffmpeg$/, 'ffprobe')
)
const playwrightUrl = process.env.PLAYWRIGHT_ENTRY
  || `${process.env.HOME}/.nvm/versions/node/${process.version}/lib/node_modules/playwright/index.mjs`
const CACHE = path.join(os.tmpdir(), 'zerror-h264-cache')
const READY_BYTES = 96 * 1024
fs.mkdirSync(CACHE, { recursive: true })

const HOOK = `(() => {
  if (window.__ZE_H264__ === 5) return;
  var origCan = HTMLMediaElement.prototype.canPlayType;
  try {
    var probe = document.createElement('video');
    if (origCan.call(probe, 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
      window.__ZE_H264__ = 5;
      window.__ZE_H264_NATIVE__ = true;
      return;
    }
  } catch (e) {}
  window.__ZE_H264__ = 5;
  try { window.isStuH5Page = true; } catch (e) {}
  try { window.flashChecker = function () { return { hasFlash: 0, version: 0 }; }; } catch (e) {}
  var orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    var t = String(type || '');
    if (/avc1|mp4a|video\\/mp4|audio\\/mp4|video\\/webm|vp8|opus/i.test(t)) return 'probably';
    return orig.call(this, type);
  };
  try {
    if (window.MediaSource && MediaSource.isTypeSupported) {
      var origMs = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (type) {
        var t = String(type || '');
        if (/avc1|mp4a|video\\/mp4|audio\\/mp4|video\\/webm|vp8|opus/i.test(t)) return true;
        return origMs(type);
      };
    }
  } catch (e) {}
  try {
    var nativeDur = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
    if (nativeDur && nativeDur.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
        configurable: true,
        enumerable: true,
        get: function () {
          try {
            var n = nativeDur.get.call(this);
            if (isFinite(n) && n > 0) return n;
            return this.__zeDuration > 0 ? this.__zeDuration : n;
          } catch (e) {
            return this.__zeDuration > 0 ? this.__zeDuration : NaN;
          }
        },
      });
    }
  } catch (e) {}
  var hintDur = function (el) {
    if (!el) return;
    var src = '';
    try { src = el.currentSrc || el.src || ''; } catch (e) {}
    var i = src.indexOf('u=');
    if (i < 0) return;
    var u = src.slice(i + 2).split('&')[0];
    fetch('http://127.0.0.1:${PORT}/meta?u=' + u).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.duration > 0 && el.__zeDuration !== j.duration) {
        el.__zeDuration = j.duration;
        try { el.dispatchEvent(new Event('durationchange')); } catch (e) {}
      }
    }).catch(function () {});
  };
  var nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  var timeIn = function (ranges, t) {
    try {
      for (var i = 0; i < ranges.length; i++) {
        if (t >= ranges.start(i) && t <= ranges.end(i) + 0.35) return true;
      }
    } catch (e) {}
    return false;
  };
  var playAt = function (el, t) {
    var src = '';
    try { src = el.currentSrc || el.src || ''; } catch (e) {}
    var i = src.indexOf('u=');
    if (i < 0) return '';
    var u = src.slice(i + 2).split('&')[0];
    return t > 0.5
      ? 'http://127.0.0.1:${PORT}/play?u=' + u + '&t=' + encodeURIComponent(String(Math.round(t * 10) / 10))
      : 'http://127.0.0.1:${PORT}/play?u=' + u;
  };
  var snapReady = function (el) {
    var off = el.__zeOffset || 0;
    if (!(off > 0.5) || !nativeTime || !nativeTime.set) return;
    try {
      var s = el.seekable;
      if (!s || !s.length) return;
      var end = s.end(0);
      if (!isFinite(end) || end < off + 2) return;
      el.__zeOffset = 0;
      el.__zeScrub = null;
      nativeTime.set.call(el, off);
    } catch (e) {}
  };
  try {
    if (nativeTime && nativeTime.get && nativeTime.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        configurable: true,
        enumerable: true,
        get: function () {
          if (this.__zeScrub != null) return this.__zeScrub;
          try { return (this.__zeOffset || 0) + nativeTime.get.call(this); } catch (e) { return this.__zeOffset || 0; }
        },
        set: function (t) {
          t = Number(t);
          if (!isFinite(t) || t < 0) t = 0;
          var src = '';
          try { src = this.currentSrc || this.src || ''; } catch (e) {}
          if (src.indexOf('127.0.0.1:${PORT}/play') < 0) {
            nativeTime.set.call(this, t);
            return;
          }
          var local = t - (this.__zeOffset || 0);
          var covered = false;
          try {
            covered = timeIn(this.buffered, local) || timeIn(this.seekable, local);
            var s = this.seekable;
            if (s && s.length && isFinite(s.end(0)) && s.end(0) > t + 2 && t <= s.end(0)) covered = true;
          } catch (e) {}
          if (covered) {
            this.__zeScrub = null;
            nativeTime.set.call(this, Math.max(0, local));
            return;
          }
          this.__zeScrub = t;
          var el = this;
          if (el.__zeSeekTimer) clearTimeout(el.__zeSeekTimer);
          el.__zeSeekTimer = setTimeout(function () {
            el.__zeSeekTimer = 0;
            el.__zeOffset = t;
            el.__zeScrub = null;
            try { el.preload = 'auto'; } catch (e) {}
            el.src = playAt(el, t);
            var go = el.play();
            if (go && go.catch) go.catch(function () {});
          }, 160);
        },
      });
    }
  } catch (e) {}
  var watchMeta = function (el) {
    if (!el || el.__zeMetaWatch) return;
    el.__zeMetaWatch = true;
    el.addEventListener('loadedmetadata', function () { snapReady(el); });
    var n = 0;
    var tick = function () {
      hintDur(el);
      snapReady(el);
      n += 1;
      if (el.__zeDuration > 0 || n > 50) return;
      setTimeout(tick, 300);
    };
    tick();
  };
  var proxy = 'http://127.0.0.1:${PORT}/play?u=';
  var wrap = function (url) {
    url = String(url || '');
    if (!url || url.indexOf('127.0.0.1:${PORT}') >= 0 || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return url;
    if (!/mp4|m3u8|mpegurl|cldisk|ananas|chaoxing|aliyuncs|aliyunvod|noteynb/i.test(url)) return url;
    return proxy + encodeURIComponent(url);
  };
  var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (desc && desc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        try { this.preload = 'none'; } catch (e) {}
        desc.set.call(this, wrap(v));
        watchMeta(this);
      },
    });
  }
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && (this.tagName === 'SOURCE' || this.tagName === 'VIDEO')) {
      value = wrap(value);
    }
    if (String(name).toLowerCase() === 'preload' && (this.tagName === 'VIDEO' || this.tagName === 'AUDIO')) {
      value = 'none';
    }
    return setAttr.call(this, name, value);
  };
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try { this.preload = 'auto'; } catch (e) {}
    watchMeta(this);
    return origPlay.apply(this, arguments);
  };
  var list = document.querySelectorAll('video');
  for (var i = 0; i < list.length; i++) {
    try { list[i].preload = 'none'; } catch (e) {}
    var src = list[i].currentSrc || list[i].src || '';
    if (src && src.indexOf('127.0.0.1:${PORT}') < 0) list[i].src = wrap(src);
    watchMeta(list[i]);
  }
  var bustFlash = function () {
    try {
      var html = (document.documentElement && document.documentElement.innerHTML) || '';
      if (!/没有安装flash|flashplayer|Adobe Flash/i.test(html)) return;
      var n = Number(sessionStorage.getItem('__ze_h264_rl') || 0);
      if (n >= 2) return;
      sessionStorage.setItem('__ze_h264_rl', String(n + 1));
      location.reload();
    } catch (e) {}
  };
  if (document.body) bustFlash();
  else document.addEventListener('DOMContentLoaded', bustFlash);
  setTimeout(bustFlash, 600);
  setTimeout(bustFlash, 1800);
})()`

const allowedHost = (raw) => {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return /(^|\.)(chaoxing\.com|cldisk\.com|aliyuncs\.com|aliyun\.com|myqcloud\.com|qiniucdn\.com|qnssl\.com|noteynb\.com)$/.test(host)
      || host.includes('ananas')
  } catch {
    return false
  }
}

let cookieFn = async () => []
const jobs = new Map()
let activeFf = null

const cachePath = (src) => path.join(CACHE, `${createHash('sha1').update(src.split('?')[0]).digest('hex')}.webm`)
const durPath = (dest) => `${dest}.dur`

const writeDur = (dest, n) => {
  if (!(n > 0)) return
  try { fs.writeFileSync(durPath(dest), String(n)) } catch { /* 旁路 */ }
}

const readDur = (dest) => {
  try {
    const n = Number(fs.readFileSync(durPath(dest), 'utf8'))
    return n > 0 ? n : 0
  } catch {
    return 0
  }
}

const parseDurLine = (text) => {
  const hit = String(text).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!hit) return 0
  return Number(hit[1]) * 3600 + Number(hit[2]) * 60 + Number(hit[3])
}

const inputHeaders = async (url) => {
  let cookie = ''
  try {
    const list = await cookieFn(url)
    cookie = list.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch { /* 没 cookie 也试 CDN 签名 */ }
  return [
    cookie ? `Cookie: ${cookie}` : '',
    'Referer: https://mooc1.chaoxing.com/',
    'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ].filter(Boolean).join('\r\n') + '\r\n'
}

const readyFile = (dest) => {
  try {
    if (fs.existsSync(`${dest}.ok`) && fs.existsSync(dest) && fs.statSync(dest).size > 2000) return dest
  } catch { /* 缓存不齐就重转 */ }
  return ''
}

const parseRange = (header, size) => {
  const hit = String(header || '').match(/bytes=(\d*)-(\d*)/)
  if (!hit) return null
  const start = hit[1] ? Number(hit[1]) : 0
  const end = hit[2] ? Number(hit[2]) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

const sendFile = (req, res, file) => {
  const size = fs.statSync(file).size
  const range = parseRange(req.headers.range, size)
  const type = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' }
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...type, 'Content-Length': size })
    res.end()
    return
  }
  if (range) {
    res.writeHead(206, {
      ...type,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    })
    fs.createReadStream(file, range).pipe(res)
    return
  }
  res.writeHead(200, { ...type, 'Content-Length': size })
  fs.createReadStream(file).pipe(res)
}

const jobFile = (job) => {
  try {
    if (fs.existsSync(job.part)) return job.part
  } catch { /* 已收尾 */ }
  try {
    if (fs.existsSync(job.dest)) return job.dest
  } catch { /* 还没有 */ }
  return ''
}

const streamGrowing = async (req, res, job) => {
  res.writeHead(200, {
    'Content-Type': 'video/webm',
    'Cache-Control': 'no-store',
  })
  let pos = 0
  let stopped = false
  req.on('close', () => { stopped = true })
  while (!stopped) {
    const file = jobFile(job)
    let size = 0
    try { if (file) size = fs.statSync(file).size } catch { size = 0 }
    if (size > pos && file) {
      const chunk = await new Promise((resolve, reject) => {
        const parts = []
        const stream = fs.createReadStream(file, { start: pos, end: size - 1 })
        stream.on('data', (buf) => parts.push(buf))
        stream.on('end', () => resolve(Buffer.concat(parts)))
        stream.on('error', reject)
      })
      if (stopped) return
      const ok = res.write(chunk)
      pos += chunk.length
      if (!ok) await new Promise((resolve) => res.once('drain', resolve))
      continue
    }
    if (job.done && size <= pos) break
    if (job.error) break
    await sleep(60)
  }
  if (!res.writableEnded) res.end()
}

const runFf = (args, onLog) => new Promise((resolve, reject) => {
  const ff = spawn(FFMPEG, ['-nostdin', '-hide_banner', '-loglevel', 'info', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  activeFf = ff
  let err = ''
  ff.stderr.on('data', (chunk) => {
    const text = String(chunk)
    err += text
    onLog?.(text)
    if (/error|failed/i.test(text) && text.trim()) console.warn('[h264-shim]', text.trim().slice(0, 200))
  })
  ff.on('error', reject)
  ff.on('close', (code) => {
    if (activeFf === ff) activeFf = null
    if (code === 0) resolve()
    else reject(new Error(err.trim().slice(0, 200) || `ffmpeg ${code}`))
  })
})

const probeDuration = (src, headers) => new Promise((resolve) => {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
  ]
  if (headers && !fs.existsSync(src)) args.push('-headers', headers)
  args.push(src)
  const ff = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  const timer = setTimeout(() => {
    try { ff.kill('SIGKILL') } catch { /* 超时就放弃 */ }
    resolve(0)
  }, 10000)
  ff.stdout.on('data', (chunk) => { out += chunk })
  ff.on('error', () => {
    clearTimeout(timer)
    resolve(0)
  })
  ff.on('close', () => {
    clearTimeout(timer)
    const n = Number(String(out).trim())
    resolve(Number.isFinite(n) && n > 0 ? n : 0)
  })
})

const stampDuration = async (part, dest) => {
  const stamped = `${dest}.stamp`
  await runFf(['-y', '-i', part, '-c', 'copy', '-f', 'webm', stamped])
  const size = fs.existsSync(stamped) ? fs.statSync(stamped).size : 0
  if (size < 2000) throw new Error('stamp empty')
  fs.renameSync(stamped, dest)
  fs.writeFileSync(`${dest}.ok`, String(size))
  try { fs.rmSync(part, { force: true }) } catch { /* 半成品 */ }
  console.log('[h264-shim] 已缓存', (size / 1e6).toFixed(1), 'MB')
  return dest
}

const noteDuration = (job, n) => {
  if (!(n > 0) || job.duration > 0) return
  job.duration = n
  writeDur(job.dest, n)
}

const finalizeJob = async (job) => {
  const part = job.part
  if (!fs.existsSync(part) || fs.statSync(part).size < 2000) throw new Error('empty')
  const dur = job.duration || await probeDuration(part)
  noteDuration(job, dur)
  if (dur > 0) {
    fs.renameSync(part, job.dest)
    fs.writeFileSync(`${job.dest}.ok`, String(fs.statSync(job.dest).size))
    console.log('[h264-shim] 已缓存', (fs.statSync(job.dest).size / 1e6).toFixed(1), 'MB')
    return job.dest
  }
  return stampDuration(part, job.dest)
}

const startJob = (src, dest) => {
  const part = `${dest}.part`
  const job = {
    src,
    dest,
    part,
    duration: readDur(dest),
    done: false,
    error: '',
    firstBytes: null,
    promise: null,
  }
  let releaseFirst = () => {}
  job.firstBytes = new Promise((resolve) => { releaseFirst = resolve })
  const bumpFirst = () => {
    try {
      if (fs.existsSync(part) && fs.statSync(part).size >= READY_BYTES) releaseFirst()
    } catch { /* 还没写出 */ }
  }
  job.promise = (async () => {
    if (activeFf) {
      try { activeFf.kill('SIGKILL') } catch { /* 只转当前这条 */ }
      activeFf = null
    }
    try { fs.rmSync(part, { force: true }) } catch { /* 旧半成品 */ }
    const headers = await inputHeaders(src)
    void probeDuration(src, headers).then((n) => noteDuration(job, n))
    console.log('[h264-shim] 转码', src.slice(0, 140))
    const watch = setInterval(bumpFirst, 80)
    try {
      await runFf([
        '-headers', headers,
        '-i', src,
        '-vf', 'scale=-2:480',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-lag-in-frames', '0', '-b:v', '600k',
        '-c:a', 'libopus', '-b:a', '64k', '-ac', '1',
        '-f', 'webm',
        '-y', part,
      ], (text) => noteDuration(job, parseDurLine(text)))
      await finalizeJob(job)
    } catch (error) {
      job.error = String(error)
      throw error
    } finally {
      clearInterval(watch)
      job.done = true
      releaseFirst()
    }
  })()
  return job
}

const ensureJob = (src) => {
  const dest = cachePath(src)
  if (readyFile(dest)) return null
  const running = jobs.get(dest)
  if (running) return running
  const job = startJob(src, dest)
  jobs.set(dest, job)
  job.promise.finally(() => {
    if (jobs.get(dest) === job) jobs.delete(dest)
  }).catch(() => {})
  return job
}

let seekFf = null

const streamFromTime = async (req, res, src, at) => {
  const headers = await inputHeaders(src)
  if (seekFf) {
    try { seekFf.kill('SIGKILL') } catch { /* 只跟当前拖动 */ }
    seekFf = null
  }
  console.log('[h264-shim] 跳到', at, 's')
  const ff = spawn(FFMPEG, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-ss', String(at),
    '-headers', headers,
    '-i', src,
    '-vf', 'scale=-2:480',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-lag-in-frames', '0', '-b:v', '600k',
    '-c:a', 'libopus', '-b:a', '64k', '-ac', '1',
    '-f', 'webm',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  seekFf = ff
  let err = ''
  ff.stderr.on('data', (chunk) => {
    const text = String(chunk)
    err += text
    if (text.trim()) console.warn('[h264-shim]', text.trim().slice(0, 200))
  })
  req.on('close', () => {
    if (seekFf !== ff) return
    try { ff.kill('SIGKILL') } catch { /* 拖走了 */ }
    seekFf = null
  })
  res.writeHead(200, { 'Content-Type': 'video/webm', 'Cache-Control': 'no-store' })
  ff.stdout.pipe(res)
  await new Promise((resolve, reject) => {
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (seekFf === ff) seekFf = null
      if (code && !res.writableEnded && err.trim()) {
        reject(new Error(err.trim().slice(0, 200) || `ffmpeg ${code}`))
        return
      }
      resolve()
    })
    res.on('close', resolve)
  })
}

const servePlay = async (req, res, src, at = 0) => {
  const dest = cachePath(src)
  if (readyFile(dest)) {
    sendFile(req, res, dest)
    return
  }
  if (at > 0.5) {
    await streamFromTime(req, res, src, at)
    return
  }
  const job = ensureJob(src)
  if (!job) {
    sendFile(req, res, dest)
    return
  }
  await job.firstBytes
  if (job.error && !jobFile(job) && !readyFile(dest)) {
    throw new Error(job.error)
  }
  if (readyFile(dest)) {
    sendFile(req, res, dest)
    return
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  const range = parseRange(req.headers.range, Number.MAX_SAFE_INTEGER)
  if (range && range.start > 0) {
    const file = jobFile(job)
    let size = 0
    try { if (file) size = fs.statSync(file).size } catch { size = 0 }
    if (file && range.start < size) {
      sendFile(req, res, file)
      return
    }
    res.statusCode = 416
    res.end()
    return
  }
  await streamGrowing(req, res, job)
}

const metaOf = (src) => {
  const dest = cachePath(src)
  const job = jobs.get(dest)
  return {
    duration: job?.duration || readDur(dest),
    ready: Boolean(readyFile(dest)),
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const loc = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (loc.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
    return
  }
  const src = loc.searchParams.get('u') || ''
  if (loc.pathname === '/meta') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(metaOf(src)))
    return
  }
  if (loc.pathname !== '/play') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (!allowedHost(src)) {
    console.warn('[h264-shim] 拒绝主机', src.slice(0, 160))
    res.statusCode = 400
    res.end('bad host')
    return
  }
  try {
    const at = Number(loc.searchParams.get('t') || 0)
    await servePlay(req, res, src, Number.isFinite(at) ? at : 0)
  } catch (error) {
    console.warn('[h264-shim] 失败', String(error).slice(0, 200))
    if (!res.headersSent) {
      res.statusCode = 502
      res.end('ffmpeg failed')
    }
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`[h264-shim] 127.0.0.1:${PORT} 已在跑`)
    process.exit(0)
  }
  console.error('[h264-shim]', err)
  process.exit(1)
})

const attach = async () => {
  const { chromium } = await import(playwrightUrl)
  const browser = await chromium.connectOverCDP(CDP)
  cookieFn = async (url) => {
    const ctx = browser.contexts()[0]
    if (!ctx) return []
    return url ? ctx.cookies(url) : ctx.cookies()
  }
  for (const ctx of browser.contexts()) {
    await ctx.addInitScript(HOOK)
    for (const page of ctx.pages()) {
      for (const frame of page.frames()) {
        await frame.evaluate(HOOK).catch(() => {})
      }
    }
  }
  console.log('[h264-shim] 已挂到 CEF：边转边播')
  browser.on('disconnected', () => {
    console.warn('[h264-shim] CDP 断开，3 秒后重连')
    setTimeout(() => { void loop() }, 3000)
  })
}

const loop = async () => {
  try {
    await attach()
  } catch (error) {
    console.warn('[h264-shim] 等 CEF :9333', String(error).slice(0, 120))
    await sleep(2000)
    return loop()
  }
}

server.requestTimeout = 0
server.timeout = 0
server.headersTimeout = 0
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[h264-shim] http://127.0.0.1:${PORT}/play  边转边播`)
  void loop()
})
