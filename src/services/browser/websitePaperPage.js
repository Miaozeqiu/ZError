// Read only what the current paper renders. Writes recheck the route, stem,
// option order and existing answer in the same browser operation.
(function (host, rules, request) {
  const atHost = location.hostname === host || location.hostname.endsWith('.' + host)
  const parts = location.pathname.split('/').filter(Boolean)
  const suffix = rules.optionalSuffix
  if (suffix && parts.at(-2) === suffix && /^\d+$/.test(parts.at(-1))) parts.splice(-2)
  const route = rules.routes.find(pattern => parts.length === pattern.length
    && pattern.every((part, index) => part.startsWith(':') ? /^[\w-]+$/.test(parts[index]) : part === parts[index]))
  if (location.protocol !== 'https:' || location.port || !atHost || !route) return { error: '请先打开目标作答页或讲评页。' }
  const [courseId, kind, stage, paperId] = [':course', ':kind', ':stage', ':paper'].map(key => parts[route.indexOf(key)])
  if (!rules.kinds.includes(kind) || ![rules.exerciseStage, rules.reviewStage].includes(stage)) return { error: '请先打开目标作答页或讲评页。' }
  const key = [courseId, kind, paperId].join('/')
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible'
  const text = el => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (request.reviewReady) return { ready: stage === rules.reviewStage && [...document.querySelectorAll(rules.reviewReady)].some(el => visible(el) && text(el)) }
  const single = kind === rules.singleKind
  const rows = [...document.querySelectorAll(single ? rules.singleRows : rules.rows)].filter(visible)
  const title = text(document.querySelector(rules.title))
  const rowNumber = (row, i) => {
    const label = single ? document.querySelector(rules.singleNumber) : row.querySelector(rules.rowNumber)
    return Number(text(label).match(/^\s*(\d+)/)?.[1]) || i + 1
  }
  function read(row, index) {
    const header = row.querySelector(rules.stem)
    const fields = [...row.querySelectorAll(rules.fields)].filter(el => visible(el)
      && el.matches('textarea, input[type=text], input:not([type])') && !el.closest('[data-zerror-private]'))
    const choices = [...row.querySelectorAll(rules.choices)].filter(visible)
    const inputs = choices.map(el => el.querySelector('input[type=radio],input[type=checkbox]'))
    const options = choices.map((el, i) => {
      const content = el.querySelector(rules.choiceText)
      const value = content ? text(content) : text(el).replace(/^[A-Z][.、．]\s*/, '')
      const raw = inputs[i]?.value || ''
      const label = /^[A-Z]$/.test(raw) ? raw : String.fromCharCode(65 + i)
      return { label, text: value }
    })
    const multiple = inputs.some(el => el?.type === 'checkbox')
    const judge = choices.length === 2 && options.every(opt => rules.judgeLabels.includes(opt.text))
    const group = single ? text(document.querySelector(rules.singleNumber)) :
      text(row.closest(rules.questionGroup)?.previousElementSibling)
    const complex = rules.unsupportedGroups.some(label => group.includes(label))
    const type = choices.length ? multiple ? 'multiple' : judge ? 'judgement' : 'single' : 'completion'
    const actual = fields.length ? fields.map(el => el.value) : options.filter((_,i) => inputs[i]?.checked).map(o => o.label)
    const stem = text(header)
    const supported = !complex && !!stem && !row.querySelector(rules.excluded) && row.querySelectorAll(rules.questionBody).length <= 1
      && (choices.length ? !fields.length && inputs.every(Boolean) && new Set(options.map(o => o.label)).size === choices.length && options.every(o => o.text) && new Set(options.map(o => o.text)).size === options.length : fields.length > 0)
    const markers = [...row.querySelectorAll(rules.reviewMarker)].filter(visible)
    const official = markers.length === 1 && text(markers[0]).includes(rules.reviewLabel) && markers[0].nextElementSibling?.matches(rules.reviewAnswer) && visible(markers[0].nextElementSibling)
      ? text(markers[0].nextElementSibling) : ''
    const number = rowNumber(row, index)
    const subjectType = group.includes(rules.alternateMultipleLabel) ? rules.subjectTypes.alternate : rules.subjectTypes[type]
    return { data: { index, number, stem, options, type, subjectType, blanks: fields.length, actual, supported, official }, fields, inputs }
  }
  if (request.write) {
    if (stage !== rules.exerciseStage || key !== request.key) return { error: '试卷已切换。' }
    const row = rows[request.index]
    if (typeof request.url !== 'string' || location.origin + location.pathname !== request.url) return { error: '试卷地址已变化。' }
    if (!row) return { error: '题目已切换。' }
    const { data, fields, inputs } = read(row, request.index)
    const { actual } = data
    const identity = [data.index, data.number, data.type, data.subjectType, data.stem, data.blanks, data.options.map(o => [o.label, o.text])]
    if (!data.supported || JSON.stringify(identity) !== request.identity || JSON.stringify(actual) !== JSON.stringify(request.before)) return { error: '题目或作答已变化。' }
    const answers = request.answers
    if (!Array.isArray(answers) || !answers.length || answers.some(v => typeof v !== 'string' || !v.trim())) return { error: '答案无效。' }
    if (fields.length) {
      if (answers.length !== fields.length || fields.some((el,i) => el.disabled || el.readOnly || (el.maxLength >= 0 && answers[i].length > el.maxLength))) return { error: '填空控件不可用。' }
      fields.forEach((el,i) => {
        if (el.value === answers[i]) return
        el.value = answers[i]
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    } else {
      if ((data.type !== 'multiple' && answers.length !== 1) || answers.some(a => !data.options.some(o => o.label === a)) || inputs.some(el => !el || el.disabled)) return { error: '选项不可用。' }
      inputs.forEach((el,i) => { if (answers.includes(data.options[i].label) && !el.checked) el.click() })
    }
    return { written: true }
  }
  const index = Number(request.offset) || 0
  const totalText = [...document.querySelectorAll(rules.totalLabels)].filter(el => !el.childElementCount && !el.closest(':is(' + rules.rows + ')') && visible(el)).map(text)
  const declared = single ? document.querySelectorAll(rules.indexItems).length : totalText.reduce((sum, value) => sum + Number(value.match(/共\s*(\d+)\s*题/)?.[1] || 0), 0)
  const scope = rows.map((row, i) => ({ row, i, number: rowNumber(row, i) })).filter(({ number }) =>
    !request.range || (number >= request.range.start && number <= request.range.end))
  return { key, url: location.origin + location.pathname, single, courseId, kind, stage, paperId, title, declared, total: rows.length, scopeTotal: scope.length,
    ambiguous: !!request.range && new Set(scope.map(r => r.number)).size !== scope.length,
    hasNext: single && [...document.querySelectorAll(rules.next)].some(el => visible(el) && !el.disabled && text(el) === rules.nextLabel),
    questions: scope.slice(index, index + request.limit).map(({row, i}) => read(row, i).data) }
})
