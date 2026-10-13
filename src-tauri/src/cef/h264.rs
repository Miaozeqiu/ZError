//! 开源 CEF 无 H.264：伪装 canPlayType，并把 mp4 指到本机边转边播的 WebM。

/// 开源 CEF 无 H.264：伪装 canPlayType，并把 mp4 指到本机边转边播的 WebM。
/// 守卫不可枚举；时长/监听挂 WeakMap，避免在 video 元素上露 `__ze*`。
pub const CLAIM_H264: &str = r#"(function(){
  try {
    var prev = Object.getOwnPropertyDescriptor(window, '__ZE_H264__');
    if (prev && window.__ZE_H264__ === 5) return;
  } catch (e0) {}
  var hide = function (key, val) {
    try {
      Object.defineProperty(window, key, { value: val, writable: true, configurable: true, enumerable: false });
    } catch (eH) { window[key] = val; }
  };
  var origCan = HTMLMediaElement.prototype.canPlayType;
  try {
    var probe = document.createElement('video');
    if (origCan.call(probe, 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
      hide('__ZE_H264__', 5);
      hide('__ZE_H264_NATIVE__', true);
      return;
    }
  } catch (e1) {}
  hide('__ZE_H264__', 5);
  hide('__ZE_H264_CLAIM__', true);
  var orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    var t = String(type || '');
    if (/avc1|mp4a|video\/mp4|audio\/mp4|video\/webm|vp8|opus/i.test(t)) return 'probably';
    return orig.call(this, type);
  };
  try {
    if (window.MediaSource && MediaSource.isTypeSupported) {
      var origMs = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (type) {
        var t = String(type || '');
        if (/avc1|mp4a|video\/mp4|audio\/mp4|video\/webm|vp8|opus/i.test(t)) return true;
        return origMs(type);
      };
    }
  } catch (e2) {}
  var durMap = new WeakMap();
  var watchMap = new WeakMap();
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
            var z = durMap.get(this);
            return z > 0 ? z : n;
          } catch (e3) {
            var z2 = durMap.get(this);
            return z2 > 0 ? z2 : NaN;
          }
        }
      });
    }
  } catch (e4) {}
  var hintDur = function (el) {
    if (!el) return;
    var src = '';
    try { src = el.currentSrc || el.src || ''; } catch (e5) {}
    var i = src.indexOf('u=');
    if (i < 0) return;
    var u = src.slice(i + 2).split('&')[0];
    fetch('http://127.0.0.1:1430/meta?u=' + u).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.duration > 0 && durMap.get(el) !== j.duration) {
        durMap.set(el, j.duration);
        try { el.dispatchEvent(new Event('durationchange')); } catch (e6) {}
      }
    }).catch(function () {});
  };
  var watchMeta = function (el) {
    if (!el || watchMap.has(el)) return;
    watchMap.set(el, 1);
    var n = 0;
    var tick = function () {
      hintDur(el);
      n += 1;
      if (durMap.get(el) > 0 || n > 50) return;
      setTimeout(tick, 300);
    };
    tick();
  };
  var proxy = 'http://127.0.0.1:1430/play?u=';
  var wrap = function (url) {
    url = String(url || '');
    if (!url || url.indexOf('127.0.0.1:1430') >= 0 || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return url;
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
        try { this.preload = 'none'; } catch (e7) {}
        desc.set.call(this, wrap(v));
        watchMeta(this);
      }
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
    try { this.preload = 'auto'; } catch (e8) {}
    watchMeta(this);
    return origPlay.apply(this, arguments);
  };
  var list = document.querySelectorAll('video');
  for (var i = 0; i < list.length; i++) {
    try { list[i].preload = 'none'; } catch (e9) {}
    var src = list[i].currentSrc || list[i].src || '';
    if (src && src.indexOf('127.0.0.1:1430') < 0) list[i].src = wrap(src);
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
    } catch (e10) {}
  };
  if (document.body) bustFlash();
  else document.addEventListener('DOMContentLoaded', bustFlash);
  setTimeout(bustFlash, 600);
  setTimeout(bustFlash, 1800);
})()"#;

/// 学习通页自己会读这两个桩；只在 chaoxing host 上挂。
pub const CLAIM_H264_CX: &str = r#"(function(){
  try {
    if (!/chaoxing\.com/i.test(String(location.host || location.hostname || ''))) return;
    window.isStuH5Page = true;
    window.flashChecker = function () { return { hasFlash: 0, version: 0 }; };
  } catch (e) {}
})()"#;

pub fn claim_h264_bundle() -> String {
  format!("{CLAIM_H264}\n{CLAIM_H264_CX}")
}
