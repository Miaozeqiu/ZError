function locate(handle){
  handle = handle || {};
  var rows = items(document);
  var want = String(handle.title || '');
  for (var i = 0; i < rows.length; i++) {
    if (!want || rows[i].title === want) {
      var pos = boxOf(rows[i].el);
      if (pos) return { found: true, x: pos.x, y: pos.y, text: rows[i].title };
    }
  }
  return { found: false };
}
