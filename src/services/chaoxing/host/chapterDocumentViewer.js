// Inspect and interact with the current viewer's visible controls.
function chapterDocument(advance) {
  const visible = node => node && node.getClientRects().length > 0
    && getComputedStyle(node).visibility === 'visible';
  const timing = Number(new URL(location.href).searchParams.get('timing'));
  const delay = Number.isFinite(timing) && timing > 0 ? timing * 1000 : 0;
  if (delay >= 2147483647) return { action: 'unavailable', position: '', delay: 0 };
  const page = document.querySelector('#pageNumber, #pageNum, #currentPage, #pagejump, [aria-current="page"], .swiper-slide-active');
  const count = document.querySelector('#numPages, .swiper-pagination-current');
  const image = [...document.querySelectorAll('#img .documentImg')].find(node => {
    if (!visible(node)) return false;
    const box = node.getBoundingClientRect();
    return box.top < innerHeight && box.bottom > 0;
  });
  const position = [String(page?.value || page?.getAttribute('aria-label') || page?.getAttribute('data-swiper-slide-index') || page?.textContent || '').slice(0, 120),
    count?.textContent, image?.getAttribute('data-page-number') || image?.getAttribute('src'), location.pathname, location.search].join('|');
  const pageNumber = Number(document.querySelector('#pageNumber')?.value);
  const total = Number(document.querySelector('#numPages')?.textContent?.match(/\d+/)?.[0]);
  if (pageNumber > 0 && total > 0 && pageNumber === total) return { action: 'end', position, delay };
  const buttons = [
    '#next', '#nextPage', '#nextpage', '#nextpagebtn', '#next-page', '#reader .reader-next', '.swiper-button-next', '#img .mkeRbtn',
    ':is(button,a,[role=button])[aria-label="下一页"]', ':is(button,a,[role=button])[title="下一页"]',
    ':is(button,a,[role=button])[aria-label="下一张"]', ':is(button,a,[role=button])[aria-label="Next page" i]',
    ':is(button,a,[role=button])[title="Next page" i]',
  ];
  for (const selector of buttons) {
    const matches = document.querySelectorAll(selector);
    const node = matches[0];
    if (matches.length !== 1 || !visible(node)) continue;
    if (node.matches(':disabled,[aria-disabled=true],.disabled,.swiper-button-disabled')) {
      return { action: 'wait', position, delay };
    }
    return { action: 'next', selector, position, delay };
  }
  const jumper = document.querySelector('#reader select#pagejump, select#pagejump');
  if (/\/readsvr\/book\/mooc\b/i.test(location.pathname) && visible(jumper) && !jumper.disabled && jumper.selectedIndex >= 0) {
    const next = [...jumper.options].findIndex((option, index) => index > jumper.selectedIndex && !option.disabled && !option.hidden && option.value);
    if (next >= 0) {
      if (advance) {
        jumper.selectedIndex = next;
        jumper.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { action: 'select', position, delay };
    }
    return { action: 'end', position, delay };
  }
  const viewport = [...document.querySelectorAll('#img.imglook, #viewerContainer, #reader, #ReadWeb')]
    .find(node => visible(node) && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 4
      && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY))
    || (/\/(?:mtiView\/reader|readsvr\/book\/mooc|screen\/file|pdfjs\/)/i.test(location.pathname) ? document.scrollingElement : null);
  if (viewport?.clientHeight && viewport.scrollHeight > viewport.clientHeight + 4) {
    const offset = viewport.scrollTop;
    const remaining = viewport.scrollHeight - viewport.clientHeight - offset;
    if (advance && remaining > 4) {
      viewport.scrollBy({ top: Math.min(remaining, viewport.clientHeight * 0.8), behavior: 'instant' });
    }
    return { action: remaining > 4 ? 'scroll' : 'end', position: position + '|' + viewport.scrollTop, delay };
  }
  return { action: 'unavailable', position, delay };
}
