function parse(doc, href){
  var items = courseItems(doc);
  var works = items.map(function(item){
    return { title: item.title, status: item.status || '进行中', href: item.href || '' };
  });
  var handles = works.map(function(item){
    return { kind: 'work', title: item.title };
  });
  return {
    ok: works.length > 0,
    page: 'list',
    confidence: works.length ? 0.9 : 0.2,
    url: href || '',
    title: '课程列表',
    works: works,
    handles: handles,
    next: works.length ? 'open' : '',
    hint: works.length ? ('直接打开「' + works[0].title + '」，不要 get_page。') : '列表为空，允许 get_page 探路。'
  };
}
