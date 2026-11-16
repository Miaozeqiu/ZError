// Read-only adapter for the student course homework page. Never walks or writes another frame.
function readCourseHomework(doc, offset, limit, targetId, range) {
  const normalize = value => String(value || '').replace(/[\s\u00a0]+/gu, ' ').trim();
  const text = node => normalize(node?.innerText || node?.textContent);
  const rootSelector = '.questionLi';
  const containers = [...doc.querySelectorAll(rootSelector)];
  const rows = containers.filter(node => !node.parentElement?.closest(rootSelector));
  const keys = ['id', 'data-questionid', 'data-question-id', 'questionid', 'data'];
  // A synthesized path is never used to identify a question.
  const identity = box => {
    for (const key of keys) {
      const value = box.getAttribute(key);
      if (!value || !/^[a-zA-Z0-9_-]{1,96}$/.test(value)) continue;
      if (containers.filter(node => node.getAttribute(key) === value).length === 1) {
        return { id: key + ':' + value, selector: rootSelector + '[' + key + '="' + value + '"]' };
      }
    }
    // Some layouts only expose the stable question number inside the type input.
    const types = [...box.querySelectorAll('input[id^="answertype"]')].filter(node =>
      /^answertype[_-]?\d+$/.test(node.id) && /^type\d+$/.test(node.name));
    if (types.length === 1 && doc.querySelectorAll('input[id="' + types[0].id + '"]').length === 1) {
      const selector = rootSelector + ':has(input[id="' + types[0].id + '"])';
      if (doc.querySelectorAll(selector).length === 1) return { id: 'type:' + types[0].id, selector };
    }
    return null;
  };
  const controlPath = (node, box, identity) => {
    if (!identity || !node) return null;
    const path = [];
    for (let cur = node; cur && cur !== box; cur = cur.parentElement) {
      path.unshift(cur.localName + ':nth-child(' + ([...cur.parentElement.children].indexOf(cur) + 1) + ')');
    }
    const selector = identity.selector + ' > ' + path.join(' > ');
    return doc.querySelector(selector) === node ? selector : null;
  };
  const visible = node => {
    const style = doc.defaultView.getComputedStyle(node);
    return node.getClientRects().length > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  };
  const unsafeText = node => node && (/[\uE000-\uF8FF]/u.test(text(node)) ||
    node.matches('img,svg,canvas,math,mjx-container,.MathJax,.font-cxsecret,[class*="cxsecret"]') ||
    node.querySelector('img,svg,canvas,math,mjx-container,.MathJax,.font-cxsecret,[class*="cxsecret"]') ||
    /cxsecret/i.test(doc.defaultView.getComputedStyle(node).fontFamily));
  const headingTypes = [['single', /^(?:单选题?|单项选择题?)$/], ['multiple', /^(?:多选题?|多项选择题?)$/],
    ['judgement', /^判断题?$/], ['completion', /^填空题?$/]];
  const questionType = (label) => headingTypes.find(([, pattern]) => pattern.test(label))?.[0];
  const headingOf = box => box.querySelector('.mark_name, :scope > h3');
  const numberPrefix = stem => stem.match(/^\s*(\d+)[.．、)）]\s*/);
  const parse = (box, index, key) => {
    const heading = headingOf(box);
    const rawStem = text(heading);
    const number = numberPrefix(rawStem);
    let stem = number ? rawStem.slice(number[0].length) : rawStem;
    const badge = stem.match(/^[（(【\[]\s*([^）)】\]]+)\s*[）)】\]]\s*/);
    const namedType = questionType(normalize(box.getAttribute('typename'))) || (badge && questionType(badge[1].trim()));
    if (badge && questionType(badge[1].trim())) stem = stem.slice(badge[0].length);
    const typeInputs = [...box.querySelectorAll('input[id^="answertype"]')];
    const typeInput = typeInputs.find(node => /^type\d+$/.test(node.name)) || (typeInputs.length === 1 ? typeInputs[0] : null);
    const rawType = typeInput?.value;
    const codedType = ({ 0: 'single', 1: 'multiple', 2: 'completion', 3: 'judgement' })[rawType];
    const type = (namedType || codedType || 'unsupported');
    let unobservable = false;
    const options = [...box.querySelectorAll('.answerBg .answer_p')].filter(visible).map(content => {
      const row = content.closest('.answerBg');
      const mark = row.querySelector('.num_option');
      const input = row.querySelector('input[type=radio], input[type=checkbox]');
      const markerLabel = mark?.getAttribute('data') || '';
      const rendered = text(content);
      const prefix = /^[A-ZＡ-Ｚ]、[A-ZＡ-Ｚ]、/u.test(rendered) ? null : rendered.match(/^([A-ZＡ-Ｚ])[.．、:：)）]\s*/u);
      const label = normalize(markerLabel || prefix?.[1]).normalize('NFKC').toUpperCase();
      if (!/^[A-Z]$/.test(label) || (prefix && prefix[1].normalize('NFKC') !== label)) unobservable = true;
      const aria = row.getAttribute('aria-checked') ?? mark?.getAttribute('aria-checked');
      const marks = [row, mark, ...row.querySelectorAll('[class*="check_answer"]')].flatMap(node => node ? [...node.classList] : []);
      const checkedClass = marks.some(name => /^check_answer(?:_|$)/.test(name) && !/(?:no|not|un)?checked$|_(?:no|not|none|false|off|error)$/.test(name));
      if (marks.some(name => name.includes('check_answer')) && !checkedClass) unobservable = true;
      if (aria === 'false' && (checkedClass || input?.checked) || aria === 'true' && input && !input.checked) unobservable = true;
      if (!mark && !input && aria !== 'true' && aria !== 'false') unobservable = true;
      const control = input && visible(input) ? input : content;
      const attrLabel = mark?.getAttribute('data');
      const inputId = input?.id;
      let selector = null;
      if (key && attrLabel && /^[A-Za-zＡ-Ｚ]$/u.test(attrLabel)) {
        selector = key.selector + ' .answerBg:has(.num_option[data="' + attrLabel + '"]) ' + (control === input ? 'input[type="' + input.type + '"]' : '.answer_p');
      } else if (key && control === input && /^[a-zA-Z0-9_-]{1,96}$/.test(inputId || '')) {
        selector = key.selector + ' input[id="' + inputId + '"]';
      }
      if (selector && (doc.querySelectorAll(selector).length !== 1 || doc.querySelector(selector) !== control)) selector = null;
      return { label, text: prefix ? rendered.slice(prefix[0].length) : rendered, selected: Boolean(aria === 'true' || input?.checked || checkedClass),
        selector, unsafe: Boolean(unsafeText(content)),
        disabled: Boolean(input?.disabled || row.closest('[aria-disabled="true"], fieldset:disabled')) };
    });
    const blanks = type === 'completion' ? [...box.querySelectorAll('textarea, input[type=text], input:not([type])')].filter(visible)
      .map(node => ({ text: node.value, selector: controlPath(node, box, key), maxLength: node.maxLength, disabled: node.disabled || node.readOnly || node.matches(':disabled') })) : [];
    const nested = Boolean(box.querySelector('.reading_answer, .filling_answer, .line_answer, iframe, .questionLi'));
    const extraStem = Boolean(box.querySelector('.line_wid_half, .splitS-left .mark_name ~ .mark_name'));
    const uniqueLabels = new Set(options.map(choice => choice.label));
    let issue = null;
    if (!key) issue = 'missing_identity';
    else if (extraStem || stem.length > 2500 || !heading) issue = 'stem_needs_review';
    else if (nested || type === 'unsupported' || (typeInput && !codedType) || namedType && codedType && namedType !== codedType) issue = 'unsupported_type';
    else if (type === 'completion' ? !blanks.length || blanks.length > 16 || blanks.some(item => !item.selector || item.disabled) :
      unobservable || options.length < 2 || options.length > 16 || uniqueLabels.size !== options.length ||
      (type === 'judgement' && options.length !== 2) || options.some(item => !item.text || item.text.length > 500 || !item.selector || item.disabled)) {
      issue = 'controls_need_review';
    } else if (unsafeText(heading) || options.some(item => item.unsafe)) issue = 'visual_needed';
    else if (!stem) issue = 'stem_needs_review';
    return { id: key?.id || null, order: index + 1, number: Number(number?.[1]) || index + 1, stem: stem.slice(0, 2500), type, issue, options, blanks };
  };
  const scope = [];
  const numbers = new Set();
  if (range) rows.forEach((box, index) => {
    const number = Number(numberPrefix(text(headingOf(box)))?.[1]) || index + 1;
    if (number < range.start || number > range.end) return;
    numbers.add(number);
    scope.push(index);
  });
  const questions = [];
  if (targetId) {
    const index = rows.findIndex(box => identity(box)?.id === targetId);
    if (index >= 0 && (!range || scope.includes(index))) questions.push(parse(rows[index], index, identity(rows[index])));
  } else if (range) {
    for (const index of scope.slice(offset, offset + limit)) questions.push(parse(rows[index], index, identity(rows[index])));
  } else {
    const end = Math.min(rows.length, offset + limit);
    for (let i = offset; i < end; i++) questions.push(parse(rows[i], i, identity(rows[i])));
  }
  const title = text(doc.querySelector('.mark_title, .work-title, h1')).slice(0, 180);
  return { url: doc.location.href, title, documentTime: doc.defaultView.performance.timeOrigin, total: rows.length, questions,
    ...(range ? { scopeTotal: scope.length, scopeAmbiguous: numbers.size !== scope.length } : {}) };
}
