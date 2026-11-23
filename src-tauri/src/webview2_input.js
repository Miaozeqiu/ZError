(function (loc) {
  const fail = reason => ({ reason });
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  const label = el => compact(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>el.ownerDocument.getElementById(id)?.textContent || '').join(' ').trim() || el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.textContent);
  const role = el => el.getAttribute('role') || ({BUTTON:'button', A:'link', TEXTAREA:'textbox', SELECT:'combobox'}[el.tagName]) || (el.tagName === 'INPUT' ? ({checkbox:'checkbox',radio:'radio',button:'button',submit:'button'}[el.type] || 'textbox') : '');
  const matches = (want, got) => loc.exact ? compact(want) === compact(got) : compact(got).includes(compact(want));
  const docs = [];
  function walk(win, path, depth) {
    if (depth > 16 || docs.length >= 128) return;
    try {
      const hint = loc.frame || '';
      if ((!loc.framePath || loc.framePath === path) && (!hint || hint === win.name || hint === win.frameElement?.id || win.location.href.includes(hint))) docs.push(win.document);
      for (let i=0;i<win.frames.length;i++) walk(win.frames[i], path ? path+'/'+i : String(i), depth+1);
    } catch {}
  }
  walk(window, '', 0);
  let pool = [];
  for (const doc of docs) {
    let nodes;
    if (loc.by === 'css') nodes = [...doc.querySelectorAll(loc.value)];
    else {
      nodes = [...doc.querySelectorAll(loc.by === 'role' ? 'button,a,input,textarea,select,[role]' : loc.by === 'label' ? 'input,textarea,select,[contenteditable]' : 'body *')].filter(el =>
        loc.by === 'role' ? role(el) === loc.value && (!loc.name || matches(loc.name,label(el))) : matches(loc.value,label(el)));
      if (loc.by === 'text') nodes = nodes.filter(el => !nodes.some(child => child !== el && el.contains(child)));
    }
    pool.push(...nodes.filter(el => el.isConnected && el.getClientRects().length && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden'));
    if (pool.length > 512) return fail('ambiguous');
  }
  if (loc.nth > 0) return pool[loc.nth-1] || fail('not_found');
  return pool.length === 1 ? pool[0] : fail(pool.length ? 'ambiguous' : 'not_found');
})
