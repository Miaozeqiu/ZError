function clean(s){
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function boxOf(el){
  if (!el) return null;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
  var r = null;
  try { r = el.getBoundingClientRect(); } catch (e1) {}
  if (!r || r.width < 2 || r.height < 2) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, space: 'page' };
}

function items(doc){
  var root = doc || document;
  var nodes = [];
  try { nodes = root.querySelectorAll('a, button, [data-id]'); } catch (e) { return []; }
  var out = [];
  for (var i = 0; i < nodes.length && out.length < 40; i++) {
    var title = clean(nodes[i].getAttribute('title') || nodes[i].textContent || '');
    if (title) out.push({ el: nodes[i], title: title });
  }
  return out;
}
