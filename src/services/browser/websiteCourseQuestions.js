// Read-only adapter for student homework and chapter quizzes. Never walks or writes another frame.
function readCourseHomework(doc, offset, limit, targetId, range, chapterQuiz, rules) {
  const normalize = value => String(value || '').replace(/[\s\u00a0]+/gu, ' ').trim();
  const text = node => normalize(node?.innerText || node?.textContent);
  const rootSelector = chapterQuiz ? rules.quizRows : rules.rows;
  const containers = [...doc.querySelectorAll(rootSelector)];
  const rows = containers.filter(node => !node.parentElement?.closest(rootSelector));
  const keys = rules.keys;
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
    const types = [...box.querySelectorAll(rules.typeInputs)].filter(node =>
      /^answertype[_-]?\d+$/.test(node.id) && (/^type\d+$/.test(node.name) || chapterQuiz && node.name === node.id));
    if (types.length === 1 && doc.querySelectorAll('input[id="' + types[0].id + '"]').length === 1) {
      const selector = ':is(' + rootSelector + '):has(input[id="' + types[0].id + '"])';
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
    node.matches(rules.visual) ||
    node.querySelector(rules.visual) ||
    doc.defaultView.getComputedStyle(node).fontFamily.toLowerCase().includes(rules.unreadableFont));
  const questionType = label => Object.keys(rules.labels).find(kind => rules.labels[kind].includes(label));
  const headingOf = box => box.querySelector(chapterQuiz ? rules.quizHeading : rules.heading);
  const numberPrefix = stem => stem.match(/^\s*(\d+)[.．、)）]\s*/);
  const numberOf = heading => {
    const number = heading?.matches(rules.quizTitleKind) && text(heading.querySelector(rules.quizTitleNumber));
    return number && /^\d+$/.test(number) ? Number(number) : Number(numberPrefix(text(heading))?.[1]) || 0;
  };
  const quizOptions = (box, key, controls, type) => {
    const labels = controls.map(row => normalize(row.querySelector(rules.optionMark)?.getAttribute('data')).normalize('NFKC').toUpperCase());
    const questionId = box.getAttribute('data') || (box.id || '').match(/^question(\d+)$/)?.[1];
    const sameQuestion = /^\d+$/.test(questionId || '') && controls.every(row => row.getAttribute('qid') === questionId);
    const answer = sameQuestion && box.querySelectorAll('input[type=hidden][id="answer' + questionId + '"]');
    const value = answer?.length === 1 ? normalize(answer[0].value).toUpperCase() : null;
    const selected = value !== null && /^(?:[A-Z](?:[,， ]?[A-Z])*)?$/.test(value) ? value.match(/[A-Z]/g) || [] : null;
    const valid = selected && selected.every(label => labels.includes(label)) && new Set(selected).size === selected.length
      && (type === 'multiple' || selected.length <= 1);
    return controls.map((row, index) => {
      const label = labels[index];
      const content = row.querySelector(rules.quizChoiceText);
      return { label, text: text(content), selected: Boolean(valid && selected.includes(label)),
        selector: valid && /^[A-Z]$/.test(label) && content ? controlPath(row, box, key) : null,
        unsafe: Boolean(unsafeText(content)), disabled: row.closest('[aria-disabled="true"], fieldset:disabled') !== null };
    });
  };
  const parse = (box, index, key) => {
    const heading = headingOf(box);
    const zy = heading?.matches(rules.quizTitleKind);
    const title = zy ? heading.querySelector(rules.quizTitle) : null;
    const rawStem = text(zy ? title?.parentElement : heading);
    const number = numberPrefix(rawStem);
    let stem = number ? rawStem.slice(number[0].length) : rawStem;
    const badge = stem.match(/^[（(【\[]\s*([^）)】\]]+)\s*[）)】\]]\s*/);
    const namedType = questionType(normalize(box.getAttribute('typename'))) || (badge && questionType(badge[1].trim()));
    if (badge && questionType(badge[1].trim())) stem = stem.slice(badge[0].length);
    const typeInputs = [...box.querySelectorAll(rules.typeInputs)];
    const typeInput = typeInputs.find(node => /^type\d+$/.test(node.name)) || (typeInputs.length === 1 ? typeInputs[0] : null);
    const rawType = typeInput?.value;
    const codedType = Object.hasOwn(rules.codes, rawType) ? rules.codes[rawType] : null;
    const type = (namedType || codedType || 'unsupported');
    let unobservable = false;
    const quizControls = chapterQuiz ? [...box.querySelectorAll(rules.quizOptions)].filter(visible) : [];
    const options = quizControls.length ? quizOptions(box, key, quizControls, type)
      : [...box.querySelectorAll(rules.options)].filter(visible).map(content => {
      const row = content.closest(rules.optionRow);
      const mark = row.querySelector(rules.optionMark);
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
        selector = key.selector + ' :is(' + rules.optionRow + '):has(:is(' + rules.optionMark + ')[data="' + attrLabel + '"]) ' + (control === input ? 'input[type="' + input.type + '"]' : rules.optionText);
      } else if (key && control === input && /^[a-zA-Z0-9_-]{1,96}$/.test(inputId || '')) {
        selector = key.selector + ' input[id="' + inputId + '"]';
      }
      if (selector && (doc.querySelectorAll(selector).length !== 1 || doc.querySelector(selector) !== control)) selector = null;
      return { label, text: prefix ? rendered.slice(prefix[0].length) : rendered, selected: Boolean(aria === 'true' || input?.checked || checkedClass),
        selector, unsafe: Boolean(unsafeText(content)),
        disabled: Boolean(input?.disabled || row.closest('[aria-disabled="true"], fieldset:disabled')) };
    });
    const blanks = type === 'completion' ? [...box.querySelectorAll('textarea, input[type=text], input:not([type])')].filter(node => visible(node) && !node.closest('[data-zerror-private]'))
      .map(node => ({ text: node.value, selector: controlPath(node, box, key), maxLength: node.maxLength, disabled: node.disabled || node.readOnly || node.matches(':disabled') })) : [];
    const nested = Boolean(box.querySelector(rules.nested + ', ' + rootSelector));
    const extraStem = Boolean(box.querySelector(rules.extraStem)) ||
      (zy && box.querySelectorAll(rules.quizTitleKind).length !== 1);
    const uniqueLabels = new Set(options.map(choice => choice.label));
    let issue = null;
    if (!key) issue = 'missing_identity';
    else if (extraStem || stem.length > 2500 || !heading) issue = 'stem_needs_review';
    else if (nested || type === 'unsupported' || (typeInput && !codedType) || namedType && codedType && namedType !== codedType) issue = 'unsupported_type';
    else if (type === 'completion' ? !blanks.length || blanks.length > 16 || blanks.some(item => !item.selector || item.disabled) :
      unobservable || options.length < 2 || options.length > 16 || uniqueLabels.size !== options.length ||
      (type === 'judgement' && options.length !== 2) || options.some(item => (!item.text && !item.unsafe) || item.text.length > 500 || !item.selector || item.disabled)) {
      issue = 'controls_need_review';
    } else if (unsafeText(heading) || options.some(item => item.unsafe)) issue = 'visual_needed';
    else if (!stem) issue = 'stem_needs_review';
    return { id: key?.id || null, order: index + 1, number: numberOf(heading) || index + 1, stem: stem.slice(0, 2500), type, issue, options, blanks };
  };
  const scope = [];
  const numbers = new Set();
  if (range) rows.forEach((box, index) => {
    const number = numberOf(headingOf(box)) || index + 1;
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
  const title = text(doc.querySelector(rules.title)).slice(0, 180);
  return { url: doc.location.href, title, documentTime: doc.defaultView.performance.timeOrigin, total: rows.length, questions,
    ...(range ? { scopeTotal: scope.length, scopeAmbiguous: numbers.size !== scope.length } : {}) };
}
