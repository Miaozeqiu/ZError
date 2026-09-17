function parse(doc, href){
  var rows = items(doc);
  return {
    ok: rows.length > 0,
    page: 'unknown',
    confidence: rows.length ? 0.7 : 0.2,
    url: href || '',
    handles: rows.slice(0, 8).map(function(item){ return { kind: 'work', title: item.title }; }),
    hint: rows.length ? '用卡片 handles 打开，不要 get_page。' : '空卡，允许探路。'
  };
}
