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

function courseItems(doc){
  var root = doc || document;
  var nodes = [];
  try { nodes = root.querySelectorAll('.course-item, li.course, [data-course-id]'); } catch (e) { return []; }
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var box = nodes[i];
    var name = null;
    try { name = box.querySelector('.course-name, a, h3, .title'); } catch (e2) {}
    var title = clean((name && (name.getAttribute('title') || name.textContent)) || box.getAttribute('title') || '');
    if (!title) continue;
    var status = '';
    try {
      var st = box.querySelector('.course-status, .status, .tag');
      status = clean(st && st.textContent);
    } catch (e3) {}
    var href = '';
    try { href = String((name && name.getAttribute('href')) || box.getAttribute('href') || ''); } catch (e4) {}
    out.push({ el: name || box, box: box, title: title, status: status, href: href });
  }
  return out;
}

function findCourse(doc, title){
  var want = clean(title);
  var items = courseItems(doc);
  for (var i = 0; i < items.length; i++) {
    if (items[i].title === want || items[i].title.indexOf(want) >= 0 || want.indexOf(items[i].title) >= 0) {
      return items[i];
    }
  }
  return null;
}
