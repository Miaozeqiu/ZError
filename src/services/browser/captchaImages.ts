/** 登录/叠层验证码小图：从页内 img.src 或整页截图裁切，给视觉模型单独看。 */
import { asObject, evalBrowserViewMain, withSameFrames } from './eval'

export type CaptchaBox = {
  x: number
  y: number
  width: number
  height: number
}

export type CaptchaHit = {
  image: string
  src: string
  width: number
  height: number
  box: CaptchaBox
  viewport: { width: number; height: number }
  maxlength: number
}

/** 页内采集。走同源 iframe，不要 contentDocument。 */
export const COLLECT_CAPTCHA_IMAGES = `(function(){
  var viewport = { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  var frames = typeof __sameFrames === 'function' ? __sameFrames(window, 0) : [window];
  var out = [];
  var pageRect = function(el, win){
    var r = el.getBoundingClientRect();
    var x = r.left;
    var y = r.top;
    var cur = win;
    while (cur && cur !== window) {
      try {
        var frame = cur.frameElement;
        if (!frame) break;
        var fr = frame.getBoundingClientRect();
        x += fr.left;
        y += fr.top;
        cur = cur.parent;
      } catch (eP) { break; }
    }
    return { x: x, y: y, width: r.width, height: r.height };
  };
  var hayOf = function(img){
    return [
      img.alt, img.title, img.className, img.id,
      img.getAttribute && img.getAttribute('name'),
      img.src
    ].join(' ');
  };
  var nearbyText = function(img){
    var box = img.parentElement;
    for (var i = 0; i < 4 && box; i++) {
      var t = '';
      try { t = String(box.innerText || box.textContent || ''); } catch (eT) {}
      if (/验证码|点击刷新|captcha/i.test(t) && t.length < 800) return true;
      box = box.parentElement;
    }
    return false;
  };
  var nearbyInput = function(img){
    var form = img.closest ? img.closest('form') : null;
    var root = form || img.parentElement;
    for (var up = 0; up < 5 && root; up++) {
      var inputs = root.querySelectorAll ? root.querySelectorAll('input') : [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var type = String(el.type || '').toLowerCase();
        if (type === 'hidden' || type === 'password' || type === 'checkbox' || type === 'radio') continue;
        var max = Number(el.maxLength || el.getAttribute('maxlength') || 0);
        var min = Number(el.minLength || el.getAttribute('minlength') || 0);
        var ph = String(el.placeholder || el.name || el.id || el.getAttribute('aria-label') || '');
        if (/验证码|captcha|vcode|yzm|verify/i.test(ph)) return { maxlength: max || min || 0 };
        if (max >= 4 && max <= 8) return { maxlength: max };
        if (min >= 4 && min <= 8) return { maxlength: min };
      }
      if (form) break;
      root = root.parentElement;
    }
    return null;
  };
  var looks = function(img){
    var hay = hayOf(img);
    if (/#ccc|processVerify|验证码|点击刷新|captcha|vcode|yzm|verifycode|validatecode/i.test(hay)) return { why: 'attr' };
    if (nearbyText(img)) return { why: 'text' };
    var inp = nearbyInput(img);
    if (!inp) return null;
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (w >= 40 && w <= 280 && h >= 16 && h <= 120) return { why: 'input', maxlength: inp.maxlength };
    return null;
  };
  var tryData = function(img){
    var src = String(img.src || '');
    if (src.indexOf('data:image') === 0 && src.length > 32 && src.length < 200000) return src;
    try {
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (w < 8 || h < 8 || w > 400 || h > 160) return '';
      var doc = img.ownerDocument || document;
      var c = doc.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0);
      var png = c.toDataURL('image/png');
      if (png && png.indexOf('data:image') === 0 && png.length < 200000) return png;
    } catch (eC) {}
    return '';
  };
  for (var fi = 0; fi < frames.length && out.length < 3; fi++) {
    var win = frames[fi];
    var doc = null;
    try { doc = win.document; } catch (eD) { continue; }
    if (!doc) continue;
    var imgs = [];
    try { imgs = doc.querySelectorAll('img'); } catch (eI) { continue; }
    for (var i = 0; i < imgs.length && out.length < 3; i++) {
      var img = imgs[i];
      var hit = looks(img);
      if (!hit) continue;
      try { img.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (eS) {}
      var box = pageRect(img, win);
      if (box.width < 8 || box.height < 8) continue;
      var inp = nearbyInput(img);
      out.push({
        image: tryData(img),
        src: String(img.src || '').slice(0, 180),
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        box: box,
        viewport: viewport,
        maxlength: Number((hit && hit.maxlength) || (inp && inp.maxlength) || 0) || 0
      });
    }
  }
  return { items: out, viewport: viewport };
})()`

