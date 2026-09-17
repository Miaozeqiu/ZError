/** CEF 走 CDP Runtime.evaluate，只取 HTML，解析器在本地跑。 */
export const READ_PAGE_DOM = () => `(function(){
  return {
    ok: true,
    url: location.href || '',
    title: String(document.title || '').replace(/^ZRRESULT:.*/, '').slice(0, 80),
    questionLi: document.querySelectorAll('.questionLi, .singleQuesId').length,
    workLi: document.querySelectorAll('.workLi, .bottomList li, a[href*="work"]').length,
    catalogLi: document.querySelectorAll('#coursetree .posCatalog_select, .catalog_title, a.clicktitle, .posCatalog_name, .chapter_item').length,
    html: document.documentElement ? document.documentElement.outerHTML : ''
  };
})()`

export const ensurePageBase = (html: string, href: string) => {
  const base = href || 'https://mooc1.chaoxing.com/'
  if (/<base\s/i.test(html)) return html
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`)
  return `<head><base href="${base}"></head>${html}`
}

export const createPageDocument = (html: string, href = '') => {
  const parser = new DOMParser()
  return parser.parseFromString(ensurePageBase(html, href), 'text/html')
}
