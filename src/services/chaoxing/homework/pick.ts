import { CHAOXING_HOMEWORK_FILL } from '../../browser/skills/chaoxingHomework'
import { writeDebugDump } from '../../agent/debugLog'
import { lastHomeworkCard } from '../../browser/abstractions'
import { asObject, evalBrowserView, waitMs } from '../../browser/eval'
import { applyHomeworkLiveState, beginHomeworkPick, endHomeworkPick, readHomeworkLiveState } from './live'
import { PICK_HW_IN_FRAMES, READ_HW_PICKED } from './scripts'

const formatPickDebug = (report: Record<string, unknown>) => {
  const frames = (Array.isArray(report.frames) ? report.frames : []) as Array<Record<string, unknown>>
  const tried = (Array.isArray(report.tried) ? report.tried : []) as Array<Record<string, unknown>>
  const iframes = (Array.isArray(report.iframes) ? report.iframes : []) as Array<{ src?: string }>
  return [
    `# 作业点选诊断`,
    `ts: ${new Date().toISOString()}`,
    `index: ${report.index || ''}  letter: ${report.letter || ''}`,
    `ok: ${report.ok ? 'yes' : 'no'}`,
    `reason: ${report.reason || ''}`,
    `asked: ${report.asked}  bound: ${report.bound}  addChoice: ${report.addChoice}`,
    `href: ${report.href || ''}`,
    ``,
    `## frames`,
    ...(frames.length ? frames.map((item) => (
      `- f${item.i} asked=${item.asked} bound=${item.bound} addChoice=${item.addChoice} boxes=${item.questionLi} ${item.href || item.error || ''}`
    )) : ['- 没有同源 frame']),
    ``,
    `## iframes`,
    ...(iframes.length ? iframes.map((item) => `- ${item.src || '(no src)'}`) : ['- 无']),
    ``,
    `## fill`,
    `topFill: ${JSON.stringify(report.topFill || null)}`,
    `pickedBefore: ${report.pickedBefore || '-'}  pickedAfter: ${report.pickedAfter || '-'}`,
    ``,
    `## 点击尝试`,
    ...(tried.length ? tried.map((item) => `- ${JSON.stringify(item)}`) : ['- 无']),
  ].join('\n')
}

export const pickHomeworkOption = async (id: string, index: number, letter: string) => {
  const want = String(letter || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1)
  const at = Number(index) || 0
  if (!id || !at || !want) {
    const reason = '缺少 browserId / 题号 / 选项'
    console.error('[hw-pick]', reason)
    return { ok: false, reason }
  }
  const last = lastHomeworkCard.value
  const question = last?.questions?.find((item) => item.index === at)
  const multi = /多选|multi/i.test(String(question?.typeName || question?.type || ''))
  const current = (question?.options || []).filter((opt) => opt.selected).map((opt) => opt.letter)
  const turningOff = current.includes(want)
  const next = turningOff
    ? current.filter((item) => item !== want)
    : (multi ? [...current, want].sort() : [want])
  if (last?.questions?.length) {
    applyHomeworkLiveState({
      states: last.questions.map((item) => ({
        index: item.index,
        selected: item.index === at
          ? next.join('')
          : (item.options || []).filter((opt) => opt.selected).map((opt) => opt.letter).join(''),
        filled: item.index === at ? next.length > 0 : Boolean(item.filled),
      })),
    })
  }

  beginHomeworkPick()
  try {
    const before = asObject(await evalBrowserView(id, READ_HW_PICKED(at)).catch(() => ({})))
    const alreadyOn = String(before.picked || '').includes(want)
    let topFill: Record<string, unknown> = {}
    let pick: Record<string, unknown> = {}
    if (turningOff) {
      if (alreadyOn || !before.found) {
        pick = asObject(await evalBrowserView(id, PICK_HW_IN_FRAMES(at, want)).catch((err) => ({ error: String(err) })))
      }
    } else if (!alreadyOn) {
      topFill = asObject(await evalBrowserView(id, `${CHAOXING_HOMEWORK_FILL}(${JSON.stringify([{ index: at, answer: want }])})`).catch((err) => ({ error: String(err) })))
      if (!Number(topFill.filledCount)) {
        pick = asObject(await evalBrowserView(id, PICK_HW_IN_FRAMES(at, want)).catch((err) => ({ error: String(err) })))
      }
    }
    await waitMs(80)
    const after = asObject(await evalBrowserView(id, READ_HW_PICKED(at)).catch(() => ({})))
    const pickedAfter = String(after.picked || pick.picked || '')
    const fillOk = Number(topFill.filledCount) > 0 || Boolean(topFill.ok)
    const readOk = Boolean(after.found)
    const ok = turningOff
      ? (readOk ? !pickedAfter.includes(want) : Boolean(pick.ok || pick.clicked))
      : (readOk ? pickedAfter.includes(want) : fillOk || Boolean(pick.ok))
    const reason = ok
      ? (turningOff ? `已取消 ${want}` : `已选中 ${want}`)
      : [
        pick.error ? `点选报错：${pick.error}` : '',
        pick.reason || '',
        turningOff
          ? (pickedAfter ? `取消后仍选中 ${pickedAfter}` : '取消后没读到页面状态')
          : (pickedAfter ? `点后实际选中 ${pickedAfter}，要的是 ${want}` : '点后页面仍未选中'),
      ].filter(Boolean).join('；')

    if (!ok) console.error('[hw-pick]', reason, { topFill, pick, before, after, turningOff })
    writeDebugDump('cx-pick-debug', formatPickDebug({
      index: at,
      letter: want,
      ok,
      reason,
      topFill,
      pickedBefore: before.picked,
      pickedAfter,
      tried: pick.tried,
    }), 'md')

    const live = await readHomeworkLiveState(id).catch(() => null)
    const pageSelected = readOk ? pickedAfter : (ok ? next.join('') : current.join(''))
    if (live?.states?.length) {
      applyHomeworkLiveState({
        states: live.states.map((row) => (
          Number(row.index) === at
            ? { ...row, selected: pageSelected, filled: pageSelected.length > 0 }
            : row
        )),
      })
    } else {
      applyHomeworkLiveState({
        states: (lastHomeworkCard.value?.questions || []).map((item) => ({
          index: item.index,
          selected: item.index === at
            ? pageSelected
            : (item.options || []).filter((opt) => opt.selected).map((opt) => opt.letter).join(''),
          filled: item.index === at ? pageSelected.length > 0 : Boolean(item.filled),
        })),
      })
    }
    return { ok, reason, pick, topFill }
  } finally {
    endHomeworkPick()
  }
}