export const cropRectOnImage = (
  imageW: number,
  imageH: number,
  viewportW: number,
  viewportH: number,
  box: CaptchaBox,
  pad = 6,
) => {
  if (imageW < 8 || imageH < 8 || viewportW < 8 || viewportH < 8) return null
  if (box.width < 8 || box.height < 8) return null
  if (box.width > viewportW * 0.4 || box.height > viewportH * 0.35) return null
  const sx = imageW / viewportW
  const sy = imageH / viewportH
  const x = Math.max(0, Math.floor((box.x - pad) * sx))
  const y = Math.max(0, Math.floor((box.y - pad) * sy))
  const w = Math.min(imageW - x, Math.ceil((box.width + pad * 2) * sx))
  const h = Math.min(imageH - y, Math.ceil((box.height + pad * 2) * sy))
  if (w < 8 || h < 8) return null
  return { x, y, w, h }
}

export const parseCaptchaHits = (raw: unknown): CaptchaHit[] => {
  const root = asObject(raw)
  const viewport = asObject(root.viewport)
  const fallbackView = {
    width: Number(viewport.width) || 0,
    height: Number(viewport.height) || 0,
  }
  const items = Array.isArray(root.items) ? root.items : Array.isArray(raw) ? raw : []
  const out: CaptchaHit[] = []
  for (const item of items) {
    const row = asObject(item)
    const box = asObject(row.box)
    const view = asObject(row.viewport)
    const image = String(row.image || '')
    out.push({
      image: image.startsWith('data:image/') ? image : '',
      src: String(row.src || '').slice(0, 180),
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      box: {
        x: Number(box.x) || 0,
        y: Number(box.y) || 0,
        width: Number(box.width) || 0,
        height: Number(box.height) || 0,
      },
      viewport: {
        width: Number(view.width) || fallbackView.width,
        height: Number(view.height) || fallbackView.height,
      },
      maxlength: Number(row.maxlength) || 0,
    })
    if (out.length >= 3) break
  }
  return out
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  if (typeof Image === 'undefined') {
    reject(new Error('no Image'))
    return
  }
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('decode'))
  img.src = url
})

const cropPageImage = async (pageImage: string, hit: CaptchaHit) => {
  if (!pageImage.startsWith('data:image/')) return ''
  try {
    const img = await loadImage(pageImage)
    const rect = cropRectOnImage(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      hit.viewport.width,
      hit.viewport.height,
      hit.box,
    )
    if (!rect) return ''
    const canvas = document.createElement('canvas')
    canvas.width = rect.w
    canvas.height = rect.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
    const out = canvas.toDataURL('image/png')
    return out.startsWith('data:image/') ? out : ''
  } catch {
    return ''
  }
}

/** 小验证码放大、关平滑，避免视觉模型按低清糊掉笔画。 */
export const enlargeTinyImage = async (dataUrl: string, minEdge = 96) => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  try {
    const img = await loadImage(dataUrl)
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    if (!width || !height || (width >= minEdge && height >= minEdge)) return dataUrl
    const scale = Math.max(minEdge / width, minEdge / height, 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const out = canvas.toDataURL('image/png')
    return out.startsWith('data:image/') ? out : dataUrl
  } catch {
    return dataUrl
  }
}

export const collectPageCaptchaHits = async (id: string) => {
  const raw = await evalBrowserViewMain(id, withSameFrames(COLLECT_CAPTCHA_IMAGES)).catch(() => null)
  return parseCaptchaHits(raw)
}

export const materializeCaptchaImages = async (hits: CaptchaHit[], pageImage: string) => {
  const images: string[] = []
  let maxlength = 0
  for (const hit of hits) {
    if (hit.maxlength >= 4 && hit.maxlength <= 8 && !maxlength) maxlength = hit.maxlength
    let image = hit.image
    if (!image) image = await cropPageImage(pageImage, hit)
    if (!image.startsWith('data:image/')) continue
    image = await enlargeTinyImage(image)
    if (!images.includes(image)) images.push(image)
  }
  return { images, maxlength }
}

export const captchaScreenshotHint = (count: number, maxlength: number) => {
  if (!count) return undefined
  const digits = maxlength >= 4 && maxlength <= 8 ? `约 ${maxlength} 位` : '通常 4～6 位'
  return `另附 ${count} 张验证码原图，请认较小的那张（${digits}）。整页只作位置参考。`
}
