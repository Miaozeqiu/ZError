import { writeDebugDump } from '../../agent/debugLog'
import { asObject, evalBrowserView, waitMs } from '../../browser/eval'
import { clickHomeworkBox, fillHomeworkBox } from './act'
import { inspectChaoxingHomework } from './inspect'
import { applyHomeworkLiveState, readHomeworkLiveState } from './live'
import { toHomeworkCard } from './parse'
import {
  DEBUG_HW_BOX,
  INVOKE_HW_CONFIRM,
  INVOKE_HW_SAVE,
  INVOKE_HW_SUBMIT,
  LOCATE_HW_BLANK,
  LOCATE_HW_CONFIRM,
  LOCATE_HW_SAVE,
  LOCATE_HW_SUBMIT,
  READ_HW_FILL_STATE,
  READ_HW_PICKED,
} from './scripts'

const clickBrowserText = async (id: string, text: string) => {
  const { clickBrowserText: click } = await import('../../browser/appBrowser')
  return click(id, text)
}

export const fillChaoxingHomework = async (id: string, answers: unknown) => {
  const list = Array.isArray(answers) ? answers : []
  if (!list.length) return { ok: false, error: '缺少 answers', next: 'fill', hint: 'answers 只放一项：index、type、answer。' }
  const filled: string[] = []
  const missed: string[] = []
  const pickedOk = async (item: unknown) => {
    const row = item as { index?: number; answer?: string; value?: string }
    const index = Number(row?.index) || 0
    const ans = String(row?.answer || row?.value || '')
    let want = ans.toUpperCase().replace(/[^A-H]/g, '')
    if (!want) {
      if (/正确|对/.test(ans)) want = 'A'
      else if (/错误|错/.test(ans)) want = 'B'
    }
    if (!index || !want) return false
    const state = asObject(await evalBrowserView(id, READ_HW_PICKED(index)).catch(() => null))
    const picked = String(state.picked || '')
    return want.split('').every((letter) => picked.includes(letter))
  }
  const fillViaCef = async (item: unknown) => {
    const row = item as { index?: number; type?: string; typeName?: string; answer?: string; value?: string }
    const index = Number(row?.index) || 0
    const ans = String(row?.answer || row?.value || '').trim()
    const type = String(row?.type || row?.typeName || '')
    const want = ans.toUpperCase().replace(/[^A-H]/g, '')
    const letters = want || (/正确|对/.test(ans) ? 'A' : /错误|错/.test(ans) ? 'B' : '')
    const isBlank = /填空|简答|论述|计算|blank|text/i.test(type) || (!letters && ans.length > 2)
    if (!index) return false
    if (isBlank) {
      const parts = ans.split(/[;；\n]/).map((s) => s.trim()).filter(Boolean)
      const texts = parts.length ? parts : [ans]
      let ok = false
      for (let slot = 0; slot < texts.length; slot += 1) {
        const typed = await fillHomeworkBox(id, LOCATE_HW_BLANK(index, slot), texts[slot]).catch(() => ({ ok: false }))
        if (typed.ok) ok = true
      }
      return ok
    }
    if (!letters) return false
    const { pickHomeworkOption } = await import('./pick')
    const before = asObject(await evalBrowserView(id, READ_HW_PICKED(index)).catch(() => ({})))
    const already = String(before.picked || '')
    for (const letter of letters) {
      if (already.includes(letter)) continue
      await pickHomeworkOption(id, index, letter)
      await waitMs(80)
    }
    await waitMs(120)
    return pickedOk({ ...row, answer: letters })
  }
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const label = String((item as { id?: string; index?: number })?.id || (item as { index?: number })?.index || i + 1)
    if (await fillViaCef(item)) {
      filled.push(label)
      await waitMs(120)
      continue
    }
    missed.push(label)
    const debugIndex = Number((item as { index?: number })?.index) || i + 1
    const scene = await evalBrowserView(id, DEBUG_HW_BOX(debugIndex)).catch((err) => ({ error: String(err) }))
    writeDebugDump('cx-fill-debug', JSON.stringify({
      ts: new Date().toISOString(),
      item,
      via: 'cdp',
      scene,
    }, null, 2), 'json')
    await waitMs(120)
  }
  // 只读各题已填/勾选（1 次轻量 eval），不做全量重读
  const live = await readHomeworkLiveState(id)
  const state = live || asObject(await evalBrowserView(id, READ_HW_FILL_STATE()).catch(() => ({})))
  const rows = (Array.isArray(state.states) ? state.states : []) as Array<{ index?: number; selected?: string; filled?: boolean } | number>
  const normalized = rows.map((row, i) => (
    typeof row === 'number'
      ? { index: i + 1, selected: '', filled: Boolean(row) }
      : { index: Number(row.index) || i + 1, selected: String(row.selected || ''), filled: Boolean(row.filled) }
  ))
  applyHomeworkLiveState({ states: normalized })
  const filledCount = normalized.filter((item) => item.filled).length
  const leftIndexes = normalized.filter((item) => !item.filled).map((item) => item.index)
  return {
    ok: filled.length > 0,
    filled,
    missed,
    filledCount,
    questionCount: normalized.length,
    leftIndexes,
    next: leftIndexes.length ? 'fill' : 'save',
    hint: missed.length
      ? `没点上：${missed.join('、')}。再 fill 一次这道题。`
      : leftIndexes.length
        ? `已同步到网页。还剩 ${leftIndexes.length} 道没填：第 ${leftIndexes.join('、')} 题。继续答下一道并 fill。`
        : '全部填完。save 暂存，用户要交再 submit。',
  }
}

