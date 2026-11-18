// Read only what the current paper renders. Writes recheck the route, stem,
// option order and existing answer in the same browser operation.
(function (request) {
  const route = location.pathname.match(/^\/(?:u(?:ser)?center\/student\/)?course\/study\/([\w-]+)\/(homework|exam|singleQuestion)\/(do|result)\/([\w-]+)(?:\/processStatus\/\d+)?\/?$/)
  if (location.origin !== 'https://www.zjooc.cn' || !route) return { error: '请先打开在浙学的作答页或讲评页。' }
  const [, courseId, kind, stage, paperId] = route
  const key = [courseId, kind, paperId].join('/')
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible'
  const text = el => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (request.reviewReady) return { ready: stage === 'result' && [...document.querySelectorAll('.common_test_correct + .common_test_html')].some(el => visible(el) && text(el)) }
  const single = kind === 'singleQuestion'
  const rows = [...document.querySelectorAll(single ? '.left_container > .question_content' : '.common_look_main .questiono-item')].filter(visible)
  const title = text(document.querySelector('.common_look_title h6, .common_look_header .ft18, .top_title p'))
  const rowNumber = (row, i) => {
    const label = single ? document.querySelector('.left_container > .question_title p') : row.querySelector('.questiono-header b')
    return Number(text(label).match(/^\s*(\d+)/)?.[1]) || i + 1
  }
  function read(row, index) {
    const header = row.querySelector('.questiono-header h6 .processing_img, .questiono-header .processing_img, .question_title > span')
    const fields = [...row.querySelectorAll('.pb10 input.el-input__inner[placeholder="此处输入答案"], .blanks_box input, .blanks_box textarea')].filter(visible)
    const choices = [...row.querySelectorAll('.common_test_option, .radio_content')].filter(visible)
    const inputs = choices.map(el => el.querySelector('input[type=radio],input[type=checkbox]'))
    const options = choices.map((el, i) => {
      const content = el.querySelector('.processing_img, p')
      const value = content ? text(content) : text(el).replace(/^[A-Z][.、．]\s*/, '')
      const raw = inputs[i]?.value || ''
      const label = /^[A-Z]$/.test(raw) ? raw : String.fromCharCode(65 + i)
      return { label, text: value }
    })
    const multiple = inputs.some(el => el?.type === 'checkbox')
    const judge = choices.length === 2 && options.every(opt => /^(正确|错误|对|错)$/.test(opt.text))
    const group = single ? text(document.querySelector('.left_container > .question_title p')) :
      text(row.closest('.common-question')?.previousElementSibling)
    const complex = /听力|材料题|完型|完形|简答/.test(group)
    const type = choices.length ? multiple ? 'multiple' : judge ? 'judgement' : 'single' : 'completion'
    const actual = fields.length ? fields.map(el => el.value) : options.filter((_,i) => inputs[i]?.checked).map(o => o.label)
    const stem = text(header)
    const supported = !complex && !!stem && !row.querySelector('img,video,audio,.questiono-item,.questiono-header a[href],.question_title a[href]') && row.querySelectorAll('.questiono-main').length <= 1
      && (choices.length ? !fields.length && inputs.every(Boolean) && new Set(options.map(o => o.label)).size === choices.length && options.every(o => o.text) && new Set(options.map(o => o.text)).size === options.length : fields.length > 0)
    const markers = [...row.querySelectorAll('.common_test_correct')].filter(visible)
    const official = markers.length === 1 && /正确答案/.test(text(markers[0])) && markers[0].nextElementSibling?.matches('.common_test_html') && visible(markers[0].nextElementSibling)
      ? text(markers[0].nextElementSibling) : ''
    const number = rowNumber(row, index)
    const subjectType = group.includes('不定项') ? 10 : { single: 1, multiple: 2, judgement: 3, completion: 7 }[type]
    return { data: { index, number, stem, options, type, subjectType, blanks: fields.length, actual, supported, official }, fields, inputs }
  }
  if (request.write) {
    if (stage !== 'do' || key !== request.key) return { error: '试卷已切换。' }
    const row = rows[request.index]
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
  const totalText = [...document.querySelectorAll('.common_look_main .el-col')].filter(el => !el.childElementCount && !el.closest('.questiono-item') && visible(el)).map(text)
  const declared = single ? document.querySelectorAll('.index_box li').length : totalText.reduce((sum, value) => sum + Number(value.match(/共\s*(\d+)\s*题/)?.[1] || 0), 0)
  const scope = rows.map((row, i) => ({ row, i, number: rowNumber(row, i) })).filter(({ number }) =>
    !request.range || (number >= request.range.start && number <= request.range.end))
  return { key, courseId, kind, stage, paperId, title, declared, total: rows.length, scopeTotal: scope.length,
    ambiguous: !!request.range && new Set(scope.map(r => r.number)).size !== scope.length,
    hasNext: single && [...document.querySelectorAll('.question_btn button')].some(el => visible(el) && !el.disabled && text(el) === '下一题'),
    questions: scope.slice(index, index + request.limit).map(({row, i}) => read(row, i).data) }
})
