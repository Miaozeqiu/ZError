import { CHAOXING_HOMEWORK_FILL } from '../../browser/skills/chaoxingHomework'
import { writeDebugDump } from '../../agent/debugLog'
import { lastHomeworkCard, lastHomeworkPickDebug } from '../../browser/abstractions'
import { askFrames, asObject, evalBrowserView } from '../../browser/eval'
import { applyHomeworkLiveState, readHomeworkLiveState } from './live'
import { DIAGNOSE_HW_FRAMES, PICK_HW_IN_FRAMES, READ_HW_PICKED } from './scripts'

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
    lastHomeworkPickDebug.value = '缺少 browserId / 题号 / 选项'
    return { ok: false, reason: lastHomeworkPickDebug.value }
  }
  const last = lastHomeworkCard.value
  const question = last?.questions?.find((item) => item.index === at)
  const multi = /多选|multi/i.test(String(question?.typeName || question?.type || ''))
  const current = (question?.options || []).filter((opt) => opt.selected).map((opt) => opt.letter)
  const next = current.includes(want)
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

  const scene = asObject(await evalBrowserView(id, DIAGNOSE_HW_FRAMES).catch((err) => ({ error: String(err) })))
  const before = asObject(await evalBrowserView(id, READ_HW_PICKED(at)).catch(() => ({})))
  const topFill = asObject(await evalBrowserView(id, `${CHAOXING_HOMEWORK_FILL}(${JSON.stringify([{ index: at, answer: want }])})`).catch((err) => ({ error: String(err) })))
  let pick = asObject(await evalBrowserView(id, PICK_HW_IN_FRAMES(at, want)).catch((err) => ({ error: String(err) })))
  if (!pick.ok) {
    await askFrames(id, 'hwfill', { answers: JSON.stringify([{ index: at, answer: want }]) })
    await askFrames(id, 'hwpick', { index: String(at), letter: want })
    pick = asObject(await evalBrowserView(id, PICK_HW_IN_FRAMES(at, want)).catch((err) => ({ error: String(err) })))
  }
  const after = asObject(await evalBrowserView(id, READ_HW_PICKED(at)).catch(() => ({})))
  const pickedAfter = String(after.picked || pick.picked || '')
  const ok = pickedAfter.includes(want) || Boolean(pick.ok) || Number(topFill.filledCount) > 0
  const reason = ok
    ? String(pick.reason || `已选中 ${want}`)
    : [
      scene.error ? `诊断失败：${scene.error}` : '',
      scene.asked === false ? '顶层没有 __ZE_ASK_FRAMES__（iframe 钩子没挂上）' : '',
      Number(scene.frames && (scene.frames as unknown[]).length) === 0 ? '没有同源 frame' : '',
      String(scene.addChoice) !== 'function' ? `顶层没有 addChoice（${scene.addChoice}）` : '',
      topFill.error ? `fill 报错：${topFill.error}` : '',
      Number(topFill.filledCount) === 0 ? `fill 没点上 filled=${topFill.filledCount} missed=${JSON.stringify(topFill.missed)}` : '',
      pick.error ? `跨 frame 点击报错：${pick.error}` : '',
      pick.reason || '',
      pickedAfter ? `点后实际选中 ${pickedAfter}，要的是 ${want}` : '点后页面仍未选中',
    ].filter(Boolean).join('；')

  lastHomeworkPickDebug.value = reason
  console.warn('[hw-pick]', reason, { scene, topFill, pick, before, after })
  writeDebugDump('cx-pick-debug', formatPickDebug({
    ...scene,
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
  if (live?.states?.length) applyHomeworkLiveState(live)
  else if (ok) {
    applyHomeworkLiveState({
      states: (lastHomeworkCard.value?.questions || []).map((item) => ({
        index: item.index,
        selected: item.index === at ? want : (item.options || []).filter((opt) => opt.selected).map((opt) => opt.letter).join(''),
        filled: item.index === at ? true : Boolean(item.filled),
      })),
    })
  }
  return { ok, reason, pick, topFill, scene }
}