/** 未答题：选择题随机选，填空/简答填「无」。用于章节测验兜底。 */
export const guessChaoxingHomework = async (id: string) => {
  const card = await inspectChaoxingHomework(id, { vision: false })
  const questions = card.questions || []
  const { hasUsableVisionModel } = await import('../../model/config')
  const { questionNeedsVision } = await import('./homeworkVision')
  const skipVision = !hasUsableVisionModel()
  if (!questions.length) {
    return {
      ok: false,
      error: '没有读到题目',
      next: 'inspect',
      hint: '先 inspect；若仍无题，确认已点开章节里的测验标签。',
    }
  }
  const answers: Array<{ index: number; type?: string; answer: string }> = []
  const skipped: number[] = []
  for (const q of questions) {
    if (q.filled) continue
    const index = Number(q.index) || 0
    if (!index) continue
    if (skipVision && questionNeedsVision(q)) {
      skipped.push(index)
      continue
    }
    const type = String(q.type || q.typeName || '')
    const letters = (q.options || [])
      .map((opt) => String(opt.letter || '').toUpperCase())
      .filter((letter) => /^[A-H]$/.test(letter))
    if (/填空|简答|论述|计算|blank|text/i.test(type) || (!letters.length && /填|简|论述/.test(String(q.stem || '')))) {
      answers.push({ index, type, answer: '无' })
      continue
    }
    if (/多选|multi/i.test(type) && letters.length >= 2) {
      const count = 1 + Math.floor(Math.random() * Math.min(2, letters.length - 1))
      const shuffled = [...letters].sort(() => Math.random() - 0.5)
      answers.push({ index, type, answer: shuffled.slice(0, count).sort().join('') })
      continue
    }
    const letter = letters[Math.floor(Math.random() * Math.max(letters.length, 1))] || 'A'
    answers.push({ index, type, answer: letter })
  }
  if (!answers.length) {
    return {
      ok: true,
      guessed: 0,
      skippedVision: skipped,
      filledCount: card.filledCount || questions.filter((item) => item.filled).length,
      questionCount: questions.length,
      next: 'save',
      hint: skipped.length
        ? `第 ${skipped.join('、')} 题是图像/公式，当前没有视觉模型，已跳过。其余已填过则 save / next。`
        : '题都已填过，save 或 submit，再 browser_study_next 继续。',
    }
  }
  const filled = await fillChaoxingHomework(id, answers)
  return {
    ...filled,
    guessed: answers.length,
    skippedVision: skipped,
    answers: answers.map((item) => `${item.index}=${item.answer}`),
    hint: skipped.length
      ? `已随机 ${answers.length} 道文字题。第 ${skipped.join('、')} 题是图像/公式，当前没有视觉模型，已跳过。`
      : filled.ok
      ? `已随机填 ${answers.length} 道。save 暂存或 submit，再 browser_study_next 继续刷课。`
      : (filled as { hint?: string }).hint || '随机填写失败，再 inspect 一次后 guess。',
  }
}

const clickConfirmIfAny = async (id: string) => {
  await waitMs(500)
  const invoked = asObject(await evalBrowserView(id, INVOKE_HW_CONFIRM()).catch(() => null))
  if (invoked?.ok) return true
  const box = await clickHomeworkBox(id, LOCATE_HW_CONFIRM()).catch(() => null)
  if (box?.ok) return true
  const text = await clickBrowserText(id, '确定').catch(() => null) as { ok?: boolean } | null
  return Boolean(text?.ok)
}

export const saveChaoxingHomework = async (id: string) => {
  const invoked = asObject(await evalBrowserView(id, INVOKE_HW_SAVE()).catch(() => null))
  let ok = Boolean(invoked?.ok)
  if (!ok) {
    const box = await clickHomeworkBox(id, LOCATE_HW_SAVE()).catch(() => null)
    ok = Boolean(box?.ok)
  }
  if (!ok) {
    const text = await clickBrowserText(id, '暂时保存').catch(() => null) as { ok?: boolean } | null
    ok = Boolean(text?.ok)
  }
  await waitMs(1200)
  const again = await inspectChaoxingHomework(id, { vision: false })
  return toHomeworkCard({
    ...again,
    ok,
    hint: ok ? '已暂时保存。用户要交再用 submit。' : '没点到暂时保存。再 save。',
  })
}

export const submitChaoxingHomework = async (id: string) => {
  const invoked = asObject(await evalBrowserView(id, INVOKE_HW_SUBMIT()).catch(() => null))
  let ok = Boolean(invoked?.ok)
  if (!ok) {
    const box = await clickHomeworkBox(id, LOCATE_HW_SUBMIT()).catch(() => null)
    ok = Boolean(box?.ok)
  }
  if (!ok) {
    const text = await clickBrowserText(id, '提交').catch(() => null) as { ok?: boolean } | null
    ok = Boolean(text?.ok)
  }
  if (ok) await clickConfirmIfAny(id)
  await waitMs(800)
  return toHomeworkCard({
    ok,
    ...(await inspectChaoxingHomework(id, { vision: false })),
    hint: ok ? '已提交。' : '没点到提交。再 submit。',
  })
}
