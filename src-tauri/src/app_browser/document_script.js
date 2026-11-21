(function (expected, args) {
  'use strict';
  if (String(location.href) !== expected.url) throw new Error('Document changed');
  const action = args.action;
  const identityKey = Symbol.for('zerror.document.identity.v2');
  if (action !== 'identity' && expected.frameId === 'wry-main' && document[identityKey] !== expected.loaderId) throw new Error('Document changed');
  const waitsKey = Symbol.for('zerror.media.waits.v2');
  if (action === 'media_cancel') {
    globalThis[waitsKey]?.get(args.wait_id)?.();
    return { ok: true };
  }
  if (action === 'identity') {
    const key = Symbol.for('zerror.document.identity.v2');
    if (!document[key]) Object.defineProperty(document, key, { value: 'wry:' + crypto.randomUUID() });
    return { frameId: 'wry-main', loaderId: document[key], url: String(location.href), children: document.querySelectorAll('iframe,frame').length };
  }
  if (action === 'navigate') {
    location.assign(args.url);
    return { ok: true, dispatched: true };
  }
  const candidates = document.querySelectorAll(args.selector);
  const matches = Array.from(candidates).slice(0, 101);
  const visible = node => node.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const privateNode = node => node.type === 'password' || node.hasAttribute('data-zerror-private') || node.closest('[data-zerror-private]');
  // Stable, bounded locators let packages address repeated rows without receiving page scripts.
  const locator = node => {
    let current = node, parts = [];
    for (let depth = 0; current && depth < 32; depth++, current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(other => other.tagName === current.tagName) : [current];
      parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
      const path = parts.join(' > ');
      if (path.length > 512) return '';
      if (current === document.documentElement) return path;
    }
    return '';
  };
  if (action === 'query') {
    const offset = args.offset || 0;
    return { ok: true, nodes: Array.from(candidates).slice(offset, offset + args.limit).map((node, index) => ({
      index: offset + index + 1, selector: locator(node), tag: node.tagName.toLowerCase(),
      text: privateNode(node) || node instanceof HTMLTextAreaElement ? '' : String(node.textContent || '').slice(0, 2048),
      visible: visible(node), disabled: Boolean(node.disabled), checked: Boolean(node.checked),
      selected: Boolean(node.selected), scroll: { top: node.scrollTop || 0, max: Math.max(0, node.scrollHeight - node.clientHeight), viewport: node.clientHeight || 0 },
      choice: ['radio','checkbox'].includes(node.type) && /^[A-Z]$/.test(node.value) ? node.value : '',
      hasValue: 'value' in node && Boolean(node.value),
      // A boolean flag is sufficient for hidden feature switches, never disclose their value.
      valueIsTrue: args.allowFlags === true && !privateNode(node) && node.type === 'hidden' && /^(?:1|true)$/i.test(node.value),
      attributes: Object.fromEntries(['id', 'class', 'type', 'name', 'role', 'href', 'src', 'alt', 'title', 'aria-label', 'aria-checked', 'aria-selected', 'aria-disabled', 'placeholder'].map(key => [key, String(node.getAttribute(key) || '').slice(0, 2048)])),
    })), total: candidates.length, truncated: candidates.length > offset + args.limit };
  }
  const node = args.nth ? matches[args.nth - 1] : matches.length === 1 ? matches[0] : null;
  if (!node || !node.isConnected || node.ownerDocument !== document || (['click','fill','select'].includes(action) && (node.disabled || node.readOnly))
    || ((action === 'click' || action === 'fill' || action === 'image') && !visible(node))) return { ok: false, reason: 'not_found', dispatched: false };
  if (action === 'scroll') {
    node.scrollBy({ top: args.amount, behavior: 'instant' });
    return { ok: true, dispatched: true, top: node.scrollTop };
  }
  if (action === 'select') {
    if (!(node instanceof HTMLSelectElement) || !node.options[args.index - 1] || node.options[args.index - 1].disabled) return { ok: false, reason: 'invalid_option', dispatched: false };
    node.selectedIndex = args.index - 1;
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, dispatched: true, selectedIndex: node.selectedIndex + 1 };
  }
  if (action === 'value') {
    if (privateNode(node) || document.querySelector('input[type=password], [data-zerror-private]') || !(node instanceof HTMLTextAreaElement || node.isContentEditable || node instanceof HTMLInputElement && ['text','search','number',''].includes(node.type))) return { ok: false, reason: 'private_input' };
    const value = String(node.isContentEditable ? node.textContent : node.value);
    return { ok: true, value: value.slice(0, 8192), truncated: value.length > 8192 };
  }
  if (action === 'compare') {
    if (privateNode(node) || !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node.isContentEditable)) return { ok: false, reason: 'private_input' };
    return { ok: true, matches: String(node.isContentEditable ? node.textContent : node.value) === args.text };
  }
  if (action === 'image') {
    if (!(node instanceof HTMLImageElement || node instanceof HTMLCanvasElement)) return { ok: false, reason: 'not_image' };
    const width = node.naturalWidth || node.width, height = node.naturalHeight || node.height;
    if (!width || !height || width > 1024 || height > 512 || width * height > 262144) return { ok: false, reason: 'image_size' };
    try {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(node, 0, 0);
      const image = canvas.toDataURL('image/png');
      if (image.length > 96000) return { ok: false, reason: 'image_size' };
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(image)).then(bytes => ({ ok: true, image,
        image_id: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''), width, height }));
    } catch { return { ok: false, reason: 'image_unavailable' }; }
  }
  if (action === 'click') { node.click(); return { ok: true, dispatched: true }; }
  if (action === 'fill') {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node.isContentEditable) || privateNode(node)) {
      return { ok: false, reason: 'private_input', dispatched: false };
    }
    if (node.isContentEditable) {
      node.textContent = args.text; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, dispatched: true, filled: node.textContent === args.text };
    }
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, args.text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, dispatched: true, filled: node.isConnected && node.value === args.text };
  }
  if (!(node instanceof HTMLMediaElement)) return { ok: false, reason: 'not_media', dispatched: false };
  const state = () => ({ ok: true, paused: node.paused, ended: node.ended, muted: node.muted,
    current: Number.isFinite(node.currentTime) ? node.currentTime : 0, duration: Number.isFinite(node.duration) ? node.duration : 0, ready: node.readyState });
  if (action === 'media_read') return state();
  if (action === 'media_wait') {
    const reached = () => args.until === 'ended' ? node.ended : args.until === 'playing' ? !node.paused && !node.ended : node.paused;
    if (reached()) return { ...state(), event: args.until };
    const waits = globalThis[waitsKey] ||= new Map();
    if (waits.size >= 16 || waits.has(args.wait_id)) throw new Error('Media wait budget exceeded');
    return new Promise(resolve => {
      let timer, done = false;
      const events = ['ended', 'playing', 'pause', 'error', 'emptied'];
      const finish = event => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const name of events) node.removeEventListener(name, changed);
        waits.delete(args.wait_id);
        resolve({ ...state(), event });
      };
      const changed = event => { if (reached() || ['error', 'emptied'].includes(event.type)) finish(event.type); };
      waits.set(args.wait_id, () => finish('cancelled'));
      for (const name of events) node.addEventListener(name, changed);
      timer = setTimeout(() => finish('timeout'), args.timeoutMs);
    });
  }
  if (action === 'media_pause') node.pause();
  else if (action === 'media_mute') node.muted = args.muted;
  else if (action === 'media_play') return Promise.resolve(node.play()).then(() => ({ ...state(), dispatched: true }));
  else throw new Error('Unknown document action');
  return { ...state(), dispatched: true };
})
